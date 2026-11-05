import { appOrigin, notifySlack } from "./alerts";
import type { Agent } from "./auth";
import { sql } from "./db";
import { clientIp } from "./rate-limit";

// 운영 콘솔 변경 이력·로그인 기록 (설정 → 변경 이력). 테이블은 0011_audit_logs.sql.
// 기록 실패가 원래 작업(설정 저장·로그인)을 실패시키면 안 되므로 오류는 삼킨다.
// 운영자가 저장·로그인할 때만 쓰인다 — 고객 요청 경로에서는 부르지 않는다.

export type AuditArea = "widget" | "users" | "security" | "settings" | "ai";
export type Change = { label: string; before?: string | null; after: string };

export const AUDIT_RETENTION_DAYS = 365;
export const LOGIN_RETENTION_DAYS = 90;

// 바뀐 항목만 남긴다. 화면에 보일 문구끼리 비교한다 (DB jsonb 는 키 순서가 바뀌어 돌아오므로 값 비교는 쓰지 않음).
export function diff(rows: { label: string; before: unknown; after: unknown; fmt?: (v: unknown) => string }[]): Change[] {
  const show = (v: unknown, fmt?: (v: unknown) => string) =>
    fmt ? fmt(v) : v === null || v === undefined || v === "" ? "없음" : String(v);
  return rows
    .map((r) => ({ label: r.label, before: show(r.before, r.fmt), after: show(r.after, r.fmt) }))
    .filter((c) => c.before !== c.after);
}

export async function audit(
  actor: Pick<Agent, "id" | "name" | "email"> | null,
  e: { area: AuditArea; action: string; title: string; changes?: Change[]; skipIfEmpty?: boolean },
) {
  if (e.skipIfEmpty && !e.changes?.length) return;
  try {
    await sql`
      insert into audit_logs (actor_id, actor_name, actor_email, area, action, title, changes)
      values (${actor?.id ?? null}, ${actor?.name ?? null}, ${actor?.email ?? null},
        ${e.area}, ${e.action}, ${e.title}, ${sql.json(e.changes ?? [])})`;
  } catch (err) {
    console.error("audit", err);
  }
}

// ── 로그인 기록 ───────────────────────────────────────────────────────────
export type LoginReason =
  | "wrong_password"
  | "unknown_account"
  | "no_password"
  | "disabled"
  | "pending"
  | "domain"
  | "password_disabled";
export const LOGIN_REASON_LABEL: Record<LoginReason, string> = {
  wrong_password: "비밀번호 틀림",
  unknown_account: "등록 안 된 계정",
  no_password: "비밀번호 없는 계정(구글 전용)",
  disabled: "정지된 계정",
  pending: "승인 대기",
  domain: "허용 안 된 도메인",
  password_disabled: "비밀번호 로그인 꺼짐",
};

// 10분 안에 같은 계정 또는 같은 IP 로 실패가 이만큼 쌓이면 슬랙으로 한 번 알린다 (같은 계정·IP 는 1시간에 한 번)
const FAIL_WINDOW_MIN = 10;
const FAIL_ALERT_AT = 5;

