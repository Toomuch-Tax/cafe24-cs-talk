import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { aiOriginOf } from "@/lib/ai-review";
import { listAgentMessages } from "@/lib/chat";
import { applyConversationChanges, ConversationChanges } from "@/lib/conversation-changes";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";

type Ctx = RouteContext<"/api/inbox/conversations/[id]">;

export const GET = handle(async (request: NextRequest, ctx: Ctx) => {
  await requireAgent(request);
  const { id } = await ctx.params;
  // 잘리거나 잘못 붙여넣은 공유 링크(/inbox?c=…)는 DB 오류 대신 '찾을 수 없음'
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "not_found");
  const [conversation] = await sql`
    select c.*, a.name as assigned_agent_name, ta.name as typing_agent_name,
           (c.typing_at > now() - interval '8 seconds') as someone_typing
    from conversations c
    left join agents a on a.id = c.assigned_agent_id
    left join agents ta on ta.id = c.typing_agent_id
    where c.id = ${id}`;
  if (!conversation) throw new HttpError(404, "not_found");

  const [contact] = await sql`select * from contacts where id = ${conversation.contact_id}`;
  const history = await sql`
    select id, status, category, created_at, last_message_preview from conversations
    where contact_id = ${conversation.contact_id} and id <> ${id}
    order by created_at desc limit 20`;
  const events = await sql`
    select e.type, e.data, e.created_at, a.name as agent_name
    from conversation_events e left join agents a on a.id = e.agent_id
    where e.conversation_id = ${id} order by e.created_at`;

  return json({ conversation, contact, history, events, aiOrigin: await aiOriginOf(id), messages: await listAgentMessages(id) });
});

// 상태·배정·우선순위·처리유형 변경 (src/lib/conversation-changes.ts)
export const PATCH = handle(async (request: NextRequest, ctx: Ctx) => {
  const agent = await requireAgent(request);
  const { id } = await ctx.params;
  const body = await parseBody(request, ConversationChanges);
  const done = await sql.begin((tx) => applyConversationChanges(tx, agent.id, id, body));
  if (!done) throw new HttpError(404, "not_found");
  return json({ ok: true });
});
