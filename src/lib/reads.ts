import { sql } from "./db";

// 상담원별 읽음 (conversation_reads). 문의를 열거나 답변을 보내면 그 상담원에게만 읽음이 된다.
// conversations.agent_last_read_at 은 "누군가 읽은 시각"으로 함께 갱신만 한다 (예전 코드 호환).
export async function markRead(agentId: string, conversationId: string) {
  await sql`
    insert into conversation_reads (agent_id, conversation_id, last_read_at)
    values (${agentId}, ${conversationId}, now())
    on conflict (agent_id, conversation_id) do update set last_read_at = excluded.last_read_at`;
  await sql`update conversations set agent_last_read_at = now() where id = ${conversationId}`;
}

// 안 읽음으로 표시: 마지막 고객 메시지 바로 앞까지만 읽은 것으로 되돌린다 (다른 상담원에게는 영향 없음)
export async function markUnread(agentId: string, conversationId: string) {
  await sql`
    insert into conversation_reads (agent_id, conversation_id, last_read_at)
    select ${agentId}, ${conversationId}, coalesce(max(m.created_at), now()) - interval '1 millisecond'
    from messages m where m.conversation_id = ${conversationId} and m.sender_type = 'customer'
    on conflict (agent_id, conversation_id) do update set last_read_at = excluded.last_read_at`;
}
