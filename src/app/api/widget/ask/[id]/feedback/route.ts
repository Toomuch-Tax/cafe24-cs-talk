import { z } from "zod";
import { sql } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/http";
import { requireVisitor } from "@/lib/widget-token";

export const POST = handle(async (request: Request, ctx: RouteContext<"/api/widget/ask/[id]/feedback">) => {
  const contactId = await requireVisitor(request);
  const { id } = await ctx.params;
  const { helpful } = await parseBody(request, z.object({ helpful: z.boolean() }));
  await sql`update ai_answers set feedback = ${helpful ? "helpful" : "not_helpful"}, feedback_at = now()
    where id = ${id} and contact_id = ${contactId} and kind = 'customer_answer'`;
  return json({ ok: true });
});
