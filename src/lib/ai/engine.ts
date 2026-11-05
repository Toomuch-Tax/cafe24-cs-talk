import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { BRAND_NAME } from "../brand";
import { describeProduct, productContext, productNoFromUrl } from "../cafe24/products";
import { sql } from "../db";
import { captureError } from "../errors";
import { activePolicies, type ActivePolicy } from "../policies";
import { businessHoursNow, getSetting } from "../settings";
import { AnswerSchema, CATEGORY_VALUES, type ChatTurn, CUSTOMER_MODEL, customerPrompt, DRAFT_MODEL, ESCALATE, FORBIDDEN, policyBlock, SYSTEM, tidyAnswer } from "./prompt";

export { CATEGORY_VALUES, CUSTOMER_MODEL, DRAFT_MODEL };

// AI 응답 엔진
// - 근거는 정책 문서(주제별 현재 버전)와 상품 정보뿐. 문서에 없는 내용은 답하지 않고 문의로 넘긴다.
// - 주제의 ai_mode 가 auto 일 때만 고객에게 바로 답한다. draft 는 상담원 초안에만 쓴다.
// - 서버가 마지막에 위험 표현(환불 약속·정품 판정 등)을 한 번 더 걸러낸다.

const PRICE: Record<string, { in: number; out: number }> = {
  [CUSTOMER_MODEL]: { in: 0.1 / 1e6, out: 0.5 / 1e6 },
  [DRAFT_MODEL]: { in: 2 / 1e6, out: 10 / 1e6 },
};

// 정책 관리 화면의 "저장 전 테스트"는 저장 전 내용(overrides)으로 프롬프트를 만든다
const withOverrides = (policies: ActivePolicy[], overrides?: Record<string, string>) =>
  overrides ? policies.map((p) => (overrides[p.id] !== undefined ? { ...p, content: overrides[p.id] } : p)) : policies;

export type AiDecision = {
  decision: "answered" | "handoff" | "blocked" | "error";
  answer: string | null;
  reason: string | null;
  category: (typeof CATEGORY_VALUES)[number];
  topics: string[];
  answerId: string;
};

// 모델이 가끔 형식(JSON)을 지키지 않는다 → 그 경우에만 한 번 더 시도
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) return run();
    throw err;
  }
}

async function monthCostUsd() {
  const [r] = await sql<{ cost: string }[]>`
    select coalesce(sum(cost_usd), 0) as cost from ai_answers where created_at >= date_trunc('month', now())`;
  return Number(r.cost);
}

// AI Gateway 키가 없으면(Vercel 밖에서 AI_GATEWAY_API_KEY 미설정) 모델을 부르지 않고 바로 문의로 넘긴다
export const aiConfigured = () => Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);

export async function aiAvailable() {
  if (!aiConfigured()) return { ok: false as const, reason: "ai_not_configured" };
  const enabled = (await getSetting<boolean>("ai_enabled")) !== false;
  if (!enabled) return { ok: false as const, reason: "ai_disabled" };
  const budget = Number(await getSetting<number>("ai_monthly_budget_usd")) || 10;
  if ((await monthCostUsd()) >= budget) return { ok: false as const, reason: "budget_exceeded" };
  return { ok: true as const };
}

