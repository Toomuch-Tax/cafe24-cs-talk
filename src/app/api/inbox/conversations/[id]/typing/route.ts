import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, json } from "@/lib/http";

// 상담원 입력 중 표시. 다른 상담원 화면과 고객 위젯 모두 8초간 표시한다.
export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/conversations/[id]/typing">) => {
  const agent = await requireAgent(request);
  const { id } = await ctx.params;
  await sql`update conversations set typing_agent_id = ${agent.id}, typing_at = now() where id = ${id}`;
  return json({ ok: true });
});
