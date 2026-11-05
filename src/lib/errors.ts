import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { appOrigin, postSlack, reportError, slackConfigured } from "./alerts";
import { sql } from "./db";
import { maskPersonal } from "./slack-format";

// 오류 기록 (설정 → 운영 개선 → 오류). 테이블은 0016_ops_insights.sql.
// - 같은 종류(env + 출처 + 위치 + 정규화한 메시지)는 한 행에 모으고 횟수만 올린다. 날짜별 횟수는 error_daily 에 따로 센다.
// - 처음 보는 오류(또는 처리 완료 뒤 재발)이고 운영(live)일 때만 슬랙으로 한 번 알린다. 재시도는 없다.
// - 기록 실패가 원래 요청을 실패시키면 안 된다. DB 가 죽었으면 예전처럼 슬랙으로 바로 보낸다(reportError).
// 수집 경로별 책임 (같은 오류를 두 번 세지 않도록):
//   API 라우트 → http.ts handle() / 화면 렌더·서버 액션 → instrumentation.ts / cron 단계 → cron 라우트
//   삼키고 대신 값을 돌려주는 catch → 그 자리에서 captureError / 브라우저 → /api/client-errors

export type ErrorEnv = "live" | "test" | "dev";
export type ErrorSource = "server" | "external" | "render" | "cron" | "client_widget" | "client_console";
export type ErrorArea = "order" | "ai" | "widget" | "inbox" | "cron" | "other";

// handle() 이 요청마다 넣어 둔다 → 라이브러리 깊은 곳의 catch 에서도 테스트 위젯 요청인지 알 수 있다
export const requestStore = new AsyncLocalStorage<{ request: Request }>();

const release = () => (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "").slice(0, 7) || null;

const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{24,}={0,2}/g;
const DIGITS = /\d{6,}/g;
const URL_QUERY = /(https?:\/\/[^\s?#"'`]+|\/[\w\-./[\]]+)\?[^\s"'`)]*/g;

// 메시지·stack 에서 연락처·이메일·토큰·긴 숫자·쿼리 문자열을 가린다
export function sanitize(text: string, max: number) {
  return maskPersonal(text)
    .replace(URL_QUERY, "$1")
    .replace(JWT, "[가림]")
    .replace(LONG_TOKEN, (m) => (/[A-Za-z]/.test(m) && /\d/.test(m) ? "[가림]" : m))
    .replace(DIGITS, "[가림]")
    .slice(0, max);
}

// 경로 → 라우트 템플릿 (/api/inbox/conversations/3f2…/messages → /api/inbox/conversations/[id]/messages)
export function routeTemplate(pathname: string) {
  return pathname
    .split("/")
    .map((s) => (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(s) || /^\d+$/.test(s) || /^[\w-]{20,}$/.test(s) ? "[id]" : s))
    .join("/");
}

export function areaFromPath(pathname: string): ErrorArea {
  if (/^\/api\/(widget\/orders|inbox\/orders|inbox\/contacts\/[^/]+\/orders|cafe24)/.test(pathname)) return "order";
  if (/^\/api\/(widget\/(ask|ai-chat)|ai\b|inbox\/ai|inbox\/conversations\/[^/]+\/ai-draft)/.test(pathname)) return "ai";
  if (pathname.startsWith("/api/widget") || pathname.startsWith("/widget")) return "widget";
  if (/^\/(api\/)?(inbox|policies|settings|ai)\b/.test(pathname)) return "inbox";
  if (pathname.startsWith("/api/cron")) return "cron";
  return "other";
}

// 테스트 위젯 토큰이 붙은 요청 → test, 로컬 → dev, 나머지 → live
export async function resolveEnv(tokenEnv?: "live" | "test" | null): Promise<ErrorEnv> {
  let env = tokenEnv ?? null;
  const request = requestStore.getStore()?.request;
  if (!env && request) {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer) {
      const { verifyVisitorSession } = await import("./widget-token");
      env = (await verifyVisitorSession(bearer))?.env ?? null;
    }
  }
  if (env === "test") return "test";
  return process.env.NODE_ENV === "production" ? "live" : "dev";
}

const normalize = (message: string) =>
  message
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\d+/g, "0")
    .replace(/\s+/g, " ")
    .slice(0, 200);

export type ErrorInput = {
  source: ErrorSource;
  where: string;
  area?: ErrorArea;
  err: unknown;
  status?: number;
  code?: string;
  env?: ErrorEnv;
};

export async function logError(e: ErrorInput) {
  // Cafe24Error 처럼 외부 서비스가 준 이유(detail)가 있으면 함께 남긴다 (cafe24_403 만으로는 원인을 알 수 없었음)
  const detail = (e.err as { detail?: unknown } | null)?.detail;
  const raw = (e.err instanceof Error ? e.err.message || e.err.name : String(e.err)) + (typeof detail === "string" && detail ? ` — ${detail}` : "");
  const message = sanitize(raw.replace(/\s+/g, " ").trim() || "(메시지 없음)", 500);
  const stack = e.err instanceof Error && e.err.stack ? sanitize(e.err.stack, 2000) : null;
  try {
    const env = e.env ?? (await resolveEnv());
    const fingerprint = createHash("sha1")
      .update([env, e.source, e.where, e.code ?? "", normalize(message)].join("|"))
      .digest("hex")
      .slice(0, 20);
    const rel = release();
    const [row] = await sql<{ id: string; inserted: boolean }[]>`
      with g as (
        insert into error_groups (env, fingerprint, source, where_, area, code, status, message, stack, first_release, last_release)
        values (${env}, ${fingerprint}, ${e.source}, ${e.where.slice(0, 200)}, ${e.area ?? "other"}, ${e.code ?? null},
          ${e.status ?? null}, ${message}, ${stack}, ${rel}, ${rel})
        on conflict (env, fingerprint) where resolved_at is null
        do update set count = error_groups.count + 1, last_at = now(), last_release = excluded.last_release,
          stack = coalesce(excluded.stack, error_groups.stack)
        returning id, (xmax = 0) as inserted
      ), d as (
        insert into error_daily (group_id, day, count)
        select id, (now() at time zone 'Asia/Seoul')::date, 1 from g
        on conflict (group_id, day) do update set count = error_daily.count + 1
      )
      select id, inserted from g`;
    if (row?.inserted && env === "live" && slackConfigured()) {
      await postSlack(
        `:rotating_light: 새 오류 · \`${e.where}\` (${e.source}${e.status ? ` ${e.status}` : ""})\n\`\`\`${message.slice(0, 300)}\`\`\`\n` +
          `<${appOrigin()}/settings?tab=improve|운영 개선에서 보기>`,
      ).catch((err) => console.error("error alert", err));
    }
    return row ?? null;
  } catch (err) {
    console.error("logError failed", err);
    reportError(e.where, e.err);
    return null;
  }
}

// 요청 처리 중 부른다: 응답을 늦추지 않고 뒤에서 기록한다 (요청 밖이면 바로)
export function captureError(e: ErrorInput) {
  console.error(`[${e.source}] ${e.where}`, e.err);
  // 요청 정보(테스트 위젯 여부)는 응답이 끝나기 전에 읽어 둔다
  const env = e.env ? Promise.resolve(e.env) : resolveEnv();
  const run = async () => {
    await logError({ ...e, env: await env.catch(() => undefined) });
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