async function log(entry: {
  kind: "customer_answer" | "agent_draft" | "test";
  contactId?: string | null;
  conversationId?: string | null;
  agentId?: string | null;
  question: string;
  answer: string | null;
  decision: AiDecision["decision"];
  reason: string | null;
  topics: ActivePolicy[];
  model: string | null;
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs?: number;
  category?: string | null;
  pageUrl?: string | null;
  chatId?: string | null;
}) {
  const input = entry.usage?.inputTokens ?? 0;
  const output = entry.usage?.outputTokens ?? 0;
  const price = entry.model ? PRICE[entry.model] : undefined;
  const cost = price ? input * price.in + output * price.out : 0;
  const [row] = await sql<{ id: string }[]>`
    insert into ai_answers (kind, contact_id, conversation_id, agent_id, question, answer, decision, reason,
      topic_ids, version_ids, model, input_tokens, output_tokens, cost_usd, latency_ms, category, page_url, chat_id)
    values (${entry.kind}, ${entry.contactId ?? null}, ${entry.conversationId ?? null}, ${entry.agentId ?? null},
      ${entry.question}, ${entry.answer}, ${entry.decision}, ${entry.reason},
      ${entry.topics.map((t) => t.id)}, ${entry.topics.map((t) => t.version_id)}, ${entry.model},
      ${input}, ${output}, ${cost}, ${entry.latencyMs ?? null}, ${entry.category ?? null}, ${entry.pageUrl ?? null}, ${entry.chatId ?? null})
    returning id`;
  return row.id;
}

// 고객 질문에 대한 AI 응답 (위젯 "AI에게 물어보기")
export async function answerCustomer(input: {
  question: string;
  pageUrl?: string | null;
  contactId?: string | null;
  kind?: "customer_answer" | "test";
  agentId?: string | null;
  overrides?: Record<string, string>; // 정책 관리 화면의 "저장 전 테스트"
  chatId?: string | null; // 위젯 AI 대화 묶음 (src/lib/ai-chat.ts)
  history?: ChatTurn[]; // 같은 대화의 앞선 문답 (맥락용)
}): Promise<AiDecision> {
  const kind = input.kind ?? "customer_answer";
  const question = input.question.trim().slice(0, 1000);
  const base = { kind, contactId: input.contactId, agentId: input.agentId, question, model: null, pageUrl: input.pageUrl, chatId: input.chatId };

  if (ESCALATE.test(question)) {
    const answerId = await log({ ...base, answer: null, decision: "handoff", reason: "escalation_keyword", topics: [], category: "defect" });
    return { decision: "handoff", answer: null, reason: "escalation_keyword", category: "defect", topics: [], answerId };
  }
  const avail = await aiAvailable();
  if (!avail.ok) {
    const answerId = await log({ ...base, answer: null, decision: "handoff", reason: avail.reason, topics: [] });
    return { decision: "handoff", answer: null, reason: avail.reason, category: "etc", topics: [], answerId };
  }

  const productNo = productNoFromUrl(input.pageUrl);
  const policies = await activePolicies(productNo);
  const product = productNo ? await productContext(productNo) : null;
  const hours = await businessHoursNow();
  const started = Date.now();
  try {
    const result = await withRetry(() =>
      generateText({
        model: CUSTOMER_MODEL,
        system: SYSTEM(policyBlock(withOverrides(policies, input.overrides)), product ? describeProduct(product) : null, hours),
        prompt: customerPrompt(question, input.history),
        output: Output.object({ schema: AnswerSchema }),
        // 추론을 켜면 가끔 1200 토큰을 다 써서 JSON 이 잘린다 (QA: 사이즈 추천 질문 ~10%). 꺼도 정확도는 같았다
        reasoning: "none",
        maxOutputTokens: 1200,
        timeout: 20_000,
      }),
    );
    const out = { ...result.output, answer: tidyAnswer(result.output.answer) };
    const used = policies.filter((p) => out.topics_used.includes(p.slug) || (p.kind === "always" && out.decision === "answer"));
    const topicUsed = used.filter((p) => p.kind !== "always");
    let decision: AiDecision["decision"] = out.decision === "answer" ? "answered" : "handoff";
    let reason: string | null = out.decision === "handoff" ? out.handoff_reason || "model_handoff" : null;

    // 서버 쪽 최종 확인
    if (decision === "answered" && topicUsed.length === 0 && !product) {
      decision = "handoff";
      reason = "no_grounding";
    }
    if (decision === "answered" && topicUsed.some((p) => p.ai_mode !== "auto")) {
      decision = "handoff";
      reason = `draft_only:${topicUsed.filter((p) => p.ai_mode !== "auto").map((p) => p.slug).join(",")}`;
    }
    // 내부 용어 문장을 지우고 나니 남은 답이 없으면 문의로 넘긴다
    if (decision === "answered" && !out.answer) {
      decision = "handoff";
      reason = "internal_only";
    }
    if (decision === "answered" && FORBIDDEN.test(out.answer)) {
      decision = "blocked";
      reason = "forbidden_phrase";
    }
    // 테스트 모드에서는 draft 주제도 결과를 보여준다 (자동 응답으로 바꾸기 전 확인용)
    const showAnswer = decision === "answered" || (kind === "test" && out.answer);
    const answerId = await log({
      ...base,
      answer: out.answer || null,
      decision,
      reason,
      topics: used,
      model: CUSTOMER_MODEL,
      usage: result.usage,
      latencyMs: Date.now() - started,
      category: out.category,
    });
    return {
      decision,
      answer: showAnswer ? out.answer : null,
      reason,
      category: out.category,
      topics: used.map((p) => p.slug),
      answerId,
    };
  } catch (err) {
    captureError({ source: "external", where: "ai customer answer", area: "ai", err });
    const answerId = await log({ ...base, answer: null, decision: "error", reason: String(err).slice(0, 200), topics: [], model: CUSTOMER_MODEL });
    return { decision: "error", answer: null, reason: "error", category: "etc", topics: [], answerId };
  }
}

