import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { passwordLoginEnabled } from "@/lib/access";
import { type LoginReason, recordLogin } from "@/lib/audit";
import { setSessionCookie } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, parseBody } from "@/lib/http";
import { verifyPassword } from "@/lib/password";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

// 비밀번호 로그인 (구글 로그인 이전 계정용). 관리자가 설정에서 끌 수 있다.
// 성공·실패를 로그인 기록에 남긴다 (설정 → 변경 이력). 화면에 돌려주는 오류는 사유와 관계없이 같다.
export const POST = handle(async (request: NextRequest) => {
  await rateLimit(`login:${clientIp(request)}`, 10, 300);
  const { email: raw, password } = await parseBody(request, Body);
  const email = raw.toLowerCase();
  const [agent] = await sql<{ id: string; name: string; status: string; password_hash: string | null }[]>`
    select id, name, status, password_hash from agents where email = ${email}`;
  const who = agent ? { id: agent.id, name: agent.name } : null;
  const fail = (reason: LoginReason) => recordLogin(request, { method: "password", ok: false, email, agent: who, reason });
  if (!(await passwordLoginEnabled())) {
    await fail("password_disabled");
    throw new HttpError(403, "password_login_disabled");
  }
  if (!agent?.password_hash) {
    await fail(agent ? "no_password" : "unknown_account");
    throw new HttpError(401, "invalid_credentials");
  }
  if (!verifyPassword(password, agent.password_hash)) {
    await fail("wrong_password");
    throw new HttpError(401, "invalid_credentials");
  }
  if (agent.status !== "active") {
    await fail(agent.status === "pending" ? "pending" : "disabled");
    throw new HttpError(401, "invalid_credentials");
  }
  await sql`update agents set last_login_at = now() where id = ${agent.id}`;
  await recordLogin(request, { method: "password", ok: true, email, agent: who });
  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, agent.id);
  return res;
});
