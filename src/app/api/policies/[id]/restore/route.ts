import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json, parseBody } from "@/lib/http";
import { auditPolicyVersion, restoreVersion } from "@/lib/policies";

export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/policies/[id]/restore">) => {
  const agent = await requireAdmin(request);
  const { id } = await ctx.params;
  const { versionId } = await parseBody(request, z.object({ versionId: z.string().uuid() }));
  const result = await restoreVersion(id, versionId, agent.id);
  if (!result.unchanged) await auditPolicyVersion(agent, id, result.version, "예전 버전으로 되돌림");
  return json(result);
});
