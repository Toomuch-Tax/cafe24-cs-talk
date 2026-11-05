import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/http";
import { QuickReply } from "@/lib/schemas";

export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  return json({ quickReplies: await sql`select * from quick_replies order by shortcut` });
});

export const POST = handle(async (request: NextRequest) => {
  const me = await requireAgent(request);
  const b = await parseBody(request, QuickReply);
  const [row] = await sql`insert into quick_replies (shortcut, title, body)
    values (${b.shortcut}, ${b.title}, ${b.body}) returning *`;
  await audit(me, { area: "settings", action: "quick.create", title: `빠른 답변 /${b.shortcut} 추가`, changes: [{ label: "제목", after: b.title }] });
  return json({ quickReply: row });
});
