import type { NextRequest } from "next/server";
import { z } from "zod";
import { allowedDomains, getAccessPolicy, googleConfigured } from "@/lib/access";
import { audit, diff } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { setSetting } from "@/lib/settings";

const Body = z.object({ autoApprove: z.boolean(), passwordLogin: z.boolean() });
const onOff = (v: unknown) => (v ? "켜짐" : "꺼짐");

export const GET = handle(async (request: NextRequest) => {
  const me = await requireAdmin(request);
  const [linked] = await sql<{ google: boolean }[]>`select google_sub is not null as google from agents where id = ${me.id}`;
  return json({
    policy: await getAccessPolicy(),
    google: googleConfigured(),
    domains: allowedDomains(),
    meGoogleLinked: linked?.google ?? false,
  });
});

export const PUT = handle(async (request: NextRequest) => {
  const me = await requireAdmin(request);
  const b = await parseBody(request, Body);
  if (!b.passwordLogin) {
    // 비밀번호 로그인을 끄려면 구글 로그인이 켜져 있고, 끄는 관리자 본인이 구글로 들어올 수 있어야 한다
    if (!googleConfigured()) throw new HttpError(409, "google_not_configured");
    const [linked] = await sql`select 1 from agents where id = ${me.id} and google_sub is not null`;
    if (!linked) throw new HttpError(409, "link_google_first");
  }
  const before = await getAccessPolicy();
  await setSetting("access_policy", b);
  const changes = diff([
    { label: "비밀번호 로그인", before: before.passwordLogin, after: b.passwordLogin, fmt: onOff },
    { label: "새 구글 사용자", before: before.autoApprove, after: b.autoApprove, fmt: (v) => (v ? "바로 상담원" : "관리자 승인 후") },
  ]);
  const title =
    before.passwordLogin !== b.passwordLogin
      ? `비밀번호 로그인 ${b.passwordLogin ? "켬" : "끔"}`
      : "가입 방식 변경";
  await audit(me, { area: "security", action: "access.update", title, changes, skipIfEmpty: true });
  return json({ ok: true });
});
