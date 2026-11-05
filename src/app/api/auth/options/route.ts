import { allowedDomains, googleConfigured, passwordLoginEnabled } from "@/lib/access";
import { handle, json } from "@/lib/http";

// 로그인 화면이 어떤 방법을 보여줄지 (비밀값 없음)
export const GET = handle(async () =>
  json({ google: googleConfigured(), password: await passwordLoginEnabled(), domains: allowedDomains() }),
);
