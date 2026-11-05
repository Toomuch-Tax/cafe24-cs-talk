import type { NextRequest } from "next/server";
import { attachmentsAvailable, saveUpload } from "@/lib/attachments";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_BYTES } from "@/lib/storage";

type Ctx = RouteContext<"/api/inbox/conversations/[id]/attachments">;

// 상담원 답변·메모용 사진 1장 업로드 (multipart, 필드 이름 file). 보낼 때 돌려받은 id 로 메시지에 붙는다.
export const POST = handle(async (request: NextRequest, ctx: Ctx) => {
  const agent = await requireAgent(request);
  if (!attachmentsAvailable()) throw new HttpError(404, "not_available");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) {
    throw new HttpError(413, "file_too_large");
  }
  const { id } = await ctx.params;
  const [conv] = await sql<{ contact_id: string }[]>`select contact_id from conversations where id = ${id}`;
  if (!conv) throw new HttpError(404, "not_found");
  await rateLimit(`upload_agent:${agent.id}`, 100, 3600);

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    throw new HttpError(400, "invalid_body");
  }
  if (!(file instanceof Blob)) throw new HttpError(400, "invalid_body");
  if (file.size > MAX_BYTES) throw new HttpError(413, "file_too_large");
  const saved = await saveUpload(conv.contact_id, new Uint8Array(await file.arrayBuffer()), agent.id);
  return json({ attachment: saved });
});
