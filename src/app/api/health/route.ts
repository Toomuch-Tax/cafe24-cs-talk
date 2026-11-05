import { connection } from "next/server";
import { cronStale } from "@/lib/ops";

// 외부 가동 모니터링(UptimeRobot 등)이 5분마다 호출한다. 인증 없이 열려 있으므로 상세 수치는 내보내지 않는다.
// DB 응답 없음 또는 cron 이 30분 넘게 안 돌았으면 503 → 모니터링이 알림을 보낸다.
export async function GET() {
  await connection();
  try {
    const stale = await cronStale(); // DB 조회를 겸한다
    const ok = !stale;
    return Response.json(
      { ok, db: true, cron: !stale },
      { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false, db: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
