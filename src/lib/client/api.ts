"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail?: string) {
    super(code);
  }
}

export async function api<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(rest.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed", data.detail);
  return data as T;
}

export const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

export type ChatAttachment = { id: string; type: string; size: number; url: string | null };

export type ChatMessage = {
  id: string;
  seq: number;
  sender_type: "customer" | "agent" | "ai" | "system";
  agent_name: string | null;
  body: string;
  attachments?: ChatAttachment[];
  internal?: boolean;
  ai_kind?: "auto_sent" | "draft" | null;
  client_message_id: string | null;
  created_at: string;
  // 클라이언트 전용: 전송 중/실패 상태
  pending?: "sending" | "failed";
};

// seq 기준으로 합치고, 서버에 저장된 메시지가 오면 같은 client_message_id 의 임시 메시지를 대체한다.
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byClientId = new Set(incoming.map((m) => m.client_message_id).filter(Boolean));
  const kept = current.filter((m) => !(m.pending && m.client_message_id && byClientId.has(m.client_message_id)));
  const seen = new Set(kept.filter((m) => !m.pending).map((m) => m.id));
  const merged = [...kept, ...incoming.filter((m) => !seen.has(m.id))];
  const saved = merged.filter((m) => !m.pending).sort((a, b) => a.seq - b.seq);
  const pending = merged.filter((m) => m.pending);
  return [...saved, ...pending];
}

export const lastSeq = (messages: ChatMessage[]) =>
  messages.reduce((max, m) => (m.pending ? max : Math.max(max, m.seq)), 0);
