import { decrypt, encrypt } from "../crypto";
import { sql } from "../db";
import { HttpError } from "../http";

// Cafe24 Admin API 클라이언트 (서버 전용)
// - Access Token 2시간, Refresh Token 2주·1회용 → 갱신은 DB 잠금으로 한 번에 하나만
// - 429 는 지수 백오프로 재시도

export const CAFE24_API_VERSION = "2026-09-01";
// 개발자센터 앱 권한과 맞춰야 한다: 주문·회원·상품·디자인(읽기), 앱(읽기+쓰기: 위젯 ScriptTag)
export const ADMIN_SCOPES = [
  "mall.read_order",
  "mall.read_customer",
  "mall.read_product",
  "mall.read_application",
  "mall.write_application",
  // 테스트 스킨의 skin_no 를 테마 목록에서 찾는다 (ScriptTag skin_no 지정용)
  "mall.read_design",
];

// HttpError 를 상속해 라우트에서 그대로 JSON 에러(cafe24_<code>)로 응답된다
export class Cafe24Error extends HttpError {
  constructor(status: number, public code: string, public detail: string) {
    super(status === 503 ? 503 : status === 404 ? 404 : 502, `cafe24_${code}`);
  }
}

export const mallId = () => {
  const id = process.env.CAFE24_MALL_ID;
  if (!id) throw new Error("CAFE24_MALL_ID is not set");
  return id;
};
const base = () => `https://${mallId()}.cafe24api.com/api/v2`;

function basicAuth() {
  const id = process.env.CAFE24_CLIENT_ID;
  const secret = process.env.CAFE24_CLIENT_SECRET;
  if (!id || !secret) throw new Error("CAFE24_CLIENT_ID / CAFE24_CLIENT_SECRET is not set");
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

export function redirectUri(origin: string) {
  return `${origin}/api/cafe24/callback`;
}

export function authorizeUrl(state: string, origin: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.CAFE24_CLIENT_ID!,
    state,
    redirect_uri: redirectUri(origin),
    scope: ADMIN_SCOPES.join(" "),
  });
  return `${base()}/oauth/authorize?${q}`;
}

type TokenResponse = {
  access_token: string;
  expires_at: string;
  refresh_token: string;
  refresh_token_expires_at: string;
  issued_at?: string;
  scopes?: string[];
  mall_id?: string;
};

