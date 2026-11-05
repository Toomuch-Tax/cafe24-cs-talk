import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { sql } from "./db";
import type { ErrorEnv } from "./errors";

// 핵심 행동 기록 (usage_events, 0016_ops_insights.sql). 개선 후보의 분모·사용 현황에 쓴다.
// props 는 이벤트별 허용 목록(enum·bool)만 받는다 — 자유 입력·실제 경로·연락처는 넣지 않는다.
// 기록 실패가 원래 요청을 실패시키면 안 되므로 오류는 삼킨다. 몇 건 빠져도 괜찮다.

export const PAGE_TYPES = ["main", "product", "list", "cart", "order", "mypage", "other"] as const;
export const MENUS = ["order", "ai", "inquiry", "restock", "size"] as const;
// 로그인 권하기 (src/components/widget/login-nudge.tsx): 어디서 무엇을 눌렀는지
export const NUDGE_SPOTS = ["inquiry", "orders", "orders_gate", "submitted"] as const;
export const NUDGE_ACTIONS = ["login", "signup", "guest"] as const;

// 위젯이 보내는 이벤트 (/api/widget/events)
export const ClientEvent = z.discriminatedUnion("name", [
  z.object({ name: z.literal("widget_open"), props: z.object({ page_type: z.enum(PAGE_TYPES), member: z.boolean() }).strict() }),
  z.object({ name: z.literal("menu_click"), props: z.object({ menu: z.enum(MENUS) }).strict() }),
  z.object({ name: z.literal("ai_handoff_click"), props: z.object({ from: z.enum(["ai_chat", "ask_ai"]) }).strict() }),
  z.object({ name: z.literal("login_nudge_click"), props: z.object({ at: z.enum(NUDGE_SPOTS), action: z.enum(NUDGE_ACTIONS) }).strict() }),
]);

// 서버에서 남기는 이벤트
type ServerEvent =
  | { name: "order_lookup"; props: { who: "member" | "guest"; result: "found" | "not_found" | "error"; code?: string } }
  | { name: "reply_sent"; props: { first_reply: boolean; ai_draft: boolean; macro: boolean } };

export type UsageRow = {
  eventId?: string;
  occurredAt?: Date;
  actor: "customer" | "agent";
  contactId?: string | null;
  agentId?: string | null;
  conversationId?: string | null;
  env: ErrorEnv;
} & (ServerEvent | z.infer<typeof ClientEvent>);

export async function insertUsage(rows: UsageRow[]) {
  if (!rows.length) return 0;
  try {
    const values = rows.map((r) => ({
      event_id: r.eventId ?? randomUUID(),
      occurred_at: r.occurredAt ?? new Date(),
      actor: r.actor,
      name: r.name,
      contact_id: r.contactId ?? null,
      agent_id: r.agentId ?? null,
      conversation_id: r.conversationId ?? null,
      env: r.env,
      props: sql.json(r.props),
    }));
    const res = await sql`insert into usage_events ${sql(values)} on conflict (event_id) do nothing`;
    return res.count;
  } catch (err) {
    console.error("usage insert", err);
    return 0;
  }
}

// 요청 처리 중 부른다: 응답 뒤에 저장
export function track(row: UsageRow) {
  const run = () => insertUsage([row]).then(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}
