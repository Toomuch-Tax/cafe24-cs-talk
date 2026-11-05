import type { z } from "zod";
import { areaFromPath, captureError, requestStore, routeTemplate } from "./errors";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new HttpError(400, "invalid_body");
  return result.data;
}

// 라우트 핸들러를 감싸 HttpError 를 JSON 응답으로 바꾼다.
// 500 과 외부 API 오류(5xx HttpError, 예: Cafe24 502/503)는 오류 기록에 남긴다 (src/lib/errors.ts). 4xx 는 남기지 않는다.
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    const req = args[0] instanceof Request ? args[0] : null;
    const run = () => fn(...args);
    try {
      return await (req ? requestStore.run({ request: req }, run) : run());
    } catch (err) {
      const path = req ? new URL(req.url).pathname : "unknown";
      const where = req ? `${req.method} ${routeTemplate(path)}` : "unknown";
      if (err instanceof HttpError) {
        // 외부 API(Cafe24) 오류는 원인 파악을 위해 설명을 함께 내려준다 (비밀값은 포함되지 않음)
        const detail = "detail" in err && typeof err.detail === "string" ? err.detail : undefined;
        if (detail) console.error(err.message, detail);
        if (err.status >= 500) {
          // 응답 본문(detail)은 기록하지 않고 코드만 남긴다
          const record = () =>
            captureError({ source: "external", where, area: areaFromPath(path), err: new Error(err.message), status: err.status, code: err.message });
          if (req) requestStore.run({ request: req }, record);
          else record();
        }
        return json({ error: err.message, ...(detail ? { detail } : {}) }, { status: err.status });
      }
      const record = () => captureError({ source: "server", where, area: areaFromPath(path), err, status: 500 });
      if (req) requestStore.run({ request: req }, record);
      else record();
      return json({ error: "internal_error" }, { status: 500 });
    }
  };
}
