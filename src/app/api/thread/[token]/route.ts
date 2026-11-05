import { listCustomerMessages, replyToInquiry } from "@/lib/chat";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { Reply } from "@/lib/inquiry-api";
import { getPublicProfile } from "@/lib/profile";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { verifyThreadToken } from "@/lib/thread-token";

type Ctx = RouteContext<"/api/thread/[token]">;

// 답변 이메일 링크로 연 문의 1건. 링크 토큰이 곧 접근 권한이다.
async function resolve(ctx: Ctx) {
  const { token } = await ctx.params;
  const t = await verifyThreadToken(token);
  if (!t) throw new HttpError(401, "link_expired");
  const [conv] = await sql<{ status: string; category: string | null; created_at: string }[]>`
    select status, category, created_at from conversations
    where id = ${t.conversationId} and contact_id = ${t.contactId} and submitted_at is not null`;
  if (!conv) throw new HttpError(404, "not_found");
  return { ...t, conv };
}

export const GET = handle(async (request: Request, ctx: Ctx) => {
  await rateLimit(`thread:${clientIp(request)}`, 60, 60);
  const t = await resolve(ctx);
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  await sql`update conversations set customer_last_read_at = now() where id = ${t.conversationId}`;
  return json({
    ...t.conv,
    messages: await listCustomerMessages(t.conversationId, after),
    // 첫 조회 때만 (폴링마다 보낼 필요 없음)
    ...(after === 0 ? { profile: await getPublicProfile() } : {}),
  });
});

export const POST = handle(async (request: Request, ctx: Ctx) => {
  await rateLimit(`thread_send:${clientIp(request)}`, 20, 60);
  const t = await resolve(ctx);
  const body = await parseBody(request, Reply);
  const result = await replyToInquiry(t.contactId, t.conversationId, body);
  return json({ message: result.message });
});
