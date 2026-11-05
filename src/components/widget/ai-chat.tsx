"use client";

import { ArrowUp, Check, ImagePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessagePhotos } from "@/components/chat/message-bubble";
import { ProfileAvatar, usePublicProfile } from "@/components/chat/public-profile";
import { Button } from "@/components/ui/button";
import { api, lastSeq, mergeMessages, newClientId, type ChatAttachment, type ChatMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { RevealWords } from "./ask-ai";
import { AttachmentStrip, FilePicker, type Upload, useAttachments } from "./attachments";
import type { InquiryPrefill } from "./order-status";

// 위젯 "AI에게 물어보기" — 여러 번 주고받는 대화.
// 아래 입력칸으로 이어서 묻는다. 담당자가 인박스에서 대화에 참여하면 그 문의의 메시지를 이어서 보여주고, AI 는 더 답하지 않는다.
// 새 답 확인은 위젯이 열려 있고 화면에 보일 때만 몇 초마다 한다 (닫히거나 숨으면 멈춤 → 답은 '내 문의'·배지로 받는다).
const POLL_MS = 4000;
// 답을 받고 이만큼 아무것도 쓰지 않으면 상담원처럼 먼저 "더 궁금한 점 있으세요?" 하고 묻는다 (서버 요청 없음)
const NUDGE_MS = 15000;
const NUDGE_TEXT = "더 궁금한 점 있으시면 편하게 물어보세요.";
const CLOSING_TEXT = "도움이 돼서 다행이에요. 이용해 주셔서 감사합니다!\n\n다른 게 궁금해지면 언제든 여기서 다시 물어보세요.";
const HANDOFF_TEXT =
  "이 내용은 담당자가 직접 확인해야 정확하게 안내드릴 수 있어요.\n\n담당자가 이어서 볼 수 있게 문의로 남겨드릴까요? 주문·배송 상태는 바로 조회할 수도 있어요.";
const ERROR_TEXT = "지금은 답변을 불러오지 못했어요.\n\n잠시 후 다시 물어보시거나, 담당자에게 남겨주세요.";
export const AI_CHAT_KEY = "cstalk_ai_chat";

type Turn = {
  key: string;
  question: string;
  pending: boolean;
  decision?: "answered" | "handoff" | "blocked" | "error";
  answer?: string | null;
  category?: string;
  answerId?: string;
  fresh?: boolean;
  // 이 답 뒤에 이어진 화면 안의 말 (저장하지 않음): 먼저 되묻기 → 고객 빠른 답장 → 마무리 인사
  nudge?: "typing" | "shown";
  reply?: string;
  closing?: "typing" | "shown";
};
type AskResult = {
  chatId: string;
  conversationId: string | null;
  decision: "answered" | "handoff" | "blocked" | "error";
  answer: string | null;
  category: string;
  answerId: string;
};
type Restored = {
  conversationId: string | null;
  turns: { answerId: string; question: string; decision: Turn["decision"]; answer: string | null; category: string }[];
};

// "상담 종료", "대화 종료할게요" 처럼 끝내려는 말만 쓴 경우 AI 에 묻지 않고 대화를 끝낸다
const END_RE = /^\s*(상담|대화|채팅|문의)?\s*(을|를)?\s*(종료|끝)(할게요|할께요|하기|해\s*주세요|해줘|요|낼게요)?\s*[.!~]*\s*$/;

// 대화를 옮겨 온 메시지(AI 문답)는 이미 화면에 있으므로 담당자 참여 뒤의 메시지만 이어서 보여준다
const isCopied = (m: ChatMessage) => /^ai-[qa]:/.test(m.client_message_id ?? "");

export function rememberChat(chatId: string | null) {
  try {
    if (chatId) localStorage.setItem(AI_CHAT_KEY, JSON.stringify({ id: chatId, at: Date.now() }));
    else localStorage.removeItem(AI_CHAT_KEY);
  } catch {}
}

export function AiChat({
  token,
  question,
  resumeChatId,
  pageUrl,
  active,
  onInquiry,
  onOrders,
  onUnresolved,
  onHome,
  upload = null,
}: {
  token: string;
  question: string | null;
  resumeChatId: string | null;
  pageUrl: string | null;
  // 위젯 패널이 열려 있는가 (닫혀 있으면 확인하지 않는다)
  active: boolean;
  onInquiry: (p: InquiryPrefill) => void;
  onOrders: () => void;
  onUnresolved?: () => void;
  onHome: () => void;
  // 있으면 사진 첨부 버튼을 보여준다. 담당자가 참여한 뒤에는 대화에 바로 올리고,
  // 그 전에는 AI 가 사진을 볼 수 없으니 사진을 담아 '문의 남기기'로 넘어간다
  upload?: Upload | null;
}) {
  const profile = usePublicProfile();
  const [chatId, setChatId] = useState<string | null>(resumeChatId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 고객이 '상담 종료'로 끝낸 대화
  const [ended, setEnded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const photos = useAttachments(upload);
  const fileRef = useRef<HTMLInputElement>(null);
  const handoffFileRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const state = useRef({ chatId, conversationId, messages });
  useEffect(() => {
    state.current = { chatId, conversationId, messages };
  });

  const scrollEnd = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));

  const loadConversation = useCallback(
    async (id: string) => {
      const r = await api<{ messages: ChatMessage[] }>(
        `/api/widget/inquiries/${id}/messages?after=${lastSeq(state.current.messages)}`,
        { token },
      );
      if (r.messages.length) {
        setMessages((cur) => mergeMessages(cur, r.messages));
        scrollEnd();
      }
    },
    [token],
  );

  const switchToConversation = useCallback(
    (id: string) => {
      setConversationId(id);
      onUnresolved?.(); // 담당자 답을 쇼핑몰 페이지에서도 배지로 받게
      return loadConversation(id);
    },
    [loadConversation, onUnresolved],
  );

  const ask = useCallback(
    async (q: string, attachments: ChatAttachment[] = []) => {
      setBusy(true);
      setError(null);
      const clientMessageId = newClientId();
      const { conversationId: conv } = state.current;
      try {
        if (conv) {
          // 담당자가 참여한 뒤에는 문의에 이어서 남긴다
          const pending: ChatMessage = {
            id: clientMessageId,
            seq: Number.MAX_SAFE_INTEGER,
            sender_type: "customer",
            agent_name: null,
            body: q,
            attachments,
            client_message_id: clientMessageId,
            created_at: new Date().toISOString(),
            pending: "sending",
          };
          setMessages((cur) => [...cur, pending]);
          scrollEnd();
          const r = await api<{ message: ChatMessage }>(`/api/widget/inquiries/${conv}/messages`, {
            method: "POST",
            token,
            body: JSON.stringify({ clientMessageId, body: q, attachments: attachments.map((a) => a.id) }),
          });
          setMessages((cur) => mergeMessages(cur.filter((m) => m.id !== clientMessageId), [r.message]));
          return;
        }
        const key = clientMessageId;
        setTurns((cur) => [...cur, { key, question: q, pending: true }]);
        scrollEnd();
        const r = await api<AskResult>("/api/widget/ask", {
          method: "POST",
          token,
          body: JSON.stringify({ question: q, pageUrl, chatId: state.current.chatId, clientMessageId }),
        });
        setChatId(r.chatId);
        rememberChat(r.chatId);
        if (r.conversationId) {
          // 묻는 사이 담당자가 참여함 → 질문은 문의에 남았다
          setTurns((cur) => cur.filter((t) => t.key !== key));
          await switchToConversation(r.conversationId);
          return;
        }
        setTurns((cur) =>
          cur.map((t) =>
            t.key === key
              ? { ...t, pending: false, decision: r.decision, answer: r.answer, category: r.category, answerId: r.answerId, fresh: true }
              : t,
          ),
        );
        if (r.decision !== "answered") onUnresolved?.();
        scrollEnd();
      } catch {
        setTurns((cur) => cur.map((t) => (t.pending ? { ...t, pending: false, decision: "error", answer: null } : t)));
        setMessages((cur) => cur.map((m) => (m.pending === "sending" ? { ...m, pending: "failed" } : m)));
        setError("보내지 못했어요. 잠시 후 다시 시도해주세요.");
      } finally {
        setBusy(false);
      }
    },
    [token, pageUrl, switchToConversation, onUnresolved],
  );

  // 처음 열 때: 홈에서 쓴 질문을 묻거나, 다른 페이지에서 나누던 대화를 불러온다 (개발 모드의 effect 두 번 실행에도 한 번)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (resumeChatId) {
      api<Restored>(`/api/widget/ai-chat/${resumeChatId}`, { token })
        .then((r) => {
          setTurns(r.turns.map((t) => ({ key: t.answerId, ...t, pending: false })));
          if (r.conversationId) return switchToConversation(r.conversationId);
          scrollEnd();
        })
        .catch(() => {
          rememberChat(null);
          setChatId(null);
        });
    } else if (question) {
      setTimeout(() => ask(question), 0);
    }
  }, [resumeChatId, question, token, ask, switchToConversation]);

  // 상담 종료: 담당자가 참여한 문의는 종료로 바꾸고, AI 대화는 인박스 '대화 중' 표시를 끈다. 다시 물으면 새 대화로 시작
  const end = async () => {
    setBusy(true);
    setError(null);
    const { conversationId: conv, chatId: id } = state.current;
    try {
      if (conv) await api(`/api/widget/inquiries/${conv}/close`, { method: "POST", token });
      else if (id) await api(`/api/widget/ai-chat/${id}`, { method: "DELETE", token }).catch(() => {});
      rememberChat(null);
      setEnded(true);
      scrollEnd();
    } catch {
      setError("상담을 종료하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  // 열려 있고 화면에 보일 때만 확인: 담당자가 참여했는지 → 참여 뒤에는 새 메시지
  useEffect(() => {
    if (!active || !chatId || ended) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const { conversationId: conv, chatId: id } = state.current;
          if (conv) await loadConversation(conv);
          else if (id) {
            const r = await api<{ conversationId: string | null }>(`/api/widget/ai-chat/${id}?poll=1`, { token });
            if (r.conversationId) await switchToConversation(r.conversationId);
          }
        } catch {}
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    // 다른 탭에 있다 돌아오면 기다리지 않고 바로 확인
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      timer = setTimeout(tick, 0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, chatId, ended, token, loadConversation, switchToConversation]);

  const lastTurn = turns[turns.length - 1];
  const inquiryPrefill = (t: Turn | undefined): InquiryPrefill => ({
    category: t?.category ?? "etc",
    fromAi: t ? { question: t.question, answer: t.decision === "answered" ? (t.answer ?? null) : null, answerId: t.answerId ?? null } : undefined,
  });
  const sendFeedback = (t: Turn, helpful: boolean) => {
    setFeedback((f) => ({ ...f, [t.key]: helpful }));
    if (t.answerId)
      api(`/api/widget/ask/${t.answerId}/feedback`, { method: "POST", token, body: JSON.stringify({ helpful }) }).catch(() => {});
    if (!helpful) {
      onUnresolved?.();
      onInquiry(inquiryPrefill(t));
    }
  };
  const patchTurn = (key: string, patch: Partial<Turn>) =>
    setTurns((cur) => cur.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  // '다 해결됐어요': 해결 기록을 남기고 고객 말 → 잠깐 입력 중 → 마무리 인사. 대화는 끝내지 않아 이어서 물을 수 있다
  const resolve = (t: Turn) => {
    sendFeedback(t, true);
    patchTurn(t.key, { reply: "다 해결됐어요", closing: "typing" });
    scrollEnd();
    setTimeout(() => {
      patchTurn(t.key, { closing: "shown" });
      scrollEnd();
    }, 900);
  };

  // 가장 최근 답 뒤로 고객이 15초 동안 아무것도 쓰지 않으면 먼저 되묻는다 (답마다 버튼을 붙이지 않는 대신)
  const nudgeKey =
    active &&
    !busy &&
    !draft &&
    !conversationId &&
    !ended &&
    lastTurn?.decision === "answered" &&
    !lastTurn.nudge &&
    feedback[lastTurn.key] === undefined
      ? lastTurn.key
      : null;
  useEffect(() => {
    if (!nudgeKey) return;
    // 입력 중 표시를 띄우면 nudgeKey 가 바뀌어 정리되지만, 이어지는 표시는 그대로 끝까지 간다
    const typing = setTimeout(() => {
      patchTurn(nudgeKey, { nudge: "typing" });
      scrollEnd();
      setTimeout(() => {
        patchTurn(nudgeKey, { nudge: "shown" });
        scrollEnd();
      }, 900);
    }, NUDGE_MS);
    return () => clearTimeout(typing);
  }, [nudgeKey]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    const attachments: ChatAttachment[] = conversationId
      ? photos.items.flatMap((x) =>
          x.status === "done" && x.id ? [{ id: x.id, type: x.type ?? "image/jpeg", size: x.size ?? 0, url: x.preview }] : [],
        )
      : [];
    if ((q.length < 2 && !attachments.length) || busy || photos.uploading) return;
    setDraft("");
    if (!attachments.length && END_RE.test(q)) return void end();
    photos.reset();
    ask(q, attachments);
  };
  const followUps = messages.filter((m) => !isCopied(m));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-5" aria-live="polite">
        <p className="self-center text-center text-[11px] leading-relaxed text-ink-3">
          AI가 먼저 답하고, 필요하면 담당자가 이어서 답해요
          <br />
          정책 안내를 기준으로 답해요
        </p>
        {turns.map((t) => {
          const latest = t === lastTurn && !conversationId && !ended;
          return (
            <div key={t.key} className="flex flex-col gap-4">
              <CustomerBubble>{t.question}</CustomerBubble>
              {t.pending ? (
                <Typing />
              ) : t.decision === "answered" && t.answer ? (
                <>
                  <AiBubble name={profile.name} text={t.answer} reveal={t.fresh} />
                  {t.nudge === "typing" && <Typing />}
                  {t.nudge === "shown" && <AiBubble name={profile.name} text={NUDGE_TEXT} reveal />}
                  {latest && t.nudge === "shown" && !t.reply && (
                    <QuickReplies
                      items={[
                        ["다 해결됐어요", () => resolve(t)],
                        ["담당자에게 물어볼래요", () => sendFeedback(t, false)],
                      ]}
                    />
                  )}
                  {t.reply && <CustomerBubble>{t.reply}</CustomerBubble>}
                  {t.closing === "typing" && <Typing />}
                  {t.closing === "shown" && <AiBubble name={profile.name} text={CLOSING_TEXT} reveal />}
                </>
              ) : (
                <>
                  <AiBubble
                    name={profile.name}
                    text={t.decision === "error" ? ERROR_TEXT : HANDOFF_TEXT}
                    reveal={t.fresh}
                  />
                  {latest && (
                    <QuickReplies
                      items={[
                        ["담당자에게 남기기", () => onInquiry(inquiryPrefill(t))],
                        ["주문·배송 조회", onOrders],
                      ]}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}

        {conversationId && (
          <>
            <p className="flex items-center gap-2.5 text-[11.5px] font-medium text-signal-text before:h-px before:flex-1 before:bg-signal/25 after:h-px after:flex-1 after:bg-signal/25">
              담당자가 이어서 답변해요
            </p>
            {followUps.map((m) =>
              m.sender_type === "customer" ? (
                <div
                  key={m.client_message_id ?? m.id}
                  className={cn(
                    "max-w-[85%] self-end rounded-[16px_4px_16px_16px] bg-bubble-customer px-3.5 py-2.5 text-sm whitespace-pre-wrap text-bubble-customer-foreground",
                    m.pending === "sending" && "opacity-60",
                  )}
                >
                  {!!m.attachments?.length && (
                    <MessagePhotos items={m.attachments} mine />
                  )}
                  {m.body && <span className={cn(m.attachments?.length && "mt-1.5 block")}>{m.body}</span>}
                  {m.pending === "failed" && <span className="mt-1 block text-[11px] opacity-80">보내지 못했어요</span>}
                </div>
              ) : m.sender_type === "system" ? null : (
                <div key={m.id} className="flex flex-col gap-1.5">
                  <Sender name={profile.name} />
                  {!!m.attachments?.length && <MessagePhotos items={m.attachments} mine={false} />}
                  {m.body && (
                    <div className="max-w-[92%] rounded-[4px_16px_16px_16px] bg-bubble-agent px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-bubble-agent-foreground shadow-[var(--cs-edge),0_0_0_1.5px_oklch(54%_0.2_266/0.35)]">
                      {m.body}
                    </div>
                  )}
                </div>
              ),
            )}
          </>
        )}

        {ended && (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-raised p-5 text-center edge">
            <span className="grid size-9 place-items-center rounded-xl bg-ok/15 text-ok-text">
              <Check className="size-4" strokeWidth={2} />
            </span>
            <p className="text-sm font-semibold">상담이 종료됐어요</p>
            <p className="text-xs leading-relaxed break-keep text-muted-foreground">
              이용해 주셔서 감사합니다. 더 궁금한 점이 생기면 언제든 다시 물어보세요.
              {conversationId && (
                <>
                  <br />
                  나눈 대화는 &lsquo;내 문의&rsquo;에서 다시 볼 수 있어요.
                </>
              )}
            </p>
            <Button variant="outline" className="mt-2 h-10 w-full max-w-60 rounded-xl" onClick={onHome}>
              처음으로
            </Button>
          </div>
        )}
      </div>

      {!ended && (
      <form onSubmit={submit} className="flex shrink-0 flex-col gap-1.5 border-t px-3.5 pt-2.5 pb-3.5">
        {conversationId && upload && <AttachmentStrip state={photos} className="px-0.5 pb-1" />}
        <div className="flex items-end rounded-2xl border border-input bg-panel-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          {upload && (
            <>
              <button
                type="button"
                disabled={busy || (conversationId ? photos.full : false)}
                onClick={() => (conversationId ? fileRef : handoffFileRef).current?.click()}
                className="m-1 mr-0 grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-panel-3 hover:text-foreground disabled:opacity-40"
                aria-label="사진·동영상 첨부"
                title={conversationId ? "사진·동영상 첨부" : "사진·동영상은 담당자가 확인해요 · 문의 남기기로 이어져요"}
              >
                <ImagePlus className="size-[18px]" strokeWidth={1.75} />
              </button>
              <FilePicker state={photos} inputRef={fileRef} />
              <input
                ref={handoffFileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (!files.length) return;
                  onUnresolved?.();
                  onInquiry({ ...inquiryPrefill(lastTurn), photos: files });
                }}
              />
            </>
          )}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            placeholder={conversationId ? "담당자에게 이어서 보내기" : "메시지를 입력하세요"}
            aria-label={conversationId ? "담당자에게 메시지" : "AI에게 이어서 질문"}
            className="min-w-0 flex-1 bg-transparent py-2.5 pr-1.5 pl-3.5 text-sm outline-none placeholder:text-ink-3"
          />
          <Button
            type="submit"
            size="icon"
            className="m-1 size-8 shrink-0 rounded-xl"
            aria-label="보내기"
            disabled={busy || photos.uploading || (draft.trim().length < 2 && !(conversationId && photos.ids.length))}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
        <div className="flex items-start gap-2 px-1">
          <p className={cn("min-w-0 flex-1 text-[11px] leading-relaxed", error ? "text-destructive" : "text-ink-3")}>
            {error ??
              (conversationId
                ? "답변은 이 화면과 '내 문의'에 남아요."
                : "답하기 어려운 건 담당자에게 넘겨드려요.")}
          </p>
          {(turns.length > 0 || conversationId) && (
            <button
              type="button"
              onClick={end}
              disabled={busy}
              className="shrink-0 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              상담 종료
            </button>
          )}
        </div>
      </form>
      )}
    </div>
  );
}

// AI 안내는 대화 맨 위에 한 번만 두고, 답마다 꼬리표를 달지 않는다
function Sender({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
      <ProfileAvatar size="xs" />
      {name}
    </span>
  );
}

function CustomerBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[85%] self-end rounded-[16px_4px_16px_16px] bg-bubble-customer px-3.5 py-2.5 text-sm whitespace-pre-wrap text-bubble-customer-foreground widget-rise">
      {children}
    </div>
  );
}

function AiBubble({ name, text, reveal }: { name: string; text: string; reveal?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Sender name={name} />
      <div className="max-w-[92%] rounded-[4px_16px_16px_16px] bg-bubble-agent px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-bubble-agent-foreground edge">
        {reveal ? <RevealWords text={text} /> : text}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div
      role="status"
      aria-label="답변을 쓰고 있어요"
      className="flex h-[38px] items-center gap-1 self-start rounded-[4px_16px_16px_16px] bg-bubble-agent px-3.5 edge widget-rise"
    >
      {[0, 150, 300].map((d) => (
        <i key={d} className="size-1.5 rounded-full bg-ink-3 widget-typing-dot" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}

// 누르면 고객이 그 말을 한 것처럼 이어진다
function QuickReplies({ items }: { items: [string, () => void][] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5 widget-rise">
      {items.map(([label, onClick]) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          className="h-8 rounded-full bg-raised px-3 text-[13px] font-medium text-signal-text shadow-[var(--cs-edge),0_0_0_1px_oklch(54%_0.2_266/0.22)] transition-colors hover:bg-card"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
