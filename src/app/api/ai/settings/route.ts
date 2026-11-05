import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit, diff } from "@/lib/audit";
import { requireAdmin, requireAgent } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/engine";
import { handle, json, parseBody } from "@/lib/http";
import { getSetting, setSetting } from "@/lib/settings";

export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  return json({
    enabled: (await getSetting<boolean>("ai_enabled")) !== false,
    monthlyBudgetUsd: Number(await getSetting<number>("ai_monthly_budget_usd")) || 10,
    configured: aiConfigured(),
  });
});

const Body = z.object({ enabled: z.boolean(), monthlyBudgetUsd: z.number().min(0).max(1000) });

export const PUT = handle(async (request: NextRequest) => {
  const me = await requireAdmin(request);
  const b = await parseBody(request, Body);
  const before = {
    enabled: (await getSetting<boolean>("ai_enabled")) !== false,
    budget: Number(await getSetting<number>("ai_monthly_budget_usd")) || 10,
  };
  await setSetting("ai_enabled", b.enabled);
  await setSetting("ai_monthly_budget_usd", b.monthlyBudgetUsd);
  const changes = diff([
    { label: "AI 응답", before: before.enabled, after: b.enabled, fmt: (v) => (v ? "켜짐" : "꺼짐") },
    { label: "월 예산", before: before.budget, after: b.monthlyBudgetUsd, fmt: (v) => `$${v}` },
  ]);
  const title = before.enabled !== b.enabled ? `AI 응답 ${b.enabled ? "켬" : "끔"}` : "AI 월 예산 변경";
  await audit(me, { area: "ai", action: "ai.settings", title, changes, skipIfEmpty: true });
  return json({ ok: true });
});
