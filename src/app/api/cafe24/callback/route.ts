import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { getAgent } from "@/lib/auth";
import { Cafe24Error, exchangeCode } from "@/lib/cafe24/client";
import { appOrigin } from "@/lib/cafe24/origin";
import { sql } from "@/lib/db";

export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const back = (result: string) => NextResponse.redirect(`${origin}/settings?cafe24=${result}`);
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error") || !code || !state) return back("denied");

  const agent = await getAgent(request);
  if (!agent || agent.role !== "admin") return back("login_required");

  // state 는 1회용, 10분 이내, 연결을 시작한 같은 관리자만
  const [row] = await sql<{ agent_id: string }[]>`
    delete from cafe24_oauth_states
    where state = ${state} and created_at > now() - interval '10 minutes'
    returning agent_id`;
  if (!row || row.agent_id !== agent.id) return back("invalid_state");

  try {
    await exchangeCode(code, origin, agent.id);
    await audit(agent, { area: "widget", action: "cafe24.connect", title: "Cafe24 쇼핑몰 연결", changes: [{ label: "연결", after: "연결됨" }] });
    return back("connected");
  } catch (err) {
    console.error("cafe24 token exchange failed", err instanceof Cafe24Error ? err.code : err);
    return back("token_error");
  }
}
