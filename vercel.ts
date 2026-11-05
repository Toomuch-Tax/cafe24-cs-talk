import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  // Supabase DB(서울)와 같은 리전에서 함수를 실행해 DB 왕복 지연을 줄인다
  regions: ["icn1"],
  // 답변 메일 재시도 + 7일 지난 답변 완료 문의 자동 종료
  crons: [{ path: "/api/cron/jobs", schedule: "*/10 * * * *" }],
};
