import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { authorizeUrl } from "@/lib/cafe24/client";
import { appOrigin } from "@/lib/cafe24/origin";
import { sql } from "@/lib/db";
import { handle } from "@/lib/http";

// 관리자가 누르면 Cafe24 권한 승인 화면으로 보낸다
export const GET = handle(async (request: NextRequest) => {
  const agent = await requireAdmin(request);
  const state = randomBytes(24).toString("base64url");
  await sql`delete from cafe24_oauth_states where created_at < now() - interval '10 minutes'`;
  await sql`insert into cafe24_oauth_states (state, agent_id) values (${state}, ${agent.id})`;
  return NextResponse.redirect(authorizeUrl(state, appOrigin(request)));
});
