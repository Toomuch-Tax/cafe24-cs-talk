import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { avatarColumns } from "./agent-avatar";
import { sql } from "./db";
import { HttpError } from "./http";
import { secretKey } from "./secret";

export const SESSION_COOKIE = "cstalk_session";
// 한 번 로그인한 브라우저는 30일 유지. 비활성화·권한 변경은 getAgent 가 매 요청 DB 로 확인하므로 즉시 반영된다.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const key = () => secretKey("SESSION_SECRET");

export type Role = "admin" | "agent";
// avatar_url: 지금 보여줄 프로필 사진(없으면 avatar_emoji 를 그린다)
export type Agent = {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatar_url: string | null;
  avatar_emoji: string;
  avatar_mode: "emoji" | "image" | "google";
  google_picture: string | null;
};

export async function setSessionCookie(res: NextResponse, agentId: string) {
  const token = await new SignJWT({ typ: "agent" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(agentId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

// 매 요청마다 DB 에서 상태를 다시 확인한다 → 퇴사자 비활성화·권한 변경 즉시 반영.
export async function getAgent(request: NextRequest): Promise<Agent | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.typ !== "agent" || !payload.sub) return null;
    const [agent] = await sql<Agent[]>`
      select id, email, name, role, ${avatarColumns()}, avatar_mode, avatar_url as google_picture
      from agents where id = ${payload.sub} and status = 'active'`;
    return agent ?? null;
  } catch {
    return null;
  }
}

export async function requireAgent(request: NextRequest) {
  const agent = await getAgent(request);
  if (!agent) throw new HttpError(401, "unauthorized");
  return agent;
}

export async function requireAdmin(request: NextRequest) {
  const agent = await requireAgent(request);
  if (agent.role !== "admin") throw new HttpError(403, "forbidden");
  return agent;
}
