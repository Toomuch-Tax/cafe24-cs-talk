import type { NextRequest } from "next/server";
import { avatarColumns } from "@/lib/agent-avatar";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  const agents = await sql`select id, name, role, ${avatarColumns()} from agents where status = 'active' order by name`;
  return json({ agents });
});
