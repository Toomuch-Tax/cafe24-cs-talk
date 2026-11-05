import { toCustomerOrder } from "@/lib/cafe24/customer-orders";
import { ordersByMember } from "@/lib/cafe24/orders";
import { sql } from "@/lib/db";
import { resolveEnv } from "@/lib/errors";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/usage";
import { requireVisitorSession } from "@/lib/widget-token";

// 로그인 회원(서버가 Cafe24 서명으로 확인한 회원)의 최근 주문 상태
export const GET = handle(async (request: Request) => {
  const { contactId, env: tokenEnv, memberId } = await requireVisitorSession(request);
  const env = await resolveEnv(tokenEnv);
  await rateLimit(`orders:${contactId}`, 20, 600);
  // 이번 세션에서 회원 JWT 로 확인된 회원만 (contact 에 예전 회원 인증이 남아 있어도 로그아웃 상태면 막는다)
  const [contact] = await sql<{ verified_member_id: string | null }[]>`
    select verified_member_id from contacts where id = ${contactId}`;
  if (!memberId || contact?.verified_member_id !== memberId) throw new HttpError(403, "member_required");
  try {
    const orders = (await ordersByMember(memberId)).slice(0, 5).map(toCustomerOrder);
    await sql`insert into self_service_events (contact_id, kind, result)
      values (${contactId}, 'order_status_member', ${orders.length ? "found" : "not_found"})`;
    track({ name: "order_lookup", actor: "customer", contactId, env, props: { who: "member", result: orders.length ? "found" : "not_found" } });
    return json({ orders });
  } catch (err) {
    await sql`insert into self_service_events (contact_id, kind, result) values (${contactId}, 'order_status_member', 'error')`;
    const code = err instanceof HttpError ? err.message.slice(0, 40) : "internal";
    track({ name: "order_lookup", actor: "customer", contactId, env, props: { who: "member", result: "error", code } });
    throw err;
  }
});
