import { sql } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { verifyVisitorToken } from "@/lib/widget-token";

// 쇼핑몰 페이지의 로더가 직접 부르는 유일한 API: 새 답변 수(버튼 배지용).
// 문의를 남긴 적이 있는 방문자만 호출하므로 방문자 수에 비례하지 않는다.
const allowed = (process.env.WIDGET_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function cors(request: Request) {
  const origin = request.headers.get("origin");
  const h: Record<string, string> = { "cache-control": "no-store", vary: "origin" };
  if (origin && allowed.includes(origin)) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-headers"] = "authorization";
    h["access-control-allow-methods"] = "GET, OPTIONS";
    h["access-control-max-age"] = "86400";
  }
  return h;
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request) });
}

export const GET = handle(async (request: Request) => {
  const headers = cors(request);
  const contactId = await verifyVisitorToken(request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  if (!contactId) return json({ count: 0 }, { headers });
  await rateLimit(`unread:${contactId}`, 30, 60);
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from conversations
    where contact_id = ${contactId} and submitted_at is not null
      and last_agent_reply_at is not null and last_agent_reply_at > coalesce(customer_last_read_at, 'epoch')`;
  return json({ count: row?.count ?? 0 }, { headers });
});
