import type { NextRequest } from "next/server";
import { z } from "zod";
import { attachmentsAvailable, startVideoUpload } from "@/lib/attachments";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

type Ctx = RouteContext<"/api/inbox/conversations/[id]/attachments/video">;

const Body = z.object({ type: z.string().max(100), size: z.number().int().positive() });

// 상담원 답변·메모용 동영상 1개 업로드 1단계: 저장소에 바로 올릴 URL 을 준다
export const POST = handle(async (request: NextRequest, ctx: Ctx) => {
  const agent = await requireAgent(request);
  if (!attachmentsAvailable()) throw new HttpError(404, "not_available");
  const { id } = await ctx.params;
  const body = await parseBody(request, Body);
  const [conv] = await sql<{ contact_id: string }[]>`select contact_id from conversations where id = ${id}`;
  if (!conv) throw new HttpError(404, "not_found");
  await rateLimit(`video_agent:${agent.id}`, 20, 3600);
  return json(await startVideoUpload(conv.contact_id, body, agent.id));
});
