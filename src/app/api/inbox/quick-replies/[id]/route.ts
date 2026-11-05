import type { NextRequest } from "next/server";
import { audit, diff } from "@/lib/audit";
import { requireAgent } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/http";
import { QuickReply } from "@/lib/schemas";

type Ctx = RouteContext<"/api/inbox/quick-replies/[id]">;
const short = (s: string) => (s.length > 60 ? `${s.slice(0, 60)}…` : s);

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const me = await requireAgent(request);
  const { id } = await ctx.params;
  const b = await parseBody(request, QuickReply);
  const [before] = await sql<{ shortcut: string; title: string; body: string }[]>`
    select shortcut, title, body from quick_replies where id = ${id}`;
  await sql`update quick_replies set shortcut = ${b.shortcut}, title = ${b.title}, body = ${b.body},
    updated_at = now() where id = ${id}`;
  if (before) {
    const changes = diff([
      { label: "단축어", before: `/${before.shortcut}`, after: `/${b.shortcut}` },
      { label: "제목", before: before.title, after: b.title },
      { label: "내용", before: before.body, after: b.body, fmt: (v) => short(String(v)) },
    ]);
    await audit(me, { area: "settings", action: "quick.update", title: `빠른 답변 /${before.shortcut} 수정`, changes, skipIfEmpty: true });
  }
  return json({ ok: true });
});

export const DELETE = handle(async (request: NextRequest, ctx: Ctx) => {
  const me = await requireAgent(request);
  const { id } = await ctx.params;
  const [row] = await sql<{ shortcut: string; title: string }[]>`delete from quick_replies where id = ${id} returning shortcut, title`;
  if (row) await audit(me, { area: "settings", action: "quick.delete", title: `빠른 답변 /${row.shortcut} 삭제`, changes: [{ label: "제목", before: row.title, after: "삭제됨" }] });
  return json({ ok: true });
});
