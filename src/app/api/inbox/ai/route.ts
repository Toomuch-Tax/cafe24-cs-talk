import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { AI_TABS, type AiTab, aiReviewCounts, listAiReview } from "@/lib/ai-review";
import { handle, json } from "@/lib/http";

// 인박스 'AI 응대' 목록. ?count=1 이면 건수만 (사이드바 배지)
export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  const params = new URL(request.url).searchParams;
  const counts = await aiReviewCounts();
  if (params.get("count")) return json({ counts });
  const param = params.get("tab") as AiTab | null;
  const tab: AiTab = param && AI_TABS.includes(param) ? param : "need";
  return json({ tab, counts, items: await listAiReview(tab) });
});
