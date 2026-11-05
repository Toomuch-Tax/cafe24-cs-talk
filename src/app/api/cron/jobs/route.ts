import { alertAiNeedReview } from "@/lib/ai-review";
import { cleanupOrphanUploads } from "@/lib/attachments";
import { logError } from "@/lib/errors";
import { refreshImprovements } from "@/lib/improvements";
import { autoCloseStale, processJobs } from "@/lib/jobs";
import { handle, HttpError, json } from "@/lib/http";
import { cafe24Keepalive, checkSla, cleanup, recordHeartbeat, sendDailyDigest } from "@/lib/ops";
import { getSetting } from "@/lib/settings";

// Vercel Cron (vercel.ts, 10분마다). 문의에 안 붙은 첨부 정리도 여기서 한다. Vercel 이 Authorization: Bearer <CRON_SECRET> 을 붙여 호출한다.
// 작업 하나가 실패해도 나머지는 계속 돌고, 마지막에 동작 기록(heartbeat)을 남긴다 → /api/health 가 cron 멈춤을 감지.
export const GET = handle(async (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "unauthorized");

  const result: Record<string, unknown> = {};
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      result[name] = await fn();
    } catch (err) {
      errors.push(name);
      console.error(`cron ${name}`, err);
      await logError({ source: "cron", where: `cron ${name}`, area: "cron", err });
    }
  };

  // 경고·요약을 먼저 쌓고, 마지막에 대기열을 비워 같은 실행 안에서 바로 발송되게 한다
  await step("sla", checkSla);
  await step("aiReview", alertAiNeedReview);
  await step("cafe24", cafe24Keepalive);
  await step("improvements", refreshImprovements); // 일일 요약에 상위 후보를 넣으므로 요약보다 먼저
  await step("digest", sendDailyDigest);
  await step("closed", async () => autoCloseStale(Number(await getSetting<number>("auto_close_days")) || 7));
  await step("cleanup", cleanup);
  await step("uploads", cleanupOrphanUploads);
  await step("jobs", async () => (await processJobs({ limit: 30 })).length);
  await recordHeartbeat({ errors });
  return json({ ...result, errors });
});
