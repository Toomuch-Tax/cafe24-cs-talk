import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { ADMIN_SCOPES, connectionStatus } from "@/lib/cafe24/client";
import { handle, json } from "@/lib/http";

export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  const status = await connectionStatus();
  const missingScopes = status.connected ? ADMIN_SCOPES.filter((s) => !status.scopes?.includes(s)) : [];
  return json({ ...status, missingScopes });
});
