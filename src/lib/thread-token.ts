import { SignJWT, jwtVerify } from "jose";
import { secretKey } from "./secret";

// 답변 이메일의 "이어서 문의하기" 링크용 토큰: 문의 1건만 열람·답장할 수 있다.
export const THREAD_LINK_DAYS = 30;

export async function signThreadToken(conversationId: string, contactId: string) {
  return new SignJWT({ typ: "thread", cid: contactId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(conversationId)
    .setIssuedAt()
    .setExpirationTime(`${THREAD_LINK_DAYS}d`)
    .sign(secretKey("WIDGET_TOKEN_SECRET"));
}

export async function verifyThreadToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey("WIDGET_TOKEN_SECRET"), { algorithms: ["HS256"] });
    if (payload.typ !== "thread" || !payload.sub || typeof payload.cid !== "string") return null;
    return { conversationId: payload.sub, contactId: payload.cid };
  } catch {
    return null;
  }
}
