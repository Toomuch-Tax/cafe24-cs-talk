import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, json } from "@/lib/http";

// 설정 → 운영 개선 → 개선 후보 (관리자 전용). 후보마다 시도 이력(원인 판단·변경·검증·코드 검토·배포 후 결과)을 붙인다.
export const GET = handle(async (request: NextRequest) => {
  await requireAdmin(request);
  const items = await sql`
    select c.id, c.kind, c.key, c.title, c.area, c.count_7d, c.attempts_7d, c.evidence, c.status, c.fail_count,
      c.last_failure, c.next_attempt_at, c.branch, c.deployed_at, c.fix_release, c.updated_at,
      coalesce((select jsonb_agg(to_jsonb(a) - 'candidate_id' order by a.started_at desc)
        from improvement_attempts a where a.candidate_id = c.id), '[]'::jsonb) as attempts
    from improvement_candidates c
    where c.status not in ('verified', 'dismissed') or c.updated_at > now() - interval '30 days'
    order by
      case c.status when 'regressed' then 0 when 'fix_ready' then 1 when 'needs_decision' then 2 when 'in_progress' then 3
        when 'open' then 4 when 'deployed' then 5 else 6 end,
      c.count_7d desc
    limit 100`;
  return json({ items });
});
