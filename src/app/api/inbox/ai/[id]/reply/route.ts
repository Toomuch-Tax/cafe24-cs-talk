import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { replyFromAi } from "@/lib/ai-review";
import { emailEnabled } from "@/lib/email";
import { handle, json, parseBody } from "@/lib/http";
import { enqueueReplyEmail } from "@/lib/jobs";

const Body = z.object({
  clientMessageId: z.string().min(8).max(64),
  body: z.string().trim().min(1).max(4000),
});

// 답변 남기기: AI 문답을 고객의 문의로 만들고 답변을 붙인다 (메일은 평소 답변과 같은 조건으로 예약)
export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/ai/[id]/reply">) => {
  const agent = await requireAgent(request);
  const { id } = await ctx.params;
  const body = await parseBody(request, Body);
  const result = await replyFromAi(id, agent.id, body);
  if (!result.duplicate && emailEnabled()) await enqueueReplyEmail(result.conversationId, result.message.id);
  return json({ conversationId: result.conversationId });
});
