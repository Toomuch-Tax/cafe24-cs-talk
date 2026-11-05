import type { NextRequest } from "next/server";
import { z } from "zod";
import { allowedDomains, isAllowedEmail } from "@/lib/access";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { listUsers, ROLE_LABEL } from "@/lib/users";

// 미리 등록: 이메일·이름·권한을 넣어 두면 그 사람이 구글로 처음 로그인할 때 바로 들어온다 (승인 대기 없음)
const Body = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(40),
  role: z.enum(["admin", "agent"]),
});

export const GET = handle(async (request: NextRequest) => {
  const me = await requireAdmin(request);
  return json({ users: await listUsers(), me: me.id, domains: allowedDomains() });
});

export const POST = handle(async (request: NextRequest) => {
  const me = await requireAdmin(request);
  const b = await parseBody(request, Body);
  if (!isAllowedEmail(b.email)) throw new HttpError(400, "domain_not_allowed");
  const [row] = await sql<{ id: string }[]>`
    insert into agents (email, name, role, status, invited_by)
    values (${b.email}, ${b.name}, ${b.role}, 'active', ${me.id})
    on conflict (email) do nothing returning id`;
  if (!row) throw new HttpError(409, "already_exists");
  await audit(me, {
    area: "users",
    action: "users.invite",
    title: `${b.name} 님 미리 등록`,
    changes: [
      { label: "계정", after: b.email },
      { label: "권한", after: ROLE_LABEL[b.role] },
    ],
  });
  return json({ id: row.id });
});
