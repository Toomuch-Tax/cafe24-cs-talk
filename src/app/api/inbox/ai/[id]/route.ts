import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { getAiReview } from "@/lib/ai-review";
import { handle, json } from "@/lib/http";

export const GET = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/ai/[id]">) => {
  await requireAgent(request);
  const { id } = await ctx.params;
  return json({ item: await getAiReview(id) });
});