// Cafe24 의 *_at 값은 시간대 표기가 없다. 시간대를 추측하지 않고 issued_at 과의 차이(유효기간)로 계산한다.
function lifetimes(t: TokenResponse) {
  const parse = (v: string) => Date.parse(v.replace(" ", "T"));
  const issued = t.issued_at ? parse(t.issued_at) : NaN;
  const accessMs = Number.isFinite(issued) ? parse(t.expires_at) - issued : NaN;
  const refreshMs = Number.isFinite(issued) ? parse(t.refresh_token_expires_at) - issued : NaN;
  const now = Date.now();
  return {
    access: new Date(now + (accessMs > 0 ? accessMs : 2 * 60 * 60 * 1000)),
    refresh: new Date(now + (refreshMs > 0 ? refreshMs : 14 * 24 * 60 * 60 * 1000)),
  };
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${base()}/oauth/token`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Cafe24Error(res.status, data.error ?? "token_error", data.error_description ?? "token request failed");
  }
  return data as TokenResponse;
}

async function saveTokens(t: TokenResponse, connectedBy?: string) {
  const life = lifetimes(t);
  await sql`
    insert into cafe24_tokens (mall_id, access_token_enc, refresh_token_enc, access_expires_at,
      refresh_expires_at, scopes, connected_by, refreshing_until, updated_at)
    values (${mallId()}, ${encrypt(t.access_token)}, ${encrypt(t.refresh_token)}, ${life.access},
      ${life.refresh}, ${t.scopes ?? []}, ${connectedBy ?? null}, null, now())
    on conflict (mall_id) do update set
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      access_expires_at = excluded.access_expires_at,
      refresh_expires_at = excluded.refresh_expires_at,
      scopes = case when cardinality(excluded.scopes) > 0 then excluded.scopes else cafe24_tokens.scopes end,
      connected_by = coalesce(excluded.connected_by, cafe24_tokens.connected_by),
      refreshing_until = null,
      updated_at = now()`;
}

export async function exchangeCode(code: string, origin: string, agentId: string) {
  const t = await requestToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });
  if (t.mall_id && t.mall_id !== mallId()) throw new Cafe24Error(400, "mall_mismatch", "다른 몰의 토큰입니다");
  await saveTokens(t, agentId);
  return t;
}

type TokenRow = {
  access_token_enc: string;
  refresh_token_enc: string;
  access_expires_at: Date;
  refresh_expires_at: Date;
  scopes: string[];
  updated_at: Date;
};

export const cafe24Configured = () => Boolean(process.env.CAFE24_MALL_ID && process.env.CAFE24_CLIENT_ID && process.env.CAFE24_CLIENT_SECRET);

export async function connectionStatus() {
  // 환경변수를 아직 안 넣은 새 설치: 오류 대신 "설정 전" 상태로 돌려준다
  if (!cafe24Configured()) return { connected: false as const, configured: false as const, mallId: "" };
  const [row] = await sql<TokenRow[]>`select * from cafe24_tokens where mall_id = ${mallId()}`;
  if (!row) return { connected: false as const, mallId: mallId() };
  return {
    connected: row.refresh_expires_at > new Date(),
    mallId: mallId(),
    scopes: row.scopes,
    refreshExpiresAt: row.refresh_expires_at,
    updatedAt: row.updated_at,
  };
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getAccessToken(forceRefresh = false): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const [row] = await sql<TokenRow[]>`select * from cafe24_tokens where mall_id = ${mallId()}`;
    if (!row) throw new Cafe24Error(503, "not_connected", "Cafe24 가 연결되지 않았어요");
    if (!forceRefresh && row.access_expires_at.getTime() - Date.now() > REFRESH_MARGIN_MS) {
      return decrypt(row.access_token_enc);
    }
    if (row.refresh_expires_at <= new Date()) throw new Cafe24Error(503, "reconnect_required", "Cafe24 연결이 만료됐어요");

    // 갱신 잠금: 한 요청만 Refresh Token 을 쓴다 (1회용이라 동시에 쓰면 연결이 끊긴다)
    const [lock] = await sql`
      update cafe24_tokens set refreshing_until = now() + interval '30 seconds'
      where mall_id = ${mallId()} and (refreshing_until is null or refreshing_until < now())
      returning mall_id`;
    if (lock) {
      try {
        const t = await requestToken({ grant_type: "refresh_token", refresh_token: decrypt(row.refresh_token_enc) });
        await saveTokens(t);
        return t.access_token;
      } catch (err) {
        await sql`update cafe24_tokens set refreshing_until = null where mall_id = ${mallId()}`;
        if (err instanceof Cafe24Error && err.code === "invalid_grant") {
          throw new Cafe24Error(503, "reconnect_required", "Cafe24 연결이 만료됐어요");
        }
        throw err;
      }
    }
    // 다른 요청이 갱신 중 → 잠시 후 그 결과를 다시 읽는다
    forceRefresh = false;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Cafe24Error(503, "refresh_timeout", "Cafe24 토큰 갱신 대기 시간 초과");
}

export async function cafe24Request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  let token = await getAccessToken();
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base()}/admin${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-cafe24-api-version": CAFE24_API_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 && !refreshed) {
      // 토큰이 서버 쪽에서 먼저 만료·폐기된 경우 한 번만 강제 갱신
      refreshed = true;
      token = await getAccessToken(true);
      continue;
    }
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data.error ?? {};
      throw new Cafe24Error(res.status, String(e.code ?? res.status), e.message ?? "Cafe24 API error");
    }
    return data as T;
  }
}

export const cafe24Get = <T>(path: string) => cafe24Request<T>("GET", path);
