import { z } from "zod";
import { askInChat } from "@/lib/ai-chat";
import { isFeatureOn } from "@/lib/features";
import { handle, json, parseBody } from "@/lib/http";
import { safePageUrl } from "@/lib/inquiry-api";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { requireVisitorSession } from "@/lib/widget-token";

// 위젯 "AI에게 물어보기". chatId 를 주면 같은 대화에 이어서 묻는다 (AI 대화 이어가기 — 미공개 기능 aiChat)
const Body = z.object({
  question: z.string().trim().min(2).max(1000),
  pageUrl: z.string().max(2000).nullish(),
  chatId: z.uuid().nullish(),
  clientMessageId: z.string().min(8).max(64).nullish(),
});

export const POST = handle(async (request: Request) => {
  const { contactId, env } = await requireVisitorSession(request);
  await rateLimit(`ask:${contactId}`, 10, 600);
  await rateLimit(`ask_ip:${clientIp(request)}`, 30, 600);
  const b = await parseBody(request, Body);
  const chat = isFeatureOn("aiChat", env);
  const r = await askInChat({
    contactId,
    chatId: chat ? (b.chatId ?? null) : null,
    question: b.question,
    pageUrl: safePageUrl(b.pageUrl),
    clientMessageId: b.clientMessageId ?? crypto.randomUUID(),
    watching: chat,
  });
  // 내부 사유(정책 slug 등)는 고객에게 보내지 않는다
  const t = r.turn;
  return json({
    chatId: r.chatId,
    conversationId: r.conversationId,
    decision: t?.decision ?? "answered",
    answer: t?.answer ?? null,
    category: t?.category ?? "etc",
    answerId: t?.answerId ?? "",
  });
});
