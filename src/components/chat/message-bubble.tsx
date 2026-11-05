"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Play, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { formatTime, type ChatAttachment, type ChatMessage } from "@/lib/client/api";
import { ProfileAvatar, usePublicProfile } from "./public-profile";

// 고객 화면: 상담원 답변이든 AI 답변이든 설정한 이름·로고 하나로 보인다. AI 답변은 작은 표시만 덧붙인다.
function CustomerSideSender({ ai }: { ai: boolean }) {
  const profile = usePublicProfile();
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
      <ProfileAvatar size="xs" />
      {profile.name}
      {ai && <span className="rounded-full bg-panel-3 px-1.5 py-px text-[10px] font-medium text-ink-3">AI 답변</span>}
    </span>
  );
}

// 상담원 화면: 누가 썼는지(실명)·AI 초안 여부를 그대로 보여준다
function AgentSideSender({ message }: { message: ChatMessage }) {
  const label =
    message.sender_type === "ai"
      ? message.ai_kind === "draft"
        ? "AI 초안 (고객 미노출)"
        : "AI 상담"
      : message.sender_type === "agent"
        ? (message.agent_name ?? "상담원")
        : null;
  if (!label) return null;
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
      {message.internal ? `내부 메모 · ${label}` : label}
    </span>
  );
}

const isVideo = (a: ChatAttachment) => a.type.startsWith("video/");

