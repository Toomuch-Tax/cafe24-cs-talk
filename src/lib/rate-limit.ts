import { sql } from "./db";
import { HttpError } from "./http";

// 고정 윈도우 카운터. 서버리스 인스턴스 간에도 공유되도록 DB 에 둔다.
// 문의량이 하루 수십 건 수준이라 DB 부하는 무시할 만하다.
export async function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  const [row] = await sql<{ count: number }[]>`
    insert into rate_limits (bucket, window_start, count)
    values (${bucket}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1)
    on conflict (bucket, window_start) do update set count = rate_limits.count + 1
    returning count`;
  if (row.count > limit) throw new HttpError(429, "rate_limited");
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
