import { attachmentsAvailable, saveUpload } from "@/lib/attachments";
import { isFeatureOn } from "@/lib/features";
import { handle, HttpError, json } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { MAX_BYTES } from "@/lib/storage";
import { requireVisitorSession } from "@/lib/widget-token";

// 고객 사진 1장 업로드 (multipart, 필드 이름 file). 문의를 보낼 때 돌려받은 id 로 메시지에 붙는다.
// 사진을 고르는 순간에만 호출되므로 방문자 수와 무관하고, 고객·IP·전체 하루 상한으로 비용을 묶어 둔다.
export const POST = handle(async (request: Request) => {
  const { contactId, env } = await requireVisitorSession(request);
  if (!isFeatureOn("attachments", env) || !attachmentsAvailable()) throw new HttpError(404, "not_available");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) {
    throw new HttpError(413, "file_too_large");
  }
  await rateLimit(`upload:${contactId}`, 20, 3600);
  await rateLimit(`upload_ip:${clientIp(request)}`, 40, 3600);
  await rateLimit("upload_all", 500, 86400);

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    throw new HttpError(400, "invalid_body");
  }
  if (!(file instanceof Blob)) throw new HttpError(400, "invalid_body");
  if (file.size > MAX_BYTES) throw new HttpError(413, "file_too_large");
  const saved = await saveUpload(contactId, new Uint8Array(await file.arrayBuffer()));
  return json({ attachment: saved });
});
