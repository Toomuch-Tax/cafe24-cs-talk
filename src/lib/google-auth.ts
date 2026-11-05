import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { allowedDomains, emailDomain } from "./access";
import { HttpError } from "./http";
import { secretKey } from "./secret";

// 구글 OpenID Connect (Authorization Code + PKCE). 라이브러리 없이 jose 로 id_token 서명을 검증한다.
// 인증 시작 때 state·nonce·PKCE 값을 서명된 짧은 쿠키에 담아 두고, 콜백에서 대조한다.
export const OAUTH_COOKIE = "cstalk_google_oauth";
const OAUTH_TTL_SECONDS = 10 * 60;
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const key = () => secretKey("SESSION_SECRET");
const b64url = (buf: Buffer) => buf.toString("base64url");

// 로그인 후 돌아갈 주소: 실제 리다이렉트와 같은 URL 파서로 해석한 뒤 같은 사이트 경로만 허용한다
// (//evil.com, 역슬래시·탭·줄바꿈을 끼워 파서가 외부 주소로 바꾸는 우회 차단)
export function safeNext(next: string | null | undefined, origin: string) {
  if (!next || /[\x00-\x1f\\]/.test(next)) return "/inbox";
  try {
    const u = new URL(next, origin);
    if (u.origin !== new URL(origin).origin || /^\/[/\\]/.test(u.pathname)) return "/inbox";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/inbox";
  }
}

export const redirectUri = (origin: string) => `${process.env.APP_ORIGIN ?? origin}/api/auth/google/callback`;

export async function startGoogleLogin(origin: string, next: string) {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const cookie = await new SignJWT({ state, nonce, verifier, next })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${OAUTH_TTL_SECONDS}s`)
    .sign(key());

  const domains = allowedDomains();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    // 허용 도메인이 하나면 구글 계정 선택 화면에서 그 도메인 계정만 보여준다 (최종 확인은 콜백에서 다시 함)
    ...(domains.length === 1 ? { hd: domains[0] } : {}),
  }).toString();
  return { url: url.toString(), cookie, maxAge: OAUTH_TTL_SECONDS };
}

export type GoogleIdentity = { sub: string; email: string; name: string; picture: string | null };

export async function finishGoogleLogin(origin: string, params: URLSearchParams, cookie: string | undefined) {
  if (!cookie) throw new HttpError(400, "oauth_state_missing");
  let saved: { state: string; nonce: string; verifier: string; next: string };
  try {
    saved = (await jwtVerify(cookie, key(), { algorithms: ["HS256"] })).payload as typeof saved;
  } catch {
    throw new HttpError(400, "oauth_state_expired");
  }
  if (params.get("error")) throw new HttpError(400, "google_cancelled");
  const code = params.get("code");
  if (!code || params.get("state") !== saved.state) throw new HttpError(400, "oauth_state_mismatch");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error("google token", res.status, (await res.text().catch(() => "")).slice(0, 200));
    throw new HttpError(502, "google_token_failed");
  }
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new HttpError(502, "google_token_failed");

  const { payload: p } = await jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: process.env.GOOGLE_CLIENT_ID!,
  });
  if (p.nonce !== saved.nonce) throw new HttpError(400, "oauth_nonce_mismatch");
  const email = String(p.email ?? "").toLowerCase();
  if (!email || p.email_verified !== true || !p.sub) throw new HttpError(403, "email_unverified");
  // hd(Workspace 도메인) 클레임과 이메일 도메인을 둘 다 본다 → 개인 gmail 이나 다른 회사 계정은 차단
  const domains = allowedDomains();
  if (!domains.includes(String(p.hd ?? "").toLowerCase()) || !domains.includes(emailDomain(email))) {
    // 로그인 기록에 누가 시도했는지 남기기 위해 이메일을 붙여 둔다
    throw Object.assign(new HttpError(403, "domain_not_allowed"), { email });
  }

  const identity: GoogleIdentity = {
    sub: p.sub,
    email,
    name: String(p.name ?? "").trim() || email.split("@")[0],
    picture: typeof p.picture === "string" ? p.picture : null,
  };
  return { identity, next: safeNext(saved.next, origin) };
}
