import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit, diff } from "@/lib/audit";
import { requireAdmin, requireAgent } from "@/lib/auth";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { getPublicProfile, savePublicProfile } from "@/lib/profile";

const Body = z.object({
  name: z.string().trim().min(1).max(30),
  // undefined: 로고 그대로 / null: 로고 지우고 기본 마크 / data URL: 새 로고
  avatar: z.string().max(500_000).nullable().optional(),
});

export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  return json(await getPublicProfile());
});

export const PUT = handle(async (request: NextRequest) => {
  const me = await requireAdmin(request);
  const b = await parseBody(request, Body);
  const before = await getPublicProfile();
  const { error } = await savePublicProfile(b);
  if (error) throw new HttpError(400, error);
  const after = await getPublicProfile();
  const changes = [
    ...diff([{ label: "답변 이름", before: before.name, after: after.name }]),
    ...(before.avatarUrl !== after.avatarUrl
      ? [{ label: "로고", after: !after.avatarUrl ? "기본 마크로 되돌림" : before.avatarUrl ? "새 이미지로 바꿈" : "새로 올림" }]
      : []),
  ];
  await audit(me, { area: "settings", action: "settings.profile", title: "고객 노출 정보 변경", changes, skipIfEmpty: true });
  return json(after);
});
