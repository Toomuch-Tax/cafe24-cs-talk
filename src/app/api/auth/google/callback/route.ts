import { NextResponse, type NextRequest } from "next/server";
import { recordLogin } from "@/lib/audit";
import { setSessionCookie } from "@/lib/auth";
import { finishGoogleLogin, OAUTH_COOKIE } from "@/lib/google-auth";
import { HttpError } from "@/lib/http";
import { signInWithGoogle } from "@/lib/users";

// 구글에서 돌아온 뒤: 신원 확인 → 계정 연결/생성 → 세션 쿠키. 실패하면 로그인 화면에 이유를 보여준다.
// 성공·거부(도메인·승인 대기·정지)는 로그인 기록에 남긴다. 사용자가 취소했거나 만료된 시도는 남기지 않는다.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, origin));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  };
  try {
    const { identity, next } = await finishGoogleLogin(
      origin,
      request.nextUrl.searchParams,
      request.cookies.get(OAUTH_COOKIE)?.value,
    );
    const user = await signInWithGoogle(identity);
    const login = { method: "google" as const, email: identity.email, agent: { id: user.id, name: user.name } };
    if (user.status !== "active") {
      await recordLogin(request, { ...login, ok: false, reason: user.status });
      return fail(user.status);
    }
    await recordLogin(request, { ...login, ok: true });
    const res = NextResponse.redirect(new URL(next, origin));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    await setSessionCookie(res, user.id);
    return res;
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.message === "domain_not_allowed" || err.message === "email_unverified") {
        const email = "email" in err && typeof err.email === "string" ? err.email : null;
        await recordLogin(request, { method: "google", ok: false, email, reason: "domain" });
        return fail("domain");
      }
      if (err.message === "google_cancelled") return fail("cancelled");
      if (err.message.startsWith("oauth_state")) return fail("expired");
    }
    console.error("google callback", err);
    return fail("google_failed");
  }
}
