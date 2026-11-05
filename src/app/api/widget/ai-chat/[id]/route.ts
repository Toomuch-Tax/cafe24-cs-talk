import { chatForWidget, endChat, pollChat } from "@/lib/ai-chat";
import { isFeatureOn } from "@/lib/features";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { requireVisitorSession } from "@/lib/widget-token";

type Ctx = RouteContext<"/api/widget/ai-chat/[id]">;

// AI 대화 상태. 위젯이 대화 화면을 열어 두고 화면에 보일 때만 몇 초마다 부른다 (?poll=1).
// 담당자가 참여하면 conversationId 가 생기고, 위젯은 그 문의의 메시지를 이어서 보여준다.
// poll 없이 부르면 문답 전체 (다른 페이지로 옮겨 위젯이 새로 열렸을 때 이어가기)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const { contactId, env } = await requireVisitorSession(request);
  if (!isFeatureOn("aiChat", env)) throw new HttpError(404, "not_found");
  await rateLimit(`aichat:${contactId}`, 40, 60);
  const { id } = await ctx.params;
  if (new URL(request.url).searchParams.get("poll")) return json(await pollChat(contactId, id));
  return json(await chatForWidget(contactId, id));
});

// 고객이 "상담 종료"를 눌렀을 때: 인박스 'AI 응대'에서 바로 '대화 중'이 꺼지게 한다
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const { contactId, env } = await requireVisitorSession(request);
  if (!isFeatureOn("aiChat", env)) throw new HttpError(404, "not_found");
  await rateLimit(`aichat:${contactId}`, 40, 60);
  const { id } = await ctx.params;
  await endChat(contactId, id);
  return json({ ok: true });
});
