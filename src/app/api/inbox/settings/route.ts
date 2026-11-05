import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit, diff } from "@/lib/audit";
import { requireAdmin, requireAgent } from "@/lib/auth";
import { handle, json, parseBody } from "@/lib/http";
import { getSetting, setSetting, type BusinessHours } from "@/lib/settings";

const Hhmm = z.string().regex(/^\d{2}:\d{2}$/);
// 화면이 탭별로 나눠 저장하므로 부분 저장을 받는다
const Body = z.object({
  businessHours: z.object({
    timezone: z.string(),
    days: z.array(z.number().int().min(0).max(6)),
    start: Hhmm,
    end: Hhmm,
    lunch: z.object({ start: Hhmm, end: Hhmm }).nullable().optional(),
  }).optional(),
  greeting: z.string().trim().min(1).max(500).optional(),
  replySla: z.string().trim().min(1).max(100).optional(),
});

export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  return json({
    businessHours: await getSetting<BusinessHours>("business_hours"),
    greeting: await getSetting<string>("greeting"),
    replySla: await getSetting<string>("reply_sla"),
  });
});

const DAY = ["일", "월", "화", "수", "목", "금", "토"];
const fmtDays = (v: unknown) =>
  Array.isArray(v) && v.length ? [...v].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY[d]).join("·") : "없음";
const fmtRange = (v: unknown) => {
  const r = v as { start?: string; end?: string } | null | undefined;
  return r?.start ? `${r.start}–${r.end}` : "없음";
};

export const PUT = handle(async (request: NextRequest) => {
  const me = await requireAdmin(request);
  const b = await parseBody(request, Body);
  if (b.businessHours) {
    const before = await getSetting<BusinessHours>("business_hours");
    await setSetting("business_hours", b.businessHours);
    const after = b.businessHours;
    const changes = diff([
      { label: "영업일", before: before?.days, after: after.days, fmt: fmtDays },
      { label: "운영 시간", before: before && { start: before.start, end: before.end }, after: { start: after.start, end: after.end }, fmt: fmtRange },
      { label: "점심", before: before?.lunch ?? null, after: after.lunch ?? null, fmt: fmtRange },
    ]);
    await audit(me, { area: "settings", action: "settings.hours", title: "영업 시간 변경", changes, skipIfEmpty: true });
  }
  if (b.greeting || b.replySla) {
    const [greeting, replySla] = [await getSetting<string>("greeting"), await getSetting<string>("reply_sla")];
    if (b.greeting) await setSetting("greeting", b.greeting);
    if (b.replySla) await setSetting("reply_sla", b.replySla);
    const changes = diff([
      { label: "첫 인사", before: greeting, after: b.greeting ?? greeting },
      { label: "답변 안내 시간", before: replySla, after: b.replySla ?? replySla },
    ]);
    await audit(me, { area: "settings", action: "settings.messages", title: "위젯 안내 문구 변경", changes, skipIfEmpty: true });
  }
  return json({ ok: true });
});