// 첨부 사진·동영상. 서명 URL 이라 1시간 뒤 만료 → 화면을 다시 열면 새로 받는다.
// 누르면 새 탭 없이 화면 위 뷰어로 크게 본다 (고객 위젯·상담원 화면 공통).
export function MessagePhotos({ items, mine }: { items: ChatAttachment[]; mine: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const single = items.length === 1;
  return (
    <>
      <div className={cn("grid gap-1.5", single ? "grid-cols-1" : "grid-cols-2", mine && "justify-items-end")}>
        {items.map((a, i) =>
          !a.url ? (
            <span
              key={a.id}
              className="grid size-28 place-items-center rounded-xl bg-panel-3 px-2 text-center text-[11px] text-ink-3 edge"
            >
              {isVideo(a) ? "동영상을 불러오지 못했어요" : "사진을 불러오지 못했어요"}
            </span>
          ) : isVideo(a) ? (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpen(i)}
              className="relative block overflow-hidden rounded-xl bg-panel-3 edge"
              aria-label={`첨부 동영상 ${i + 1} 재생`}
            >
              <video
                src={`${a.url}#t=0.1`}
                muted
                playsInline
                preload="metadata"
                className={cn("object-cover", single ? "max-h-60 w-56" : "size-28")}
              />
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-10 place-items-center rounded-full bg-foreground/60 text-background">
                  <Play className="ml-0.5 size-4 fill-current" />
                </span>
              </span>
              <span className="num absolute right-1.5 bottom-1.5 rounded-md bg-foreground/60 px-1.5 py-px text-[10.5px] text-background">
                {formatSize(a.size)}
              </span>
            </button>
          ) : a.type === "image/heic" ? (
            // HEIC 는 대부분의 브라우저가 미리보기를 못 그린다 → 내려받기 링크
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="grid size-28 place-items-center rounded-xl bg-panel-3 px-2 text-center text-[11px] text-muted-foreground underline edge"
            >
              HEIC 사진 열기
            </a>
          ) : (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return; // ⌘·Ctrl 클릭은 그대로 새 탭
                e.preventDefault();
                setOpen(i);
              }}
              className="block overflow-hidden rounded-xl bg-panel-3 edge"
              aria-label={`첨부 사진 ${i + 1} 크게 보기`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 비공개 저장소의 서명 URL (이미지 최적화 대상 아님) */}
              <img
                src={a.url}
                alt={`첨부 사진 ${i + 1}`}
                loading="lazy"
                className={cn("object-cover", single ? "max-h-60 w-auto max-w-56" : "size-28")}
              />
            </a>
          ),
        )}
      </div>
      {open !== null && <MediaViewer items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

// 화면 위에 띄우는 사진·동영상 뷰어 (보낸 메시지·보내기 전 첨부 공용). Esc 닫기, ←/→ 같은 메시지의 다른 첨부.
export function MediaViewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: ChatAttachment[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const viewable = items.filter((a) => a.url && a.type !== "image/heic");
  const cur = items[index];
  const pos = viewable.indexOf(cur);
  const step = useCallback(
    (d: number) => {
      if (viewable.length < 2) return;
      onIndex(items.indexOf(viewable[(pos + d + viewable.length) % viewable.length]));
    },
    [items, viewable, pos, onIndex],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, step]);
  if (!cur?.url) return null;

  const navBtn = "grid size-10 place-items-center rounded-full bg-background/15 text-background transition-colors hover:bg-background/25";
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-foreground/90"
      role="dialog"
      aria-modal="true"
      aria-label={isVideo(cur) ? "첨부 동영상 보기" : "첨부 사진 보기"}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-background">
        <span className="num text-[12.5px] opacity-80">
          {viewable.length > 1 ? `${pos + 1} / ${viewable.length} · ` : ""}
          {isVideo(cur) ? "동영상" : "사진"} · {formatSize(cur.size)}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={cur.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 items-center gap-1.5 rounded-full bg-background/15 px-3 text-[12.5px] transition-colors hover:bg-background/25"
          >
            <ExternalLink className="size-3.5" />
            원본
          </a>
          <button type="button" onClick={onClose} className={navBtn} aria-label="닫기 (Esc)">
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {isVideo(cur) ? (
          <video
            key={cur.id}
            src={cur.url}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full rounded-lg bg-foreground"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- 비공개 저장소의 서명 URL
          <img key={cur.id} src={cur.url} alt="첨부 사진" className="max-h-full max-w-full rounded-lg object-contain" />
        )}
        {viewable.length > 1 && (
          <>
            <button type="button" onClick={() => step(-1)} className={cn(navBtn, "absolute left-3")} aria-label="이전 (←)">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" onClick={() => step(1)} className={cn(navBtn, "absolute right-3")} aria-label="다음 (→)">
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// viewer: 누가 보는 화면인가. 내 쪽 메시지는 오른쪽에 붙는다.
export function MessageBubble({
  message,
  viewer,
  onRetry,
}: {
  message: ChatMessage;
  viewer: "customer" | "agent";
  onRetry?: (m: ChatMessage) => void;
}) {
  if (message.sender_type === "system") {
    return (
      <div className="my-3 flex justify-center px-5">
        <p className="max-w-[85%] text-center font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-3">
          {message.body}
        </p>
      </div>
    );
  }

  const fromCustomer = message.sender_type === "customer";
  const mine = viewer === "customer" ? fromCustomer : !fromCustomer;

  return (
    <div className={cn("flex flex-col gap-1.5 px-5 py-1.5", mine ? "items-end" : "items-start")}>
      {viewer === "customer" ? (
        !fromCustomer && <CustomerSideSender ai={message.sender_type === "ai"} />
      ) : (
        <AgentSideSender message={message} />
      )}
      <div className={cn("flex max-w-[82%] items-end gap-2", mine && "flex-row-reverse")}>
        <div className={cn("flex min-w-0 flex-col gap-1.5", mine ? "items-end" : "items-start")}>
          {!!message.attachments?.length && <MessagePhotos items={message.attachments} mine={mine} />}
          {(message.body || !message.attachments?.length) && (
            <div
              // AI 응대 화면(data-room="ai")에서는 AI 답변에 오로라 테두리 (globals.css)
              data-ai-bubble={message.sender_type === "ai" && !message.internal ? "" : undefined}
              className={cn(
                "px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap",
                mine ? "rounded-[16px_4px_16px_16px]" : "rounded-[4px_16px_16px_16px]",
                message.internal
                  ? "border border-dashed border-bubble-internal-foreground/30 bg-bubble-internal text-bubble-internal-foreground"
                  : mine
                    ? "bg-bubble-customer text-bubble-customer-foreground"
                    : "bg-bubble-agent text-bubble-agent-foreground edge",
                message.pending === "sending" && "opacity-60",
              )}
            >
              {message.body}
            </div>
          )}
        </div>
        <span className="num shrink-0 pb-0.5 text-[10.5px] text-ink-3">
          {message.pending === "failed" ? (
            <button type="button" className="font-sans text-destructive underline" onClick={() => onRetry?.(message)}>
              전송 실패 · 다시 보내기
            </button>
          ) : message.pending === "sending" ? (
            <span className="font-sans">전송 중</span>
          ) : (
            formatTime(message.created_at)
          )}
        </span>
      </div>
    </div>
  );
}
