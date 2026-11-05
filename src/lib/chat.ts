import { attachmentPreview, claimUploads, withAttachmentUrls } from "./attachments";
import { notifyFollowUp, notifyNewInquiry, notifyNudge } from "./alerts";
import { sql } from "./db";
import { HttpError } from "./http";

export type MessageRow = {
  id: string;
  seq: number;
  conversation_id: string;
  sender_type: "customer" | "agent" | "ai" | "system";
  agent_id: string | null;
  agent_name: string | null;
  body: string;
  attachments: unknown[];
  internal: boolean;
  ai_kind: "auto_sent" | "draft" | null;
  client_message_id: string | null;
  created_at: string;
};

const PREVIEW_LENGTH = 80;
const preview = (body: string, attachments: { type: string }[] = []) =>
  body.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LENGTH) || attachmentPreview(attachments);

// seq 는 bigint 라 postgres.js 가 문자열로 돌려준다 → 클라이언트 편의를 위해 숫자로 변환.
// 첨부는 저장 키 대신 짧은 서명 URL 로 바꿔 내려준다.
const normalize = <T extends { seq: number | string; attachments: unknown }>(rows: T[]) =>
  withAttachmentUrls(rows.map((r) => ({ ...r, seq: Number(r.seq) })));

export async function findActiveConversation(contactId: string) {
  const [conv] = await sql<{ id: string; status: string }[]>`
    select id, status from conversations
    where contact_id = ${contactId} and status <> 'resolved'
    order by created_at desc limit 1`;
  return conv ?? null;
}

// 고객에게 보여줄 메시지: 내부 메모·AI 초안 제외.
// 상담원 실명·ID 는 내려주지 않는다 → 고객 화면은 설정의 '고객 노출 정보'(이름·로고) 하나로만 보인다.
export async function listCustomerMessages(conversationId: string, afterSeq = 0) {
  const rows = await sql<MessageRow[]>`
    select m.id, m.seq, m.conversation_id, m.sender_type, null::uuid as agent_id, null::text as agent_name,
           m.body, m.attachments, m.internal, m.ai_kind, m.client_message_id, m.created_at
    from messages m
    where m.conversation_id = ${conversationId} and m.seq > ${afterSeq}
      and not m.internal and (m.ai_kind is null or m.ai_kind <> 'draft')
    order by m.seq limit 200`;
  return normalize(rows);
}

export async function listAgentMessages(conversationId: string, afterSeq = 0) {
  const rows = await sql<MessageRow[]>`
    select m.id, m.seq, m.conversation_id, m.sender_type, m.agent_id, a.name as agent_name,
           m.body, m.attachments, m.internal, m.ai_kind, m.client_message_id, m.created_at
    from messages m left join agents a on a.id = m.agent_id
    where m.conversation_id = ${conversationId} and m.seq > ${afterSeq}
    order by m.seq limit 500`;
  return normalize(rows);
}

async function selectMessage(tx: typeof sql, id: string) {
  const [row] = await tx<MessageRow[]>`
    select m.id, m.seq, m.conversation_id, m.sender_type, m.agent_id, a.name as agent_name,
           m.body, m.attachments, m.internal, m.ai_kind, m.client_message_id, m.created_at
    from messages m left join agents a on a.id = m.agent_id where m.id = ${id}`;
  return (await normalize([row]))[0];
}

export const CATEGORIES = ["shipping", "exchange", "return", "size", "defect", "restock", "etc"] as const;
export type Category = (typeof CATEGORIES)[number];

