import { z } from "zod";
import { attachmentsAvailable, startVideoUpload } from "@/lib/attachments";
import { isFeatureOn } from "@/lib/features";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { requireVisitorSession } from "@/lib/widget-token";

const Body = z.object({ type: z.string().max(100), size: z.number().int().positive() });

// 고객 동영상 1개 업로드 1단계: 저장소에 바로 올릴 URL 을 준다 (파일은 이 서버를 거치지 않는다).
// 동영상은 용량이 커서 사진보다 상한을 좁게 둔다 (고객 시간당 5개, IP 시간당 10개, 전체 하루 100개 = 최대 5GB).
export const POST = handle(async (request: Request) => {
  const { contactId, env } = await requireVisitorSession(request);
  if (!isFeatureOn("attachments", env) || !attachmentsAvailable()) throw new HttpError(404, "not_available");
  const body = await parseBody(request, Body);
  await rateLimit(`video:${contactId}`, 5, 3600);
  await rateLimit(`video_ip:${clientIp(request)}`, 10, 3600);
  await rateLimit("video_all", 100, 86400);
  return json(await startVideoUpload(contactId, body));
});
