import type { NextRequest } from "next/server";
import { z } from "zod";
import { answerCustomer } from "@/lib/ai/engine";
import { requireAgent } from "@/lib/auth";
import { handle, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

// 정책 관리 화면의 "테스트": 저장 전 내용(overrides)으로 AI 가 어떻게 답할지 확인
const Body = z.object({
  question: z.string().trim().min(2).max(1000),
  pageUrl: z.string().max(2000).nullish(),
  overrides: z.record(z.string().uuid(), z.string().max(20000)).optional(),
});

export const POST = handle(async (request: NextRequest) => {
  const agent = await requireAgent(request);
  await rateLimit(`policy_test:${agent.id}`, 30, 600);
  const b = await parseBody(request, Body);
  return json(await answerCustomer({ ...b, kind: "test", agentId: agent.id }));
});
