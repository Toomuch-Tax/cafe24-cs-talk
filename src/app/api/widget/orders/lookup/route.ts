import { z } from "zod";
import { sameName, toCustomerOrder } from "@/lib/cafe24/customer-orders";
import { orderById } from "@/lib/cafe24/orders";
import { ORDER_ID } from "@/lib/order-id";
import { sql } from "@/lib/db";
import { resolveEnv } from "@/lib/errors";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/usage";
import { requireVisitorSession } from "@/lib/widget-token";

const Body = z.object({
  orderId: z.string().trim().regex(ORDER_ID),
  name: z.string().trim().min(1).max(50),
});

// 비회원 주문 조회: 주문번호 + 주문자 이름이 모두 맞을 때만 상태·송장을 보여준다 (금액·연락처·주소 제외).
// 무작위 대입을 막기 위해 IP·방문자 단위로 횟수를 제한한다.
export const POST = handle(async (request: Request) => {
  const { contactId, env: tokenEnv } = await requireVisitorSession(request);
  await rateLimit(`guest_lookup_ip:${clientIp(request)}`, 10, 600);
  await rateLimit(`guest_lookup:${contactId}`, 5, 600);
  const { orderId, name } = await parseBody(request, Body);

  const env = await resolveEnv(tokenEnv);
  const order = await orderById(orderId).catch((err) => {
    if (err instanceof HttpError && err.status === 404) return null;
    const code = err instanceof HttpError ? err.message.slice(0, 40) : "internal";
    track({ name: "order_lookup", actor: "customer", contactId, env, props: { who: "guest", result: "error", code } });
    throw err;
  });
  const match = order && sameName(order.buyerName, name);
  await sql`insert into self_service_events (contact_id, kind, result)
    values (${contactId}, 'order_status_guest', ${match ? "found" : "not_found"})`;
  track({ name: "order_lookup", actor: "customer", contactId, env, props: { who: "guest", result: match ? "found" : "not_found" } });
  // 주문이 없는 경우와 이름이 틀린 경우를 구분하지 않는다 (주문번호 존재 여부 노출 방지)
  if (!match) return json({ order: null });
  return json({ order: toCustomerOrder(order) });
});
