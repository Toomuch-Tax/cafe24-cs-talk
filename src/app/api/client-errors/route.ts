import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAgent } from "@/lib/auth";
import { logError, resolveEnv } from "@/lib/errors";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { verifyVisitorSession } from "@/lib/widget-token";

// 브라우저 오류 수집 (src/lib/client/report-error.ts). 위젯은 방문자 토큰, 콘솔은 로그인 세션이 있어야 받는다.
const MAX_BYTES = 4096;
const Body = z.object({
  kind: z.enum(["widget", "console"]),
  where: z.string().regex(/^[\w\-/:[\]]{1,80}$/),
  message: z.string().min(1).max(500),
  stack: z.string().max(2000).nullable().optional(),
});

export const POST = handle(async (request: NextRequest) => {
  const text = await request.text();
  if (text.length > MAX_BYTES) throw new HttpError(413, "too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid_body");
  const body = parsed.data;

  let who: string;
  let env;
  if (body.kind === "widget") {
    const session = await verifyVisitorSession(request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
    if (!session) throw new HttpError(401, "invalid_visitor");
    who = `c:${session.contactId}`;
    env = await resolveEnv(session.env);
  } else {
    const agent = await getAgent(request);
    if (!agent) throw new HttpError(401, "unauthorized");
    who = `a:${agent.id}`;
    env = await resolveEnv("live");
  }
  await rateLimit(`client_err:${who}`, 5, 60);

  const err = new Error(body.message);
  err.stack = body.stack ?? undefined;
  await logError({
    source: body.kind === "widget" ? "client_widget" : "client_console",
    where: body.where,
    area: body.kind === "widget" ? "widget" : "inbox",
    err,
    env,
  });
  return json({ ok: true });
});
