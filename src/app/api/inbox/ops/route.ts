import type { NextRequest } from "next/server";
import { requireAgent } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { healthReport } from "@/lib/ops";

// 설정 화면 "운영 상태" 카드
export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  return json(await healthReport());
});
