import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { dismissAiReview } from "@/lib/ai-review";
import { handle, json } from "@/lib/http";

// 확인함: 답변 없이 정리
export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/ai/[id]/dismiss">) => {
  const agent = await requireAgent(request);
  const { id } = await ctx.params;
  await dismissAiReview(id, agent.id);
  return json({ ok: true });
});
