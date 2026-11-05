import type postgres from "postgres";
import { z } from "zod";
import { sql } from "./db";

export const ConversationChanges = z.object({
  status: z.enum(["open", "waiting_customer", "resolved"]).optional(),
  assignedAgentId: z.string().uuid().nullable().optional(),
  priority: z.enum(["normal", "high", "urgent"]).optional(),
  category: z.enum(["shipping", "exchange", "return", "size", "defect", "restock", "etc"]).nullable().optional(),
});
export type ConversationChanges = z.infer<typeof ConversationChanges>;

// 상태·배정·우선순위·처리유형 변경 (문의 하나 / 여러 개 함께 쓴다). 바뀐 항목마다 conversation_events 에 이력을 남긴다.
// 바뀌기 전 값을 돌려준다 (일괄 처리의 되돌리기용). 없는 문의면 null.
export async function applyConversationChanges(
  tx: postgres.TransactionSql,
  agentId: string,
  id: string,
  body: ConversationChanges,
) {
  const [cur] = await tx`select * from conversations where id = ${id} for update`;
  if (!cur) return null;

  const changes: { type: string; from: unknown; to: unknown }[] = [];
  if (body.status !== undefined && body.status !== cur.status) {
    changes.push({ type: "status", from: cur.status, to: body.status });
    await tx`update conversations set status = ${body.status},
      resolved_at = ${body.status === "resolved" ? sql`now()` : null} where id = ${id}`;
  }
  if (body.assignedAgentId !== undefined && body.assignedAgentId !== cur.assigned_agent_id) {
    changes.push({
      type: "assigned",
      from: cur.assigned_agent_id,
      to: body.assignedAgentId,
    });
    await tx`update conversations set assigned_agent_id = ${body.assignedAgentId} where id = ${id}`;
  }
  if (body.priority !== undefined && body.priority !== cur.priority) {
    changes.push({ type: "priority", from: cur.priority, to: body.priority });
    await tx`update conversations set priority = ${body.priority} where id = ${id}`;
  }
  if (body.category !== undefined && body.category !== cur.category) {
    changes.push({ type: "category", from: cur.category, to: body.category });
    await tx`update conversations set category = ${body.category} where id = ${id}`;
  }
  for (const c of changes) {
    await tx`insert into conversation_events (conversation_id, agent_id, type, data)
      values (${id}, ${agentId}, ${c.type}, ${sql.json({ from: c.from, to: c.to } as never)})`;
  }
  return {
    id,
    status: cur.status as "open" | "waiting_customer" | "resolved",
    assignedAgentId: cur.assigned_agent_id as string | null,
  };
}
