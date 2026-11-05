import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";

// 오류 처리 완료 / 다시 열기. 처리 완료 뒤 같은 오류가 나면 새 행(재발)으로 쌓이고 슬랙으로 다시 알린다.
const Body = z.object({ action: z.enum(["resolve", "reopen"]) });

export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/errors/[id]">) => {
  const agent = await requireAdmin(request);
  const { id } = await ctx.params;
  const { action } = await parseBody(request, Body);
  const [row] = await sql<{ where_: string; message: string }[]>`
    update error_groups set
      resolved_at = ${action === "resolve" ? sql`now()` : null},
      resolved_by = ${action === "resolve" ? agent.id : null}
    where id = ${id} and ${action === "resolve" ? sql`resolved_at is null` : sql`resolved_at is not null`}
      -- 다시 열 때 같은 종류의 미해결 행이 이미 있으면 겹치지 않게 막는다
      and (${action === "resolve"} or not exists (
        select 1 from error_groups o where o.env = error_groups.env and o.fingerprint = error_groups.fingerprint and o.resolved_at is null))
    returning where_, message`;
  if (!row) throw new HttpError(409, "conflict");
  await audit(agent, {
    area: "settings",
    action: action === "resolve" ? "error.resolve" : "error.reopen",
    title: `오류 ${action === "resolve" ? "처리 완료" : "다시 열기"} · ${row.where_}`,
    changes: [{ label: "오류", after: row.message.slice(0, 120) }],
  });
  return json({ ok: true });
});
