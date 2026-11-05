import type { NextRequest } from "next/server";
import { draftForAgent } from "@/lib/ai/engine";
import { requireAgent } from "@/lib/auth";
import { toCustomerOrder } from "@/lib/cafe24/customer-orders";
import { ordersByMember } from "@/lib/cafe24/orders";
import { describeProduct, productContext, productNoFromUrl } from "@/lib/cafe24/products";
import { sql } from "@/lib/db";
import { captureError } from "@/lib/errors";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

// 상담원 "AI 초안": 대화 + (확인된 회원이면) 주문 상태 + 보던 상품 + 정책으로 초안을 만든다.
// 고객 이름·연락처·주소는 AI 에 넘기지 않는다.
export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/conversations/[id]/ai-draft">) => {
  const agent = await requireAgent(request);
  await rateLimit(`ai_draft:${agent.id}`, 30, 600);
  const { id } = await ctx.params;
  const [conv] = await sql<{ page_url: string | null; order_ref: string | null; category: string | null; verified_member_id: string | null }[]>`
    select c.page_url, c.order_ref, c.category, ct.verified_member_id
    from conversations c join contacts ct on ct.id = c.contact_id where c.id = ${id}`;
  if (!conv) throw new HttpError(404, "not_found");
  const msgs = await sql<{ sender_type: string; body: string }[]>`
    select sender_type, body from messages
    where conversation_id = ${id} and not internal and sender_type in ('customer', 'agent')
    order by seq desc limit 12`;
  if (!msgs.length) throw new HttpError(400, "empty_conversation");
  const history = msgs
    .reverse()
    .map((m) => `${m.sender_type === "customer" ? "고객" : "상담원"}: ${m.body}`)
    .join("\n");

  let orders = "없음 (확인된 회원이 아님)";
  if (conv.verified_member_id) {
    try {
      const list = (await ordersByMember(conv.verified_member_id)).slice(0, 3).map(toCustomerOrder);
      orders = list.length
        ? list.map((o) => `${o.orderId} (${o.orderDate}): ` + o.items.map((i) => `${i.name}${i.option ? ` ${i.option}` : ""} — ${i.status}${i.trackingNo ? `, 송장 ${i.shippingCompany} ${i.trackingNo}` : ""}`).join("; ")).join("\n")
        : "최근 3개월 주문 없음";
    } catch (err) {
      captureError({ source: "external", where: "ai-draft orders", area: "order", err });
      orders = "조회 실패";
    }
  }
  const productNo = productNoFromUrl(conv.page_url);
  const product = productNo ? await productContext(productNo) : null;
  const lastCustomer = [...msgs].reverse().find((m) => m.sender_type === "customer")?.body ?? "";

  const context = `# 상담 내용 (오래된 순)
${history}

# 문의 유형: ${conv.category ?? "미정"} / 고객이 적은 주문번호: ${conv.order_ref ?? "없음"}
# 고객 최근 주문 상태
${orders}
# 고객이 보던 상품
${product ? describeProduct(product) : "없음"}

마지막 고객 메시지에 대한 상담원 답변 초안을 써줘.`;
  const r = await draftForAgent({ conversationId: id, agentId: agent.id, context, question: lastCustomer, productNo });
  return json(r);
});
