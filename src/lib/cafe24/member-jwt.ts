import { createHmac, timingSafeEqual } from "node:crypto";

// CAFE24API.getEncryptedMemberId(client_id) 가 주는 회원 JWT 검증.
// Cafe24 가 앱의 Service Key 로 HS512 서명하므로 브라우저가 위조할 수 없다.

const MAX_AGE_WITHOUT_EXP_S = 24 * 60 * 60;

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export type VerifiedMember = { memberId: string; expiresAt: Date };

export function verifyMemberJwt(token: string): VerifiedMember | null {
  const serviceKey = process.env.CAFE24_SERVICE_KEY;
  if (!serviceKey) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  let header: { alg?: string };
  try {
    header = JSON.parse(b64url(h).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS512") return null; // alg 혼동 공격 차단

  // Cafe24 PHP 예제는 키 문자열을 그대로 쓴다. base64 로 보이는 키는 디코드본도 시도한다.
  const keys = [Buffer.from(serviceKey, "utf8")];
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(serviceKey)) keys.push(Buffer.from(serviceKey, "base64"));
  const given = b64url(sig);
  const valid = keys.some((k) => {
    const mac = createHmac("sha512", k).update(`${h}.${p}`).digest();
    return mac.length === given.length && timingSafeEqual(mac, given);
  });
  if (!valid) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(b64url(p).toString("utf8"));
  } catch {
    return null;
  }

  const now = Date.now() / 1000;
  const exp = Number(payload.exp);
  const iat = Number(payload.iat);
  let expiresAt: number;
  if (Number.isFinite(exp)) {
    if (now > exp) return null;
    expiresAt = exp;
  } else if (Number.isFinite(iat)) {
    // exp 가 없으면 발급 후 24시간까지만 인정 (유출된 토큰 재사용 방지)
    if (now - iat > MAX_AGE_WITHOUT_EXP_S) return null;
    expiresAt = iat + MAX_AGE_WITHOUT_EXP_S;
  } else {
    return null;
  }

  const memberId = String(payload.member_id ?? payload.memberId ?? payload.id ?? payload.sub ?? "").trim();
  if (!memberId) return null;
  return { memberId, expiresAt: new Date(expiresAt * 1000) };
}
