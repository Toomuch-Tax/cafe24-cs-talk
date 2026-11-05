import { listChats } from "@/lib/ai-chat";
import { isFeatureOn } from "@/lib/features";
import { handle, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { requireVisitorSession } from "@/lib/widget-token";

// 위젯 '대화' 탭의 AI 대화 목록. 고객이 대화 탭을 열 때만 부른다 (위젯을 열기 전에는 호출 없음)
export const GET = handle(async (request: Request) => {
  const { contactId, env } = await requireVisitorSession(request);
  if (!isFeatureOn("aiChat", env)) return json({ chats: [] });
  await rateLimit(`aichat_list:${contactId}`, 30, 60);
  return json({ chats: await listChats(contactId) });
});
