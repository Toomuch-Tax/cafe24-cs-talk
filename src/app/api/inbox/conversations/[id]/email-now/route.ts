import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { sendReplyEmailNow } from "@/lib/jobs";

// 관리자 전용: 대기 중인 답변 메일을 지금 처리 (발송 조건은 평소와 같음)
export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/conversations/[id]/email-now">) => {
  await requireAdmin(request);
  const { id } = await ctx.params;
  return json({ results: await sendReplyEmailNow(id) });
});