export function maskIp(ip: string | null) {
  if (!ip || ip === "local") return ip;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + ":•";
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.•.•` : ip;
}

export async function recordLogin(
  request: Request,
  e: {
    method: "google" | "password";
    ok: boolean;
    email: string | null;
    agent?: { id: string; name: string } | null;
    reason?: LoginReason;
  },
) {
  const ip = clientIp(request);
  try {
    await sql`
      insert into login_events (agent_id, agent_name, email, method, ok, reason, ip, user_agent)
      values (${e.agent?.id ?? null}, ${e.agent?.name ?? null}, ${e.email}, ${e.method}, ${e.ok},
        ${e.reason ?? null}, ${ip}, ${(request.headers.get("user-agent") ?? "").slice(0, 300) || null})`;
    if (!e.ok) await alertOnFailures(e.email, ip);
  } catch (err) {
    console.error("recordLogin", err);
  }
}

async function alertOnFailures(email: string | null, ip: string) {
  const [row] = await sql<{ n: number; first: Date; methods: string[] }[]>`
    select count(*)::int as n, min(created_at) as first, array_agg(distinct method) as methods
    from login_events
    where not ok and created_at > now() - make_interval(mins => ${FAIL_WINDOW_MIN})
      and (ip = ${ip} or (${email}::text is not null and email = ${email}))`;
  if (!row || row.n < FAIL_ALERT_AT) return;
  const [last] = await sql<{ created_at: Date; method: string }[]>`
    select created_at, method from login_events where ok and email = ${email} order by created_at desc limit 1`;
  const hour = Math.floor(Date.now() / 3_600_000);
  const how = row.methods.map((m) => (m === "google" ? "구글" : "비밀번호")).join("·");
  await notifySlack(
    `login-fail:${email ?? ip}:${hour}`,
    [
      `:warning: *운영 콘솔 로그인 실패 ${row.n}회 (${FAIL_WINDOW_MIN}분 안)*`,
      `계정 ${email ?? "알 수 없음"} · ${how} 로그인 · IP ${maskIp(ip)}`,
      last ? `마지막 성공 로그인: ${kst(last.created_at)} (${last.method === "google" ? "구글" : "비밀번호"})` : "",
      `<${appOrigin()}/settings?tab=audit&view=logins|변경 이력 열기 →>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

const kst = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

// "Chrome · macOS" 정도로만 줄여 보여준다
export function deviceLabel(ua: string | null) {
  if (!ua) return "알 수 없음";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Whale\//.test(ua)
      ? "Whale"
      : /SamsungBrowser\//.test(ua)
        ? "삼성 인터넷"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : "브라우저";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

// ── 조회 (관리자 화면) ──────────────────────────────────────────────────────
export async function listAudit(opts: { area?: AuditArea; days: number; before?: string; limit: number }) {
  const rows = await sql<
    { id: string; actor_name: string | null; area: AuditArea; action: string; title: string; changes: Change[]; created_at: string }[]
  >`
    select id, actor_name, area, action, title, changes, created_at from audit_logs
    where created_at > now() - make_interval(days => ${opts.days})
      ${opts.area ? sql`and area = ${opts.area}` : sql``}
      ${opts.before ? sql`and created_at < ${opts.before}` : sql``}
    order by created_at desc limit ${opts.limit + 1}`;
  const counts = await sql<{ area: AuditArea; n: number }[]>`
    select area, count(*)::int as n from audit_logs
    where created_at > now() - make_interval(days => ${opts.days}) group by area`;
  return {
    items: rows.slice(0, opts.limit),
    more: rows.length > opts.limit,
    counts: Object.fromEntries(counts.map((c) => [c.area, c.n])) as Partial<Record<AuditArea, number>>,
  };
}

export async function listLogins(opts: { failedOnly: boolean; agentId?: string; before?: string; limit: number }) {
  const rows = await sql<
    {
      id: string;
      agent_id: string | null;
      agent_name: string | null;
      email: string | null;
      method: "google" | "password";
      ok: boolean;
      reason: LoginReason | null;
      ip: string | null;
      user_agent: string | null;
      created_at: string;
    }[]
  >`
    select id, agent_id, agent_name, email, method, ok, reason, ip, user_agent, created_at from login_events
    where true
      ${opts.failedOnly ? sql`and not ok` : sql``}
      ${opts.agentId ? sql`and agent_id = ${opts.agentId}` : sql``}
      ${opts.before ? sql`and created_at < ${opts.before}` : sql``}
    order by created_at desc limit ${opts.limit + 1}`;

  const [stats] = await sql<{ total: number; failed: number; domain: number }[]>`
    select count(*) filter (where ok)::int as total,
      count(*) filter (where not ok)::int as failed,
      count(*) filter (where reason = 'domain')::int as domain
    from login_events where created_at > now() - interval '7 days'`;

  // 최근 24시간 실패 몰림 (화면 상단 경고): 같은 계정(없으면 IP)으로 10분 안에 FAIL_ALERT_AT 회 이상 몰린 가장 큰 묶음
  const [burst] = await sql<{ n: number; first: string; last: string; email: string | null; ip: string | null; password: boolean }[]>`
    with f as (
      select created_at, email, ip,
        count(*) over w as n, min(created_at) over w as first, bool_or(method = 'password') over w as password
      from login_events where not ok and created_at > now() - interval '24 hours'
      window w as (partition by coalesce(email, ip) order by created_at
        range between make_interval(mins => ${FAIL_WINDOW_MIN}) preceding and current row)
    )
    select n::int as n, first, created_at as last, email, ip, password
    from f where n >= ${FAIL_ALERT_AT} order by n desc, created_at desc limit 1`;
  const alert = burst
    ? { count: burst.n, from: burst.first, to: burst.last, email: burst.email, ip: maskIp(burst.ip), password: burst.password }
    : null;
  const [{ recentFail }] = await sql<{ recentFail: boolean }[]>`
    select exists (select 1 from login_events where not ok and created_at > now() - interval '24 hours') as "recentFail"`;

  return {
    items: rows.slice(0, opts.limit).map(({ ip, user_agent, ...r }) => ({
      ...r,
      ip: maskIp(ip),
      device: deviceLabel(user_agent),
      reasonLabel: r.reason ? LOGIN_REASON_LABEL[r.reason] : null,
    })),
    more: rows.length > opts.limit,
    stats,
    alert,
    recentFail,
  };
}

export async function cleanupAudit() {
  const a = await sql`delete from audit_logs where created_at < now() - make_interval(days => ${AUDIT_RETENTION_DAYS})`;
  const b = await sql`delete from login_events where created_at < now() - make_interval(days => ${LOGIN_RETENTION_DAYS})`;
  return { auditLogs: a.count, loginEvents: b.count };
}
