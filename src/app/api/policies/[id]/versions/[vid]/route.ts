import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { getVersion } from "@/lib/policies";

export const GET = handle(async (request: NextRequest, ctx: RouteContext<"/api/policies/[id]/versions/[vid]">) => {
  await requireAgent(request);
  const { id, vid } = await ctx.params;
  return json({ version: await getVersion(id, vid) });
});
