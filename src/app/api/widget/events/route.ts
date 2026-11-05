import { z } from "zod";
import { resolveEnv } from "@/lib/errors";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { ClientEvent, insertUsage } from "@/lib/usage";
import { verifyVisitorSession } from "@/lib/widget-token";

// 위젯 행동 기록 (src/lib/client/track.ts). 위젯을 연 뒤에만 호출된다.
// sendBeacon 은 헤더를 못 붙이므로 방문자 토큰을 본문으로 받는다.
// 누가(actor·contact)·어디서(env)는 토큰으로 정하고, 본문의 값은 쓰지 않는다. 허용 목록에 없는 이벤트는 조용히 버린다.
const MAX_BYTES = 8192;
const MAX_EVENTS = 20;
const Body = z.object({
  token: z.string().min(10).max(2000),
  events: z.array(z.unknown()).max(MAX_EVENTS),
});
const Envelope = z.object({ id: z.string().uuid(), at: z.number().int().positive() });

export const POST = handle(async (request: Request) => {
  const text = await request.text();
  if (text.length > MAX_BYTES) throw new HttpError(413, "too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const body = Body.safeParse(raw);
  if (!body.success) throw new HttpError(400, "invalid_body");
  const session = await verifyVisitorSession(body.data.token);
  if (!session) throw new HttpError(401, "invalid_visitor");
  await rateLimit(`events:${session.contactId}`, 20, 60);
  const env = await resolveEnv(session.env);

  const now = Date.now();
  const rows = body.data.events.flatMap((e) => {
    const env_ = Envelope.safeParse(e);
    const ev = ClientEvent.safeParse(e);
    if (!env_.success || !ev.success) return [];
    // 기기 시계가 크게 틀리면 받은 시각으로 쓴다
    const at = env_.data.at > now + 5 * 60_000 || env_.data.at < now - 86_400_000 ? now : env_.data.at;
    return [{ ...ev.data, eventId: env_.data.id, occurredAt: new Date(at), actor: "customer" as const, contactId: session.contactId, env }];
  });
  const saved = await insertUsage(rows);
  return json({ saved });
});
