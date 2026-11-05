import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAgent } from "@/lib/auth";
import { handle, json, parseBody } from "@/lib/http";
import { AI_MODE_LABEL, createTopic, listTopics } from "@/lib/policies";
import { Categories, Content, Kind, Mode, Products, Slug } from "@/lib/policy-schemas";

export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  return json({ topics: await listTopics(archived) });
});

const Body = z.object({
  slug: Slug,
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullish(),
  kind: Kind,
  ai_mode: Mode,
  categories: Categories,
  products: Products.optional(),
  content: Content,
});

export const POST = handle(async (request: NextRequest) => {
  const agent = await requireAdmin(request);
  const b = await parseBody(request, Body);
  const id = await createTopic(b, agent.id);
  await audit(agent, {
    area: "ai",
    action: "policy.create",
    title: `정책 '${b.title}' 추가`,
    changes: [
      { label: "AI 모드", after: AI_MODE_LABEL[b.ai_mode] },
      ...(b.kind === "product" ? [{ label: "상품", after: (b.products ?? []).map((p) => p.name || `#${p.no}`).join(", ") || "없음" }] : []),
    ],
  });
  return json({ id });
});
