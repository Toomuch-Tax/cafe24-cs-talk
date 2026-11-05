import type { NextRequest } from "next/server";
import { avatarColumns } from "@/lib/agent-avatar";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, json } from "@/lib/http";

const VIEWS = ["open", "waiting", "resolved"] as const;
type View = (typeof VIEWS)[number];

// 인박스 목록. 읽음은 상담원마다 따로(conversation_reads), 고객 확인은 customer_last_read_at 기준.
// q 가 있으면 탭·필터와 무관하게 전체 기간·모든 상태에서 찾는다 (이름·회원 아이디·주문번호·이메일·휴대폰·모든 메시지 내용).
export const GET = handle(async (request: NextRequest) => {
  const agent = await requireAgent(request);
  const params = new URL(request.url).searchParams;
  const param = params.get("view") as View | null;
  const view: View = param && VIEWS.includes(param) ? param : "open";
  // mine=1: 내가 담당인 문의만 / unassigned=1: 아직 담당자가 없는(아무도 답하지 않은) 문의만
  const mine = params.get("mine") === "1";
  const unassigned = params.get("unassigned") === "1";
  const unreadOnly = params.get("unread") === "1";
  // stale=1: 답변을 보낸 지 하루가 넘었는데 고객이 아직 안 읽은 문의 (응대 중 탭)
  const stale = params.get("stale") === "1";
  const q = (params.get("q") ?? "").trim().slice(0, 100);

  const owner = mine ? sql`and c.assigned_agent_id = ${agent.id}` : sql``;
  const myRead = sql`coalesce((select r.last_read_at from conversation_reads r
    where r.agent_id = ${agent.id} and r.conversation_id = c.id), 'epoch')`;
  const unreadExpr = sql`(c.last_customer_message_at is not null and c.last_customer_message_at > ${myRead})`;
  const customerUnreadExpr = sql`(c.last_agent_reply_at is not null
    and c.last_agent_reply_at > coalesce(c.customer_last_read_at, 'epoch'))`;

  const columns = sql`
    c.id, c.status, c.handling_mode, c.assigned_agent_id, a.name as assigned_agent_name,
    ${avatarColumns("a", "assigned_agent_")},
    c.priority, c.category, c.last_message_at, c.last_message_preview, c.created_at,
    c.last_customer_message_at, c.order_ref, c.last_agent_reply_at,
    c.contact_id, ct.name as contact_name, ct.cafe24_member_id_hint, ct.verified_member_id,
    ${unreadExpr} as unread, ${customerUnreadExpr} as customer_unread,
    exists (select 1 from ai_answers ai where ai.conversation_id = c.id and ai.kind = 'customer_answer') as from_ai`;

  const [counts] = await sql`
    select
      count(*) filter (where c.status = 'open')::int as open,
      count(*) filter (where c.status = 'waiting_customer')::int as waiting
    from conversations c where c.submitted_at is not null ${owner}`;
  // 탭 제목·사이드바 표시: 보고 있는 탭·필터와 무관하게 '답변 필요 중 내가 안 읽은 문의'
  const [mineUnread] = await sql<{ n: number }[]>`
    select count(*)::int as n from conversations c
    where c.submitted_at is not null and c.status = 'open' and ${unreadExpr}`;

  if (q.length >= 2) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const digits = q.replace(/\D/g, "");
    const digitsLike = digits.length >= 4 ? `%${digits}%` : null;
    const conversations = await sql`
      select ${columns},
        case
          when ct.name ilike ${like} then 'name'
          when ct.verified_member_id ilike ${like} or ct.cafe24_member_id_hint ilike ${like} then 'member'
          when c.order_ref ilike ${like}
            or (${digitsLike}::text is not null and regexp_replace(c.order_ref, '\\D', '', 'g') like ${digitsLike}) then 'order'
          when ct.email ilike ${like} then 'email'
          when ${digitsLike}::text is not null and regexp_replace(ct.phone, '\\D', '', 'g') like ${digitsLike} then 'phone'
          else 'message'
        end as match_field,
        hit.body as match_body, hit.sender_type as match_sender,
        ct.email as contact_email, ct.phone as contact_phone
      from conversations c
      join contacts ct on ct.id = c.contact_id
      left join agents a on a.id = c.assigned_agent_id
      left join lateral (
        select m.body, m.sender_type from messages m
        where m.conversation_id = c.id and m.sender_type <> 'system' and m.body ilike ${like}
        order by m.seq desc limit 1
      ) hit on true
      where c.submitted_at is not null and (
        ct.name ilike ${like} or ct.verified_member_id ilike ${like} or ct.cafe24_member_id_hint ilike ${like}
        or c.order_ref ilike ${like} or ct.email ilike ${like}
        or (${digitsLike}::text is not null and (
          regexp_replace(c.order_ref, '\\D', '', 'g') like ${digitsLike}
          or regexp_replace(ct.phone, '\\D', '', 'g') like ${digitsLike}))
        or hit.body is not null)
      order by c.last_message_at desc
      limit 50`;
    return json({ view, mine, q, conversations, counts, mineUnread: mineUnread.n });
  }

  const status = { open: "open", waiting: "waiting_customer", resolved: "resolved" }[view];
  const filters = sql`
    ${unassigned ? sql`and c.assigned_agent_id is null` : sql``}
    ${unreadOnly ? sql`and ${unreadExpr}` : sql``}
    ${stale ? sql`and ${customerUnreadExpr} and c.last_agent_reply_at < now() - interval '24 hours'` : sql``}`;

  const conversations = await sql`
    select ${columns}
    from conversations c
    join contacts ct on ct.id = c.contact_id
    left join agents a on a.id = c.assigned_agent_id
    where c.submitted_at is not null and c.status = ${status} ${owner} ${filters}
    -- 답변 필요 문의는 오래 기다린 순서대로, 나머지는 최근 순
    order by case c.priority when 'urgent' then 0 when 'high' then 1 else 2 end,
             case when c.status = 'open' then extract(epoch from c.last_customer_message_at) end asc nulls last,
             c.last_message_at desc
    limit 200`;

  return json({ view, mine, q, conversations, counts, mineUnread: mineUnread.n });
});