const DraftSchema = z.object({
  draft: z.string().describe("상담원이 다듬어서 보낼 답변 초안 (한국어)"),
  topics_used: z.array(z.string()),
  notes: z.string().describe("상담원에게만 보이는 메모: 확인이 필요한 점, 근거가 없는 부분"),
});

// 상담원 화면의 "AI 초안" (auto·draft 주제 모두 사용, 고객에게 바로 나가지 않음)
export async function draftForAgent(input: {
  conversationId: string;
  agentId: string;
  context: string;
  question: string;
  productNo?: number | null; // 고객이 보던 상품 — 그 상품의 상품별 정책을 붙인다
}) {
  const avail = await aiAvailable();
  if (!avail.ok) return { draft: null, notes: avail.reason === "budget_exceeded" ? "이번 달 AI 예산을 다 썼어요." : "AI 가 꺼져 있어요.", answerId: null };
  const policies = await activePolicies(input.productNo);
  const started = Date.now();
  const result = await withRetry(() => generateText({
    model: DRAFT_MODEL,
    system: `너는 ${BRAND_NAME} 고객센터 상담원의 답변 초안을 쓰는 도우미야. 정책 문서와 아래 상담 맥락만 근거로 써.
환불·교환·재발송을 확정하는 표현은 쓰지 말고, 상담원이 확인해야 할 부분은 notes 에 적어. 정책 문서의 말투를 따라.

# 정책 문서
${policyBlock(policies)}`,
    prompt: input.context,
    output: Output.object({ schema: DraftSchema }),
    // 고객 응답과 같은 이유: 기본 추론이 1500 토큰 중 1390 을 써서 초안 JSON 이 잘렸다 (2026-10-26 운영)
    reasoning: "none",
    maxOutputTokens: 1500,
    timeout: 40_000,
  }));
  const used = policies.filter((p) => result.output.topics_used.includes(p.slug));
  const answerId = await log({
    kind: "agent_draft",
    conversationId: input.conversationId,
    agentId: input.agentId,
    question: input.question,
    answer: result.output.draft,
    decision: "answered",
    reason: null,
    topics: used,
    model: DRAFT_MODEL,
    usage: result.usage,
    latencyMs: Date.now() - started,
  });
  return { draft: result.output.draft, notes: result.output.notes, answerId, topics: used.map((p) => p.slug) };
}
