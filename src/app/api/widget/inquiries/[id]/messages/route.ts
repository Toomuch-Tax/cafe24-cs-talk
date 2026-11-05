import { listCustomerMessages, replyToInquiry } from "@/lib/chat";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { Reply } from "@/lib/inquiry-api";
import { rateLimit } from "@/lib/rate-limit";
import { requireVisitor } from "@/lib/widget-token";

type Ctx = RouteContext<"/api/widget/inquiries/[id]/messages">;

async function owned(contactId: string, id: string) {
  const [conv] = await sql<{ id: string; status: string }[]>`
    select id, status from conversations where id = ${id} and contact_id = ${contactId} and submitted_at is not null`;
  if (!conv) throw new HttpError(404, "not_found");
  return conv;
}

export const GET = handle(async (request: Request, ctx: Ctx) => {
  const contactId = await requireVisitor(request);
  await rateLimit(`poll:${contactId}`, 60, 60);
  const { id } = await ctx.params;
  const conv = await owned(contactId, id);
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  await sql`update conversations set customer_last_read_at = now() where id = ${id}`;
  return json({ status: conv.status, messages: await listCustomerMessages(id, after) });
});

export const POST = handle(async (request: Request, ctx: Ctx) => {
  const contactId = await requireVisitor(request);
  await rateLimit(`send:${contactId}`, 20, 60);
  const { id } = await ctx.params;
  const body = await parseBody(request, Reply);
  const result = await replyToInquiry(contactId, id, body);
  return json({ message: result.message, duplicate: result.duplicate });
});
