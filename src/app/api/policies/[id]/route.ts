import type { NextRequest } from "next/server";
import { z } from "zod";
import { CATEGORY_LABEL } from "@/components/inbox/labels";
import { audit, diff } from "@/lib/audit";
import { requireAdmin, requireAgent } from "@/lib/auth";
import { handle, json, parseBody } from "@/lib/http";
import { AI_MODE_LABEL, type AiMode, getTopic, KIND_LABEL, type PolicyKind, type PolicyProduct, updateTopicMeta } from "@/lib/policies";
import { Categories, Kind, Mode, Products } from "@/lib/policy-schemas";

type Ctx = RouteContext<"/api/policies/[id]">;

export const GET = handle(async (request: NextRequest, ctx: Ctx) => {
  await requireAgent(request);
  const { id } = await ctx.params;
  return json(await getTopic(id));
});

const Patch = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  kind: Kind.optional(),
  ai_mode: Mode.optional(),
  categories: Categories.optional(),
  products: Products.optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
  archived: z.boolean().optional(),
});

export const PATCH = handle(async (request: NextRequest, ctx: Ctx) => {
  const me = await requireAdmin(request);
  const { id } = await ctx.params;
  const patch = await parseBody(request, Patch);
  const { topic: before } = await getTopic(id);
  await updateTopicMeta(id, patch);
  const pick = <K extends keyof typeof patch>(k: K) => (patch[k] === undefined ? before[k as keyof typeof before] : patch[k]);
  const cats = (v: unknown) => ((v as string[]) ?? []).map((c) => CATEGORY_LABEL[c] ?? c).join(", ") || "없음";
  const changes = diff([
    { label: "AI 모드", before: AI_MODE_LABEL[before.ai_mode], after: AI_MODE_LABEL[pick("ai_mode") as AiMode] },
    { label: "제목", before: before.title, after: pick("title") },
    { label: "설명", before: before.description, after: pick("description") },
    { label: "적용 방식", before: KIND_LABEL[before.kind], after: KIND_LABEL[pick("kind") as PolicyKind] },
    { label: "문의 유형", before: before.categories, after: pick("categories"), fmt: cats },
    {
      label: "상품",
      before: before.products,
      after: pick("products"),
      fmt: (v) => ((v as PolicyProduct[]) ?? []).map((p) => p.name || `#${p.no}`).join(", ") || "없음",
    },
    { label: "보관", before: before.archived, after: pick("archived"), fmt: (v) => (v ? "보관됨" : "사용 중") },
  ]);
  const title =
    patch.ai_mode && patch.ai_mode !== before.ai_mode
      ? `정책 '${before.title}' AI 모드 변경`
      : patch.archived !== undefined && patch.archived !== before.archived
        ? `정책 '${before.title}' ${patch.archived ? "보관" : "보관 해제"}`
        : `정책 '${before.title}' 정보 변경`;
  // 순서(sort_order)만 바뀐 건 남기지 않는다
  await audit(me, { area: "ai", action: "policy.meta", title, changes, skipIfEmpty: true });
  return json({ ok: true });
});
