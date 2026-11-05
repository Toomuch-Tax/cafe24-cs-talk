import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";

// 설정 → 운영 개선 → 사용 현황 (관리자 전용). 이름은 실제로 잰 것대로 붙인다:
// "AI 답변 제공률"(답변을 냈는지 — 해결 여부 아님), "주문조회 성공률", "첫 응답시간(전체 경과, 영업시간 미반영)".
const Query = z.object({
  days: z.coerce.number().int().refine((d) => d === 7 || d === 30).default(7),
  env: z.enum(["live", "test", "dev"]).optional(),
});

export const GET = handle(async (request: NextRequest) => {
  await requireAdmin(request);
  const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!q.success) throw new HttpError(400, "invalid_query");
  const env = q.data.env ?? (process.env.NODE_ENV === "production" ? "live" : "dev");
  const from = new Date(Date.now() - q.data.days * 86_400_000);

  const [usage] = await sql<
    { opens: number; menus: Record<string, number> | null; lookups: number; found: number; replies: number; ai_draft: number; macro: number }[]
  >`
    select
      count(*) filter (where name = 'widget_open')::int as opens,
      (select jsonb_object_agg(menu, n) from (
         select props->>'menu' as menu, count(*)::int as n from usage_events
         where name = 'menu_click' and env = ${env} and occurred_at >= ${from} group by 1) m) as menus,
      count(*) filter (where name = 'order_lookup')::int as lookups,
      count(*) filter (where name = 'order_lookup' and props->>'result' = 'found')::int as found,
      count(*) filter (where name = 'reply_sent')::int as replies,
      count(*) filter (where name = 'reply_sent' and (props->>'ai_draft')::boolean)::int as ai_draft,
      count(*) filter (where name = 'reply_sent' and (props->>'macro')::boolean)::int as macro
    from usage_events where env = ${env} and occurred_at >= ${from}`;

  // 아래는 기존 업무 데이터로 센다 (테스트 위젯 문의도 같은 DB 에 있어 섞일 수 있음)
  const [biz] = await sql<{ asked: number; answered: number; inquiries: number; median_min: number | null; p90_min: number | null }[]>`
    select
      (select count(*)::int from ai_answers where kind = 'customer_answer' and created_at >= ${from}) as asked,
      (select count(*)::int from ai_answers where kind = 'customer_answer' and decision = 'answered' and created_at >= ${from}) as answered,
      (select count(*)::int from conversations where submitted_at >= ${from}) as inquiries,
      (select percentile_cont(0.5) within group (order by extract(epoch from first_agent_reply_at - submitted_at) / 60)
         from conversations where submitted_at >= ${from} and first_agent_reply_at is not null) as median_min,
      (select percentile_cont(0.9) within group (order by extract(epoch from first_agent_reply_at - submitted_at) / 60)
         from conversations where submitted_at >= ${from} and first_agent_reply_at is not null) as p90_min`;

  const agents = await sql<{ name: string; replies: number }[]>`
    select coalesce(a.name, '(삭제된 계정)') as name, count(*)::int as replies
    from messages m left join agents a on a.id = m.agent_id
    where m.sender_type = 'agent' and not m.internal and m.created_at >= ${from}
    group by a.name order by replies desc`;

  return json({
    days: q.data.days,
    env,
    widget: { opens: usage.opens, menus: usage.menus ?? {} },
    ai: { asked: biz.asked, answered: biz.answered },
    orders: { lookups: usage.lookups, found: usage.found },
    inquiries: biz.inquiries,
    firstResponse: { medianMin: biz.median_min, p90Min: biz.p90_min },
    replies: { tracked: usage.replies, aiDraft: usage.ai_draft, macro: usage.macro, byAgent: agents },
  });
});
