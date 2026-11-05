import type { Instrumentation } from "next";

// 화면 렌더·서버 액션 중 서버 오류를 오류 기록에 남긴다 (src/lib/errors.ts).
// API 라우트(routeType "route")는 http.ts handle() 이 이미 남기므로 건너뛴다 — 같은 오류를 두 번 세지 않게.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (context.routeType !== "render" && context.routeType !== "action") return;
  const { areaFromPath, logError } = await import("@/lib/errors");
  await logError({
    source: "render",
    where: `${context.routeType} ${context.routePath}`,
    area: areaFromPath(context.routePath.replace(/^\/app/, "")),
    err,
  });
};
