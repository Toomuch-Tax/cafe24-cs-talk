import type { NextRequest } from "next/server";
import { z } from "zod";
import { attachmentsAvailable, finishVideoUpload } from "@/lib/attachments";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";

type Ctx = RouteContext<"/api/inbox/conversations/[id]/attachments/video/complete">;

const Body = z.object({ id: z.string().uuid() });

// 상담원 동영상 업로드 2단계: 저장소에 올라온 파일을 확인하고 메시지에 붙일 수 있게 한다
export const POST = handle(async (request: NextRequest, ctx: Ctx) => {
  const agent = await requireAgent(request);
  if (!attachmentsAvailable()) throw new HttpError(404, "not_available");
  const { id } = await ctx.params;
  const { id: uploadId } = await parseBody(request, Body);
  const [conv] = await sql<{ contact_id: string }[]>`select contact_id from conversations where id = ${id}`;
  if (!conv) throw new HttpError(404, "not_found");
  return json({ attachment: await finishVideoUpload(conv.contact_id, uploadId, agent.id) });
});
