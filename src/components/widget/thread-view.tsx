"use client";

import { ArrowUp, ImagePlus, PenLine, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Chip } from "@/components/ui/chip";
import { ApiError, lastSeq, mergeMessages, newClientId, type ChatAttachment, type ChatMessage } from "@/lib/client/api";
import { AttachmentStrip, FilePicker, type Upload, useAttachments } from "./attachments";

// 문의 1건의 대화. 실시간 채팅이 아니므로 화면이 열려 있을 때만 느슨하게(15초) 새 답변을 확인한다.
const POLL_MS = 15_000;

export const INQUIRY_STATUS: Record<string, { label: string; tone: "neutral" | "signal" | "ok" }> = {
  open: { label: "답변 준비 중", tone: "neutral" },
  waiting_customer: { label: "답변 완료", tone: "ok" },
  resolved: { label: "종료", tone: "neutral" },
};

export function ThreadView({
  load,
  send,
  sla,
  emailEnabled = false,
  upload = null,
  close,
  onCompactChange,
}: {
  load: (after: number) => Promise<{ status: string; messages: ChatMessage[] }>;
  send: (m: { clientMessageId: string; body: string; attachments: string[] }) => Promise<ChatMessage>;
  sla: string;
  emailEnabled?: boolean;
  // 있으면 사진 첨부 버튼을 보여준다 (위젯 '내 문의')
  upload?: Upload | null;
  // 있으면 고객이 직접 상담을 종료하는 버튼을 보여준다 (다시 남기면 다시 열림)
  close?: () => Promise<unknown>;
  // 휴대폰에서 작성 중(키보드가 올라온 상태)이면 true — 부모가 헤더를 줄이는 데 쓴다
  onCompactChange?: (compact: boolean) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // 채팅 입력창처럼 항상 열어두지 않고, 버튼을 눌러야 문의 작성 칸이 열린다
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  // 휴대폰(터치)에서 입력칸에 포커스 = 키보드가 올라온 상태
  const [keyboard, setKeyboard] = useState(false);
  // 키보드가 화면 절반을 덮으므로, 작성 중에는 상태 줄을 접어 대화가 보일 공간을 남긴다
  const compact = composing && keyboard;
  const onCompactRef = useRef(onCompactChange);
  useEffect(() => {
    onCompactRef.current = onCompactChange;
  });
  useEffect(() => onCompactRef.current?.(compact), [compact]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const photos = useAttachments(upload);
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 부모가 매 렌더마다 새 함수를 넘겨도 polling 이 재시작되지 않도록 ref 로 들고 있는다
  const loadRef = useRef(load);
  const sendRef = useRef(send);
  useEffect(() => {
    messagesRef.current = messages;
    loadRef.current = load;
    sendRef.current = send;
  });

  const refresh = useCallback(async () => {
    try {
      const r = await loadRef.current(lastSeq(messagesRef.current));
      setStatus(r.status);
      if (r.messages.length) setMessages((cur) => mergeMessages(cur, r.messages));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "link_expired" ? "링크가 만료됐어요." : "불러오지 못했어요.");
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await refresh();
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, composing]);

  // 작성 칸이 열리거나 키보드가 올라와 대화 영역이 줄어들면, 맨 아래를 보던 중이었을 때 최신 메시지에 붙여 둔다
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let atBottom = true;
    const onScroll = () => {
      atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    };
    const ro = new ResizeObserver(() => {
      if (atBottom) el.scrollTo({ top: el.scrollHeight });
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  const submit = async (retry?: ChatMessage) => {
    const body = retry?.body ?? draft.trim();
    const attachments: ChatAttachment[] =
      retry?.attachments ??
      photos.items.flatMap((x) =>
        x.status === "done" && x.id
          ? [{ id: x.id, type: x.type ?? "image/jpeg", size: x.size ?? 0, url: x.preview }]
          : [],
      );
    if (!body && !attachments.length) return;
    if (!retry && photos.uploading) return;
    const clientMessageId = retry?.client_message_id ?? newClientId();
    if (!retry) {
      setDraft("");
      photos.reset();
      setComposing(false);
    }
    const temp: ChatMessage = {
      id: clientMessageId,
      seq: Number.MAX_SAFE_INTEGER,
      sender_type: "customer",
      agent_name: null,
      body,
      attachments,
      client_message_id: clientMessageId,
      created_at: new Date().toISOString(),
      pending: "sending",
    };
    setMessages((cur) =>
      mergeMessages(
        cur.filter((m) => m.client_message_id !== clientMessageId),
        [temp],
      ),
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const saved = await sendRef.current({ clientMessageId, body, attachments: attachments.map((a) => a.id) });
        setMessages((cur) => mergeMessages(cur, [saved]));
        setStatus("open");
        return;
      } catch (err) {
        if (err instanceof ApiError && err.status < 500 && err.status !== 429) break;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    setMessages((cur) => cur.map((m) => (m.client_message_id === clientMessageId ? { ...m, pending: "failed" } : m)));
  };

  const endChat = async () => {
    if (!close) return;
    setClosing(true);
    try {
      await close();
      setStatus("resolved");
      setError(null);
    } catch {
      setError("상담을 종료하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setClosing(false);
    }
  };

  const st = status ? INQUIRY_STATUS[status] : null;
  const lastIsCustomer = messages.filter((m) => !m.pending).at(-1)?.sender_type === "customer";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {st && !compact && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2 text-xs edge">
          <Chip tone={st.tone}>{st.label}</Chip>
          <span className="truncate text-muted-foreground">
            {status === "open"
              ? `${sla} 답변드려요${emailEnabled ? " · 확인 전이면 이메일로도 알려드려요" : ""}`
              : status === "waiting_customer"
                ? "더 궁금한 점은 이어서 남겨주세요."
                : "추가 문의를 남기면 다시 열려요."}
          </span>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3" aria-live="polite">
        {messages.map((m) => (
          <MessageBubble key={m.client_message_id ?? m.id} message={m} viewer="customer" onRetry={(x) => submit(x)} />
        ))}
        {status === "open" && lastIsCustomer && !composing && (
          <Notice tone="success" size="sm" className="mx-4 my-3">
            <b className="font-semibold">접수 완료</b> · 바로 답변이 오지 않아요. {sla}{" "}
            {emailEnabled
              ? "답변드리고, 확인하지 않으시면 이메일로도 알려드려요."
              : "답변드리고, 답변이 등록되면 여기에 표시돼요."}
          </Notice>
        )}
        {error && (
          <Notice tone="error" size="sm" className="mx-4 my-2">
            {error}
          </Notice>
        )}
      </div>
      {status && !composing && (
        <div className="flex gap-2 border-t p-3">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setComposing(true)}>
            <PenLine className="size-4" strokeWidth={1.75} />
            {status === "resolved" ? "추가 문의 남기기" : "이어서 문의 남기기"}
          </Button>
          {close && status !== "resolved" && (
            <Button type="button" variant="ghost" className="text-muted-foreground" disabled={closing} onClick={endChat}>
              {closing ? "종료 중…" : "상담 종료"}
            </Button>
          )}
        </div>
      )}
      {status && composing && (
        <form
          className="flex flex-col gap-2 border-t px-2.5 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {upload && <AttachmentStrip state={photos} />}
          {/* 메신저처럼 한 줄에서 시작해 4줄까지 늘어나는 입력창 (키보드가 올라와도 대화가 보이도록) */}
          <div className="flex items-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setComposing(false)}
              className="size-9 shrink-0 rounded-full text-muted-foreground"
              aria-label="작성 취소"
            >
              <X className="size-[18px]" strokeWidth={1.75} />
            </Button>
            {upload && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={photos.full}
                  onClick={() => fileRef.current?.click()}
                  className="size-9 shrink-0 rounded-full text-muted-foreground"
                  aria-label="사진·동영상 첨부"
                >
                  <ImagePlus className="size-[18px]" strokeWidth={1.75} />
                </Button>
                <FilePicker state={photos} inputRef={fileRef} />
              </>
            )}
            <div className="flex min-w-0 flex-1 items-end gap-1 rounded-[20px] border border-input bg-panel-2 py-[3px] pr-[3px] pl-3.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <textarea
                ref={inputRef}
                autoFocus
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  // field-sizing 을 지원하지 않는 브라우저용 자동 높이
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onFocus={() => setKeyboard(window.matchMedia("(pointer: coarse)").matches)}
                onBlur={() => setKeyboard(false)}
                placeholder="문의 내용을 남겨주세요"
                rows={1}
                maxLength={3000}
                autoComplete="off"
                className="field-sizing-content max-h-[6.75rem] min-w-0 flex-1 resize-none bg-transparent py-[5px] text-base leading-normal outline-none placeholder:text-muted-foreground"
                aria-label="추가 문의 입력"
              />
              <Button
                type="submit"
                size="icon"
                disabled={photos.uploading || (!draft.trim() && !photos.ids.length)}
                className="size-8 shrink-0 rounded-full"
                aria-label="문의 보내기"
              >
                <ArrowUp className="size-4" strokeWidth={2.2} />
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
