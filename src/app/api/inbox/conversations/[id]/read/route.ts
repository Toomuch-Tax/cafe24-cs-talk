import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { markRead, markUnread } from "@/lib/reads";

type Ctx = RouteContext<"/api/inbox/conversations/[id]/read">;

// 문의를 열면 나에게만 읽음
export const POST = handle(async (request: NextRequest, ctx: Ctx) => {
  const agent = await requireAgent(request);
  const { id } = await ctx.params;
  await markRead(agent.id, id);
  return json({ ok: true });
});

// 안 읽음으로 표시 (나에게만)
export const DELETE = handle(async (request: NextRequest, ctx: Ctx) => {
  const agent = await requireAgent(request);
  const { id } = await ctx.params;
  await markUnread(agent.id, id);
  return json({ ok: true });
});