// "문의 남기기": 항상 새 문의(대화)를 만든다. 같은 clientMessageId 로 재시도하면 기존 문의를 돌려준다.
export async function createInquiry(
  contactId: string,
  input: {
    clientMessageId: string;
    body: string;
    category: Category;
    orderRef?: string | null;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
    pageUrl?: string | null;
    attachments?: string[];
  },
) {
  const result = await sql.begin(async (tx) => {
    await tx`select id from contacts where id = ${contactId} for update`;
    const [existing] = await tx<{ id: string; conversation_id: string }[]>`
      select m.id, m.conversation_id from messages m join conversations c on c.id = m.conversation_id
      where c.contact_id = ${contactId} and m.client_message_id = ${input.clientMessageId} limit 1`;
    if (existing) return { conversationId: existing.conversation_id, messageId: existing.id, duplicate: true };

    if (input.email) await tx`update contacts set email = ${input.email} where id = ${contactId}`;
    // 이름·휴대폰은 비어 있을 때만 채운다 (상담원이 고친 값을 덮어쓰지 않게)
    if (input.name || input.phone)
      await tx`update contacts set name = coalesce(name, ${input.name ?? null}), phone = coalesce(phone, ${input.phone ?? null})
        where id = ${contactId}`;
    const [conv] = await tx<{ id: string }[]>`
      insert into conversations (contact_id, page_url, category, order_ref, submitted_at,
        last_message_at, last_message_preview, last_customer_message_at, customer_last_read_at)
      values (${contactId}, ${input.pageUrl ?? null}, ${input.category}, ${input.orderRef ?? null}, now(),
        now(), ${preview(input.body)}, now(), now())
      returning id`;
    await tx`insert into conversation_events (conversation_id, type, data)
      values (${conv.id}, 'created', ${sql.json({ category: input.category })})`;
    const [msg] = await tx<{ id: string }[]>`
      insert into messages (conversation_id, sender_type, body, client_message_id)
      values (${conv.id}, 'customer', ${input.body}, ${input.clientMessageId}) returning id`;
    await claimUploads(tx, contactId, msg.id, input.attachments ?? []);
    return { conversationId: conv.id, messageId: msg.id, duplicate: false };
  });
  if (!result.duplicate) {
    await notifyNewInquiry({
      id: result.conversationId,
      messageId: result.messageId,
      category: input.category,
      body: input.body,
    });
  }
  return { ...result, message: await selectMessage(sql, result.messageId) };
}

// 기존 문의에 이어서 질문 (위젯 "내 문의" 또는 이메일 링크). 종료된 문의도 다시 연다.
export async function replyToInquiry(
  contactId: string,
  conversationId: string,
  input: { clientMessageId: string; body: string; attachments?: string[] },
) {
  const result = await sql.begin(async (tx) => {
    const [conv] = await tx<{ id: string; status: string }[]>`
      select id, status from conversations
      where id = ${conversationId} and contact_id = ${contactId} and submitted_at is not null
      for update`;
    if (!conv) throw new HttpError(404, "not_found");

    const [inserted] = await tx<{ id: string }[]>`
      insert into messages (conversation_id, sender_type, body, client_message_id)
      values (${conversationId}, 'customer', ${input.body}, ${input.clientMessageId})
      on conflict (conversation_id, client_message_id) do nothing
      returning id`;
    if (!inserted) {
      const [existing] = await tx<{ id: string }[]>`
        select id from messages where conversation_id = ${conversationId} and client_message_id = ${input.clientMessageId}`;
      return { messageId: existing.id, duplicate: true, prevStatus: conv.status };
    }
    const attached = await claimUploads(tx, contactId, inserted.id, input.attachments ?? []);
    if (conv.status === "resolved") {
      await tx`insert into conversation_events (conversation_id, type) values (${conversationId}, 'reopened_by_customer')`;
    }
    await tx`
      update conversations set status = 'open', last_message_at = now(), last_message_preview = ${preview(input.body, attached)},
        last_customer_message_at = now(), customer_last_read_at = now(), resolved_at = null
      where id = ${conversationId}`;
    return { messageId: inserted.id, duplicate: false, prevStatus: conv.status };
  });
  // 답변을 기다리는 중(open)에 또 남기면 재촉 알림(문의당 30분에 한 번), 답변 후에 남기면 추가 문의 알림
  if (!result.duplicate) {
    if (result.prevStatus === "open") await notifyNudge({ id: conversationId, messageId: result.messageId });
    else
      await notifyFollowUp({
        id: conversationId,
        messageId: result.messageId,
        reopened: result.prevStatus === "resolved",
        body: input.body,
      });
  }

  return { ...result, message: await selectMessage(sql, result.messageId) };
}

