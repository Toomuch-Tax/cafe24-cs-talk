import { NextResponse, type NextRequest } from "next/server";
import { googleConfigured } from "@/lib/access";
import { OAUTH_COOKIE, safeNext, startGoogleLogin } from "@/lib/google-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// 로그인 화면의 "Google 계정으로 로그인" → 구글 계정 선택 화면으로 보낸다
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (!googleConfigured()) return NextResponse.redirect(new URL("/login?error=google_not_configured", origin));
  try {
    await rateLimit(`google_login:${clientIp(request)}`, 20, 300);
  } catch {
    return NextResponse.redirect(new URL("/login?error=rate_limited", origin));
  }
  const next = safeNext(request.nextUrl.searchParams.get("next"), origin);
  const { url, cookie, maxAge } = await startGoogleLogin(origin, next);
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge,
  });
  return res;
}

