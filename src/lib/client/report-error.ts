"use client";

// 브라우저 오류를 서버 오류 기록(/api/client-errors)으로 보낸다.
// - 위젯(/widget)은 방문자 토큰으로, 운영 콘솔은 로그인 쿠키로 인증한다. 인증이 없으면 서버가 버린다.
// - 같은 오류는 페이지당 한 번만, 페이지당 최대 5건까지 보낸다.
// - 서버 렌더 오류(digest 가 있는 것)는 서버(instrumentation.ts)가 이미 남겼으므로 보내지 않는다.

const TOKEN_KEY = "cstalk_visitor_token"; // widget-app.tsx 와 같은 키
const sent = new Set<string>();
let screen: string | null = null;

// 위젯이 지금 보고 있는 화면 이름 (home, orders, ask …) — 오류 위치로 쓴다
export const setClientScreen = (name: string) => {
  screen = name;
};

export function reportClientError(err: unknown) {
  if (typeof window === "undefined") return;
  if (err && typeof err === "object" && "digest" in err && (err as { digest?: unknown }).digest) return;
  const message = err instanceof Error ? err.message || err.name : String(err ?? "unknown");
  const stack = err instanceof Error ? (err.stack ?? null) : null;
  const key = message.slice(0, 120);
  if (sent.has(key) || sent.size >= 5) return;
  sent.add(key);

  const widget = location.pathname.startsWith("/widget");
  let token: string | null = null;
  if (widget) {
    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch {}
    if (!token) return;
  }
  const where = widget ? `widget:${screen ?? "unknown"}` : location.pathname;
  fetch("/api/client-errors", {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ kind: widget ? "widget" : "console", where, message: message.slice(0, 500), stack: stack?.slice(0, 2000) ?? null }),
  }).catch(() => {});
}

// 오류 경계에 잡히지 않은 오류 (이벤트 핸들러·비동기). 한 번만 건다.
let installed = false;
export function installErrorReporter() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    // 이미지·스크립트 로드 실패(e.error 없음)는 무시한다
    if (e.error) reportClientError(e.error);
  });
  window.addEventListener("unhandledrejection", (e) => reportClientError(e.reason));
}
