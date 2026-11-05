import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/http";

const Patch = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(200).or(z.literal("")).nullable().optional(),
});

export const PATCH = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/contacts/[id]">) => {
  await requireAgent(request);
  const { id } = await ctx.params;
  const body = await parseBody(request, Patch);
  await sql`update contacts set
      name = ${body.name === undefined ? sql`name` : body.name || null},
      phone = ${body.phone === undefined ? sql`phone` : body.phone || null},
      email = ${body.email === undefined ? sql`email` : body.email || null}
    where id = ${id}`;
  return json({ ok: true });
});