// 고객이 직접 상담을 종료 (위젯 "상담 종료"). 이미 종료된 문의면 그대로 둔다.
export async function closeByCustomer(contactId: string, conversationId: string) {
  return sql.begin(async (tx) => {
    const [conv] = await tx<{ status: string }[]>`
      select status from conversations
      where id = ${conversationId} and contact_id = ${contactId} and submitted_at is not null
      for update`;
    if (!conv) throw new HttpError(404, "not_found");
    if (conv.status === "resolved") return conv.status;
    await tx`update conversations set status = 'resolved', resolved_at = now() where id = ${conversationId}`;
    await tx`insert into conversation_events (conversation_id, type, data)
      values (${conversationId}, 'closed_by_customer', ${tx.json({ from: conv.status })})`;
    return "resolved";
  });
}

// 고객이 접수한 문의 목록 (위젯 "내 문의")
export async function listInquiries(contactId: string) {
  return sql<
    { id: string; status: string; category: string | null; created_at: string; last_message_at: string;
      last_message_preview: string | null; has_new_reply: boolean }[]
  >`
    select id, status, category, created_at, last_message_at, last_message_preview,
      (last_agent_reply_at is not null and last_agent_reply_at > coalesce(customer_last_read_at, 'epoch')) as has_new_reply
    from conversations
    where contact_id = ${contactId} and submitted_at is not null
    order by last_message_at desc limit 30`;
}

export async function postAgentMessage(
  conversationId: string,
  agentId: string,
  input: {
    clientMessageId: string;
    body: string;
    internal: boolean;
    lastSeenSeq?: number;
    force?: boolean;
    attachments?: string[];
  },
) {
  const result = await sql.begin(async (tx) => {
    const [conv] = await tx<
      { id: string; contact_id: string; assigned_agent_id: string | null; first_agent_reply_at: Date | null }[]
    >`
      select id, contact_id, assigned_agent_id, first_agent_reply_at from conversations where id = ${conversationId} for update`;
    if (!conv) throw new HttpError(404, "not_found");

    // 동시 응답 방지: 내가 마지막으로 본 이후 다른 상담원이 고객에게 답했으면 확인을 받는다
    if (!input.internal && !input.force && input.lastSeenSeq !== undefined) {
      const [other] = await tx<{ name: string }[]>`
        select a.name from messages m join agents a on a.id = m.agent_id
        where m.conversation_id = ${conversationId} and m.seq > ${input.lastSeenSeq}
          and m.sender_type = 'agent' and not m.internal and m.agent_id <> ${agentId}
        order by m.seq desc limit 1`;
      if (other) throw new HttpError(409, `other_agent_replied:${other.name}`);
    }

    const [inserted] = await tx<{ id: string }[]>`
      insert into messages (conversation_id, sender_type, agent_id, body, internal, client_message_id)
      values (${conversationId}, 'agent', ${agentId}, ${input.body}, ${input.internal}, ${input.clientMessageId})
      on conflict (conversation_id, client_message_id) do nothing
      returning id`;
    if (!inserted) {
      const [existing] = await tx<{ id: string }[]>`
        select id from messages where conversation_id = ${conversationId} and client_message_id = ${input.clientMessageId}`;
      return { messageId: existing.id, duplicate: true, firstReply: false };
    }
    const attached = await claimUploads(tx, conv.contact_id, inserted.id, input.attachments ?? [], agentId);

    if (!input.internal) {
      if (!conv.assigned_agent_id) {
        await tx`
          insert into conversation_events (conversation_id, agent_id, type, data)
          values (${conversationId}, ${agentId}, 'assigned', ${sql.json({ to: agentId, auto: true })})`;
      }
      await tx`
        update conversations set
          status = 'waiting_customer',
          handling_mode = 'human',
          last_agent_reply_at = now(),
          assigned_agent_id = coalesce(assigned_agent_id, ${agentId}),
          last_message_at = now(),
          last_message_preview = ${preview(input.body, attached)},
          first_agent_reply_at = coalesce(first_agent_reply_at, now()),
          agent_last_read_at = now(),
          typing_agent_id = null,
          typing_at = null,
          resolved_at = null
        where id = ${conversationId}`;
    }
    return { messageId: inserted.id, duplicate: false, firstReply: !input.internal && !conv.first_agent_reply_at };
  });

  return { ...result, message: await selectMessage(sql, result.messageId) };
}
