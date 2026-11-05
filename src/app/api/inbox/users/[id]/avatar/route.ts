import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAgentAvatarImage, saveAgentAvatar } from "@/lib/agent-avatar";
import { AGENT_EMOJIS } from "@/lib/agent-emojis";
import { requireAgent } from "@/lib/auth";
import { handle, HttpError, json, parseBody } from "@/lib/http";

type Ctx = RouteContext<"/api/inbox/users/[id]/avatar">;

const Id = z.uuid();
const Body = z.union([
  z.object({ emoji: z.enum(AGENT_EMOJIS) }),
  // 브라우저에서 160px webp 로 줄여 올린다 → 수십 KB
  z.object({ image: z.string().max(200_000) }),
  z.object({ google: z.literal(true) }),
]);

// 올린 프로필 사진. 상담원끼리만 본다. 주소의 ?v= 가 내용 해시라 바뀌면 새 주소가 된다.
export const GET = handle(async (request: NextRequest, ctx: Ctx) => {
  await requireAgent(request);
  const { id } = await ctx.params;
  const row = Id.safeParse(id).success ? await getAgentAvatarImage(id) : null;
  if (!row) return new Response(null, { status: 404 });
  const fresh = new URL(request.url).searchParams.get("v") === row.avatar_v;
  return new Response(new Uint8Array(row.avatar_image), {
    headers: {
      "content-type": row.avatar_image_type,
      "x-content-type-options": "nosniff",
      "cache-control": fresh ? "private, max-age=31536000, immutable" : "private, no-cache",
    },
  });
});

// 내 사진은 누구나, 다른 사람 사진은 관리자만 바꾼다
export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const me = await requireAgent(request);
  const { id } = await ctx.params;
  if (!Id.safeParse(id).success) throw new HttpError(404, "not_found");
  if (id !== me.id && me.role !== "admin") throw new HttpError(403, "forbidden");
  await saveAgentAvatar(id, await parseBody(request, Body));
  return json({ ok: true });
});
