import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { fillMemberContact } from "@/lib/cafe24/customers";
import { ordersByMember } from "@/lib/cafe24/orders";
import { sql } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";

// Cafe24 서명으로 확인된 회원의 최근 3개월 주문. 확인되지 않은 고객은 조회하지 않는다.
export const GET = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/contacts/[id]/orders">) => {
  const agent = await requireAgent(request);
  const { id } = await ctx.params;
  const conversationId = new URL(request.url).searchParams.get("conversationId");

  const [contact] = await sql<{ verified_member_id: string | null; name: string | null; phone: string | null }[]>`
    select verified_member_id, name, phone from contacts where id = ${id}`;
  if (!contact) throw new HttpError(404, "not_found");
  if (!contact.verified_member_id) return json({ verified: false, orders: [] });

  // 이전에 접수된 회원 문의도 연락처 칸이 비어 있으면 회원 정보로 채운다 (화면이 다시 불러오도록 알려줌)
  const [orders, contactFilled] = await Promise.all([
    ordersByMember(contact.verified_member_id),
    !contact.name || !contact.phone ? fillMemberContact(id, contact.verified_member_id) : false,
  ]);
  if (conversationId) {
    await sql`insert into conversation_events (conversation_id, agent_id, type, data)
      select ${conversationId}, ${agent.id}, 'order_lookup', ${sql.json({ by: "member", count: orders.length })}
      where exists (select 1 from conversations where id = ${conversationId} and contact_id = ${id})`;
  }
  return json({ verified: true, memberId: contact.verified_member_id, orders, contactFilled });
});
