import { z } from "zod";
import { attachmentsAvailable, finishVideoUpload } from "@/lib/attachments";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { requireVisitorSession } from "@/lib/widget-token";

const Body = z.object({ id: z.string().uuid() });

// 고객 동영상 업로드 2단계: 저장소에 올라온 파일을 확인하고 메시지에 붙일 수 있게 한다
export const POST = handle(async (request: Request) => {
  const { contactId } = await requireVisitorSession(request);
  if (!attachmentsAvailable()) throw new HttpError(404, "not_available");
  const { id } = await parseBody(request, Body);
  return json({ attachment: await finishVideoUpload(contactId, id) });
});
