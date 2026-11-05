import type { NextRequest } from "next/server";
import { z } from "zod";
import { MAX_PER_MESSAGE } from "@/lib/attachments";
import { requireAgent } from "@/lib/auth";
import { listAgentMessages, postAgentMessage } from "@/lib/chat";
import { sql } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/http";
import { emailEnabled } from "@/lib/email";
import { enqueueReplyEmail } from "@/lib/jobs";
import { markRead } from "@/lib/reads";
import { track } from "@/lib/usage";

type Ctx = RouteContext<"/api/inbox/conversations/[id]/messages">;

export const GET = handle(async (request: NextRequest, ctx: Ctx) => {
  await requireAgent(request);
  const { id } = await ctx.params;
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const [state] = await sql`
    select c.status, c.assigned_agent_id, c.customer_last_read_at, a.name as typing_agent_name, c.typing_agent_id,
           (c.typing_at > now() - interval '8 seconds') as someone_typing
    from conversations c left join agents a on a.id = c.typing_agent_id where c.id = ${id}`;
  return json({ messages: await listAgentMessages(id, after), state: state ?? null });
});

// 사진만 보내는 것도 허용 (내용 또는 사진 중 하나는 있어야 함)
const Body = z
  .object({
    clientMessageId: z.string().min(8).max(64),
    body: z.string().trim().max(4000),
    // 업로드(/api/inbox/conversations/[id]/attachments)에서 받은 id. 내가 이 문의에 올린 것인지는 저장할 때 확인한다.
    attachments: z.array(z.string().uuid()).max(MAX_PER_MESSAGE).default([]),
    internal: z.boolean().default(false),
    lastSeenSeq: z.number().int().nonnegative().optional(),
    force: z.boolean().optional(),
    // 행동 기록용 참고값: AI 초안·빠른 답변(매크로)을 불러와 쓴 답변인지 (둘 다일 수 있음)
    compose: z.object({ aiDraft: z.boolean(), macro: z.boolean() }).optional(),
  })
  .refine((r) => r.body.length > 0 || r.attachments.length > 0);

export const POST = handle(async (request: NextRequest, ctx: Ctx) => {
  const agent = await requireAgent(request);
  const { id } = await ctx.params;
  const body = await parseBody(request, Body);
  const result = await postAgentMessage(id, agent.id, body);
  // 답변·메모를 쓴 상담원은 그 문의를 읽은 것
  if (!result.duplicate) await markRead(agent.id, id);
  // 고객에게 보내는 답변이면 이메일을 예약한다. 바로 보내지 않고, 보낼 시각에 고객이 아직 안 읽었으면 그때 발송 (cron)
  if (!body.internal && !result.duplicate && emailEnabled()) await enqueueReplyEmail(id, result.message.id);
  if (!body.internal && !result.duplicate) {
    track({
      name: "reply_sent",
      actor: "agent",
      agentId: agent.id,
      conversationId: id,
      env: process.env.NODE_ENV === "production" ? "live" : "dev",
      props: { first_reply: result.firstReply, ai_draft: Boolean(body.compose?.aiDraft), macro: Boolean(body.compose?.macro) },
    });
  }
  return json({ message: result.message, duplicate: result.duplicate });
});
