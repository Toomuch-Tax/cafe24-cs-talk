import { closeByCustomer } from "@/lib/chat";
import { handle, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { requireVisitor } from "@/lib/widget-token";

type Ctx = RouteContext<"/api/widget/inquiries/[id]/close">;

// 고객이 위젯에서 "상담 종료"를 눌렀을 때. 다시 메시지를 남기면 지금처럼 다시 열린다.
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const contactId = await requireVisitor(request);
  await rateLimit(`send:${contactId}`, 20, 60);
  const { id } = await ctx.params;
  return json({ status: await closeByCustomer(contactId, id) });
});
