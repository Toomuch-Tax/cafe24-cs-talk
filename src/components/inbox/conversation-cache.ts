import { api, type ChatMessage } from "@/lib/client/api";
import type { ConversationDetail } from "./customer-panel";

// 인박스에서 열어 본 문의를 이 탭의 메모리에만 잠깐 기억한다 (새로고침·로그아웃하면 사라짐).
// 다시 열 때 바로 그리고, 최신 내용은 뒤이어 받아 바꾼다. 서버 호출 수는 늘지 않는다.
export type ConversationData = ConversationDetail & { messages: ChatMessage[] };

const MAX = 30;
// 이 시간 안에 받은 내용이면 다시 요청하지 않는다 (목록에서 미리 받은 것을 화면이 그대로 쓰도록)
const FRESH_MS = 3000;
const cache = new Map<string, { data: ConversationData; at: number }>();
const inflight = new Map<string, Promise<ConversationData>>();

export const cachedConversation = (id: string) => cache.get(id)?.data;

export function rememberConversation(id: string, data: ConversationData, at = Date.now()) {
  cache.delete(id);
  cache.set(id, { data: { ...data, messages: data.messages.filter((m) => !m.pending) }, at });
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
}

export function fetchConversation(id: string): Promise<ConversationData> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.data);
  let p = inflight.get(id);
  if (!p) {
    p = api<ConversationData>(`/api/inbox/conversations/${id}`)
      .then((d) => (rememberConversation(id, d), d))
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

export function forgetConversations() {
  cache.clear();
  inflight.clear();
}
