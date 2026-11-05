import { SignJWT, jwtVerify } from "jose";
import { HttpError } from "./http";
import { secretKey } from "./secret";

// 방문자 토큰: 채팅 복구 전용. 회원 권한은 이 토큰을 발급한 세션에서 Cafe24 회원 JWT 로 확인된 경우에만
// mid 로 서명해 둔다 (로그아웃 뒤 같은 브라우저가 앞 회원의 주문을 보지 않게).
const TTL = "180d";
const key = () => secretKey("WIDGET_TOKEN_SECRET");

// live: 전체 공개 스킨, test: 테스트 스킨에서 열린 위젯. 미공개 기능은 test 에서만 켠다 (src/lib/features.ts).
export type WidgetEnv = "live" | "test";

export async function signVisitorToken(contactId: string, env: WidgetEnv = "live", memberId: string | null = null) {
  return new SignJWT({ typ: "visitor", env, ...(memberId ? { mid: memberId } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(contactId)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(key());
}

export async function verifyVisitorSession(
  token: string | null | undefined,
): Promise<{ contactId: string; env: WidgetEnv; memberId: string | null } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
    });
    if (payload.typ !== "visitor" || !payload.sub) return null;
    // env 가 없는 예전 토큰은 live 로 본다
    return {
      contactId: payload.sub,
      env: payload.env === "test" ? "test" : "live",
      // mid 가 없는 예전 토큰은 비회원으로 본다 (위젯을 열면 세션이 새 토큰을 준다)
      memberId: typeof payload.mid === "string" ? payload.mid : null,
    };
  } catch {
    return null;
  }
}

export async function verifyVisitorToken(token: string | null | undefined): Promise<string | null> {
  return (await verifyVisitorSession(token))?.contactId ?? null;
}

export async function requireVisitorSession(request: Request) {
  const header = request.headers.get("authorization");
  const session = await verifyVisitorSession(header?.replace(/^Bearer\s+/i, ""));
  if (!session) throw new HttpError(401, "invalid_visitor");
  return session;
}

export async function requireVisitor(request: Request) {
  return (await requireVisitorSession(request)).contactId;
}
