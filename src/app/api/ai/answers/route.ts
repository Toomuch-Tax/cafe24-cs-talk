import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, json } from "@/lib/http";

// AI 응답 기록 + 이번 달 통계
export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  const params = new URL(request.url).searchParams;
  const decision = params.get("decision");
  const kind = params.get("kind") ?? "customer_answer";
  const rows = await sql`
    select a.id, a.kind, a.question, a.answer, a.decision, a.reason, a.model, a.cost_usd, a.feedback, a.created_at,
      a.conversation_id,
      coalesce((select array_agg(t.slug order by t.slug) from policy_topics t where t.id = any(a.topic_ids)), '{}') as topics
    from ai_answers a
    where a.kind = ${kind} ${decision ? sql`and a.decision = ${decision}` : sql``}
    order by a.created_at desc limit 100`;
  const [stats] = await sql`
    select
      count(*) filter (where kind = 'customer_answer')::int as asked,
      count(*) filter (where kind = 'customer_answer' and decision = 'answered')::int as answered,
      count(*) filter (where kind = 'customer_answer' and feedback = 'helpful')::int as helpful,
      count(*) filter (where kind = 'customer_answer' and feedback = 'not_helpful')::int as not_helpful,
      count(*) filter (where kind = 'agent_draft')::int as drafts,
      coalesce(sum(cost_usd), 0)::float as cost_usd
    from ai_answers where created_at >= date_trunc('month', now())`;
  return json({ answers: rows, stats });
});
