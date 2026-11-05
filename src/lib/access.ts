import { getSetting } from "./settings";

// 운영 콘솔 로그인 정책.
// - 구글 로그인: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 이 있을 때만 켜진다. 허용 도메인은 GOOGLE_ALLOWED_DOMAINS(콤마 구분, 비우면 구글 로그인을 누구에게도 허용하지 않음).
// - 처음 들어온 사용자: autoApprove 면 바로 상담원, 아니면 관리자 승인 대기.
// - 비밀번호 로그인: 예전 계정용. 모두 구글로 옮긴 뒤 관리자가 끌 수 있다.
export type AccessPolicy = { autoApprove: boolean; passwordLogin: boolean };

const DEFAULT_POLICY: AccessPolicy = { autoApprove: true, passwordLogin: true };

export async function getAccessPolicy(): Promise<AccessPolicy> {
  return { ...DEFAULT_POLICY, ...((await getSetting<Partial<AccessPolicy>>("access_policy")) ?? {}) };
}

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function allowedDomains() {
  return (process.env.GOOGLE_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export const emailDomain = (email: string) => email.split("@").at(-1)?.toLowerCase() ?? "";
export const isAllowedEmail = (email: string) => allowedDomains().includes(emailDomain(email));

// 비밀번호 로그인은 구글이 안 켜져 있으면 끌 수 없다 (전원 잠김 방지)
export async function passwordLoginEnabled() {
  return !googleConfigured() || (await getAccessPolicy()).passwordLogin;
}
