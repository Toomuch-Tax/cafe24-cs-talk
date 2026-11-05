import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAccessPolicy } from "@/lib/access";
import { slackConfigured } from "@/lib/alerts";
import { type AuditArea, listAudit, listLogins } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { handle, HttpError, json } from "@/lib/http";

// 설정 → 변경 이력 (관리자 전용)
// ?view=changes&area=&days=30&before=  /  ?view=logins&failed=1&user=&before=
const Query = z.object({
  view: z.enum(["changes", "logins"]).default("changes"),
  area: z.enum(["widget", "users", "security", "settings", "ai"]).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  failed: z.enum(["0", "1"]).optional(),
  user: z.string().uuid().optional(),
  before: z.string().datetime({ offset: true }).optional(),
});

export const GET = handle(async (request: NextRequest) => {
  await requireAdmin(request);
  const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!q.success) throw new HttpError(400, "invalid_query");
  const { view, area, days, failed, user, before } = q.data;
  if (view === "changes") return json(await listAudit({ area: area as AuditArea | undefined, days, before, limit: 50 }));
  const [logins, policy] = await Promise.all([
    listLogins({ failedOnly: failed === "1", agentId: user, before, limit: 50 }),
    getAccessPolicy(),
  ]);
  return json({ ...logins, passwordLogin: policy.passwordLogin, slack: slackConfigured() });
});
