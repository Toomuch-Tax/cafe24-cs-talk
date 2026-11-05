import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";

// 설정 → 운영 개선 → 오류 (관리자 전용). 같은 종류는 한 행, 7일 횟수는 날짜별 기록(error_daily)으로 센다.
const Query = z.object({
  env: z.enum(["live", "test", "dev"]).optional(),
  state: z.enum(["open", "resolved"]).default("open"),
});

export const GET = handle(async (request: NextRequest) => {
  await requireAdmin(request);
  const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!q.success) throw new HttpError(400, "invalid_query");
  const env = q.data.env ?? (process.env.NODE_ENV === "production" ? "live" : "dev");
  const items = await sql`
    select g.id, g.source, g.where_ as where, g.area, g.code, g.status, g.message, g.stack, g.count, g.first_at, g.last_at,
      g.first_release, g.last_release, g.resolved_at,
      coalesce((select sum(d.count) from error_daily d
        where d.group_id = g.id and d.day > (now() at time zone 'Asia/Seoul')::date - 7), 0)::int as count_7d
    from error_groups g
    where g.env = ${env} and ${q.data.state === "open" ? sql`g.resolved_at is null` : sql`g.resolved_at is not null`}
    order by ${q.data.state === "open" ? sql`g.last_at` : sql`g.resolved_at`} desc
    limit 100`;
  return json({ env, items });
});
