import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { applyConversationChanges, ConversationChanges } from "@/lib/conversation-changes";
import { sql } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/http";
import { markRead, markUnread } from "@/lib/reads";

// 목록에서 여러 문의를 골라 한 번에 처리 (목록 최대 200건과 같은 한도)
const Bulk = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  changes: ConversationChanges.optional(),
  // 읽음·안 읽음은 나에게만
  read: z.boolean().optional(),
});

export const POST = handle(async (request: NextRequest) => {
  const agent = await requireAgent(request);
  const { ids, changes, read } = await parseBody(request, Bulk);
  const unique = [...new Set(ids)];

  // 문의마다 이력이 남고, 하나라도 실패하면 모두 되돌린다. 잠금 순서를 고정해 다른 요청과 엇갈려 막히지 않게 한다.
  const before = changes
    ? await sql.begin(async (tx) => {
        const out = [];
        for (const id of [...unique].sort()) {
          const prev = await applyConversationChanges(tx, agent.id, id, changes);
          if (prev) out.push(prev);
        }
        return out;
      })
    : [];
  if (read !== undefined) {
    for (const id of unique) await (read ? markRead(agent.id, id) : markUnread(agent.id, id));
  }
  return json({ ok: true, before });
});
