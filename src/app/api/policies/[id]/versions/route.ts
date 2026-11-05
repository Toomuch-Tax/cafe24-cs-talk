import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json, parseBody } from "@/lib/http";
import { auditPolicyVersion, saveVersion } from "@/lib/policies";
import { Content } from "@/lib/policy-schemas";

const Body = z.object({
  content: Content,
  changeNote: z.string().trim().max(200).nullish(),
  baseVersion: z.number().int().nullable(),
});

// 저장 = 새 버전
export const POST = handle(async (request: NextRequest, ctx: RouteContext<"/api/policies/[id]/versions">) => {
  const agent = await requireAdmin(request);
  const { id } = await ctx.params;
  const b = await parseBody(request, Body);
  const result = await saveVersion(id, { content: b.content, changeNote: b.changeNote ?? null, baseVersion: b.baseVersion }, agent.id);
  if (!result.unchanged) await auditPolicyVersion(agent, id, result.version, b.changeNote ?? null);
  return json(result);
});
