import type { NextRequest } from "next/server";
import { attachmentsAvailable } from "@/lib/attachments";
import { requireAgent } from "@/lib/auth";
import { googleConfigured } from "@/lib/access";
import { sql } from "@/lib/db";
import { emailEnabled } from "@/lib/email";
import { handle, json } from "@/lib/http";

export const GET = handle(async (request: NextRequest) => {
  const agent = await requireAgent(request);
  // 관리자에게만: 승인 대기 사용자 수 (설정 메뉴 배지)
  const [{ n }] =
    agent.role === "admin"
      ? await sql<{ n: number }[]>`select count(*)::int as n from agents where status = 'pending'`
      : [{ n: 0 }];
  return json({ agent, pendingUsers: n, features: { email: emailEnabled(), google: googleConfigured(), attachments: attachmentsAvailable() } });
});
