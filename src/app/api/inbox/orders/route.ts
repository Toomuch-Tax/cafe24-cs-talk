import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { orderById, ordersByPhone } from "@/lib/cafe24/orders";
import { sql } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

// 상담원 수동 조회 (비회원 문의 등): 주문번호 또는 주문자 휴대폰
export const GET = handle(async (request: NextRequest) => {
  const agent = await requireAgent(request);
  await rateLimit(`order_search:${agent.id}`, 60, 60);
  const params = new URL(request.url).searchParams;
  const orderId = params.get("orderId")?.trim();
  const phone = params.get("phone")?.replace(/[^\d]/g, "");
  const conversationId = params.get("conversationId");

  let orders;
  if (orderId) {
    if (!/^[\w-]{6,40}$/.test(orderId)) throw new HttpError(400, "invalid_order_id");
    const order = await orderById(orderId).catch((err) => {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    });
    orders = order ? [order] : [];
  } else if (phone) {
    if (phone.length < 10 || phone.length > 11) throw new HttpError(400, "invalid_phone");
    orders = await ordersByPhone(phone);
  } else {
    throw new HttpError(400, "missing_query");
  }

  if (conversationId) {
    await sql`insert into conversation_events (conversation_id, agent_id, type, data)
      select ${conversationId}, ${agent.id}, 'order_lookup',
        ${sql.json({ by: orderId ? "order_id" : "phone", count: orders.length })}
      where exists (select 1 from conversations where id = ${conversationId})`;
  }
  return json({ orders });
});
