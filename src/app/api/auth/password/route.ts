import type { NextRequest } from "next/server";
import { z } from "zod";
import { passwordLoginEnabled } from "@/lib/access";
import { audit } from "@/lib/audit";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";

const PASSWORD_MIN = 8;
const Body = z.object({ current: z.string().max(200).optional(), next: z.string().min(PASSWORD_MIN).max(200) });

// 내 비밀번호 (설정 → 내 프로필). 이미 비밀번호가 있으면 현재 비밀번호를 확인한 뒤 바꾸고,
// 구글로만 들어오던 계정은 바로 새로 만든다. 변경 이력에는 바뀌었다는 사실만 남긴다(값 없음).
export const GET = handle(async (request: NextRequest) => {
  const me = await requireAgent(request);
  const [row] = await sql<{ has: boolean }[]>`select password_hash is not null as has from agents where id = ${me.id}`;
  return json({ hasPassword: row?.has ?? false, passwordLogin: await passwordLoginEnabled() });
});

export const PUT = handle(async (request: NextRequest) => {
  const me = await requireAgent(request);
  await rateLimit(`password:${me.id}`, 10, 300);
  const { current, next } = await parseBody(request, Body);
  const [row] = await sql<{ password_hash: string | null }[]>`select password_hash from agents where id = ${me.id}`;
  const had = !!row?.password_hash;
  if (had && !(current && verifyPassword(current, row.password_hash!))) throw new HttpError(400, "wrong_current");
  if (had && current === next) throw new HttpError(400, "same_password");
  await sql`update agents set password_hash = ${hashPassword(next)} where id = ${me.id}`;
  await audit(me, {
    area: "security",
    action: "password.change",
    title: had ? "내 비밀번호 변경" : "내 비밀번호 설정",
    changes: [{ label: "비밀번호", before: had ? "있음" : "없음", after: had ? "변경됨" : "설정됨" }],
  });
  return json({ ok: true });
});
