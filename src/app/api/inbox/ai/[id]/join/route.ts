import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { joinAiChat } from "@/lib/ai-review";
import { handle, json } from "@/lib/http";

// 대화 참여: 고객이 AI 와 대화 중인 대화를 문의로 바꿔 내 담당으로 둔다 (그 뒤 AI 는 이 대화에서 답하지 않음).
// 답은 문의 화면에서 쓰고, 고객 위젯은 몇 초 안에 받아 보여준다.
export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/ai/[id]/join">) => {
  const agent = await requireAgent(request);
  const { id } = await ctx.params;
  return json({ conversationId: await joinAiChat(id, agent.id) });
});
