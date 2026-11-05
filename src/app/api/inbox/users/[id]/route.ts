import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit, diff } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { ROLE_LABEL, STATUS_LABEL, updateUser } from "@/lib/users";

type Ctx = RouteContext<"/api/inbox/users/[id]">;

const Patch = z
  .object({
    name: z.string().trim().min(1).max(40),
    role: z.enum(["admin", "agent"]),
    status: z.enum(["active", "disabled"]),
  })
  .partial();

export const PATCH = handle(async (request: NextRequest, ctx: Ctx) => {
  const me = await requireAdmin(request);
  const { id } = await ctx.params;
  const patch = await parseBody(request, Patch);
  const before = await updateUser(me.id, id, patch);
  const changes = diff([
    { label: "이름", before: before.name, after: patch.name ?? before.name },
    { label: "권한", before: ROLE_LABEL[before.role], after: ROLE_LABEL[patch.role ?? before.role] },
    { label: "상태", before: STATUS_LABEL[before.status], after: STATUS_LABEL[patch.status ?? before.status] },
  ]);
  const verb =
    patch.status && patch.status !== before.status
      ? before.status === "pending"
        ? "승인"
        : patch.status === "disabled"
          ? "정지"
          : "다시 활성화"
      : patch.role && patch.role !== before.role
        ? "권한 변경"
        : "정보 변경";
  await audit(me, { area: "users", action: `users.update`, title: `${before.name} 님 ${verb}`, changes, skipIfEmpty: true });
  return json({ ok: true });
});

// 삭제는 승인 대기(거절)나 한 번도 로그인하지 않은 미리 등록 계정만. 일한 기록이 있는 계정은 비활성화한다.
export const DELETE = handle(async (request: NextRequest, ctx: Ctx) => {
  const me = await requireAdmin(request);
  const { id } = await ctx.params;
  if (id === me.id) throw new HttpError(409, "cannot_change_self");
  const [row] = await sql<{ name: string; email: string; status: string }[]>`
    delete from agents where id = ${id} and (status = 'pending' or (last_login_at is null and password_hash is null))
    returning name, email, status`;
  if (!row) throw new HttpError(409, "has_history");
  const rejected = row.status === "pending";
  await audit(me, {
    area: "users",
    action: rejected ? "users.reject" : "users.delete",
    title: `${row.name} 님 ${rejected ? "접속 요청 거절" : "삭제"}`,
    changes: [{ label: "계정", after: row.email }],
  });
  return json({ ok: true });
});
