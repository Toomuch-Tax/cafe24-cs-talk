import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";

// 사람이 하는 후보 상태 변경: 보류 / 배포됨 표시(효과 확인 시작) / 다시 열기
const Body = z.object({
  action: z.enum(["dismiss", "deployed", "reopen"]),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
});
const FROM: Record<z.infer<typeof Body>["action"], string[]> = {
  dismiss: ["open", "needs_decision", "fix_ready", "regressed", "deployed"],
  deployed: ["fix_ready", "needs_decision", "open", "regressed"],
  reopen: ["dismissed", "needs_decision", "verified", "fix_ready", "deployed"],
};
const LABEL = { dismiss: "보류", deployed: "배포됨 표시", reopen: "다시 열기" };

export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/inbox/improvements/[id]">) => {
  const agent = await requireAdmin(request);
  const { id } = await ctx.params;
  const { action, commit } = await parseBody(request, Body);
  const [row] = await sql<{ title: string; status: string }[]>`
    update improvement_candidates set
      status = ${action === "dismiss" ? "dismissed" : action === "deployed" ? "deployed" : "open"},
      deployed_at = ${action === "deployed" ? sql`now()` : sql`deployed_at`},
      fix_release = ${action === "deployed" ? (commit?.slice(0, 7) ?? null) : sql`fix_release`},
      fail_count = ${action === "reopen" ? 0 : sql`fail_count`},
      next_attempt_at = ${action === "reopen" ? null : sql`next_attempt_at`},
      run_id = null, claimed_at = null, updated_at = now()
    where id = ${id} and status = any(${FROM[action]})
    returning title, status`;
  if (!row) throw new HttpError(409, "conflict");
  await audit(agent, {
    area: "settings",
    action: `improvement.${action}`,
    title: `개선 후보 ${LABEL[action]} · ${row.title.slice(0, 60)}`,
    changes: commit ? [{ label: "배포 커밋", after: commit.slice(0, 7) }] : [],
  });
  return json({ ok: true });
});
