"use client";

import { newClientId } from "./api";

// 위젯 행동 기록 버퍼 (서버: /api/widget/events, 허용 목록: src/lib/usage.ts).
// - 위젯이 열린 뒤에만 쌓인다 (쇼핑몰 페이지를 보기만 하는 방문자는 호출 0).
// - widget_open 은 바로 보내고(분모가 빠지지 않게), 나머지는 숨김·닫힘 때 sendBeacon 으로 한 번에 보낸다.
// - 몇 건 빠져도 괜찮다. 같은 이벤트를 다시 보내도 서버가 id 로 한 번만 저장한다.

type Event =
  | { name: "widget_open"; props: { page_type: PageType; member: boolean } }
  | { name: "menu_click"; props: { menu: "order" | "ai" | "inquiry" | "restock" | "size" } }
  | { name: "ai_handoff_click"; props: { from: "ai_chat" | "ask_ai" } }
  | { name: "login_nudge_click"; props: { at: "inquiry" | "orders" | "orders_gate" | "submitted"; action: "login" | "signup" | "guest" } };
type PageType = "main" | "product" | "list" | "cart" | "order" | "mypage" | "other";

const MAX_BATCH = 20;
let token: string | null = null;
const buffer: (Event & { id: string; at: number })[] = [];

export const setTrackToken = (t: string | null) => {
  token = t;
};

// 쇼핑몰 주소 → 페이지 종류 (실제 경로·상품번호는 보내지 않는다)
export function pageTypeOf(url: string | null): PageType {
  if (!url) return "other";
  let path: string;
  try {
    path = new URL(url).pathname.replace(/^\/skin-skin\d+/, "");
  } catch {
    return "other";
  }
  if (path === "/" || path === "/index.html") return "main";
  if (/^\/product\/list|^\/category\//.test(path)) return "list";
  if (/^\/product\//.test(path) || /^\/surl\/p\//.test(path)) return "product";
  if (/^\/order\/basket/.test(path)) return "cart";
  if (/^\/order\//.test(path)) return "order";
  if (/^\/myshop\//.test(path) || /^\/member\//.test(path)) return "mypage";
  return "other";
}

export function trackEvent(e: Event, opts: { now?: boolean } = {}) {
  buffer.push({ ...e, id: newClientId(), at: Date.now() });
  if (opts.now || buffer.length >= MAX_BATCH) flushEvents(false);
}

export function flushEvents(beacon: boolean) {
  if (!token || !buffer.length) return;
  const events = buffer.splice(0, MAX_BATCH);
  const body = JSON.stringify({ token, events });
  if (beacon && navigator.sendBeacon?.("/api/widget/events", new Blob([body], { type: "application/json" }))) return;
  fetch("/api/widget/events", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {
    // 한 번만 다시 시도한다 (같은 id 라 중복 저장되지 않음)
    if (buffer.length < MAX_BATCH * 2) buffer.unshift(...events);
  });
}

// 탭이 숨겨지면 남은 기록을 보낸다 (모바일은 pagehide 가 안 오는 경우가 있어 visibilitychange 를 쓴다)
let installed = false;
export function installTrackFlush() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushEvents(true);
  });
}
