"use client";

import {
  Check,
  CheckCheck,
  Clock,
  ClipboardList,
  ImagePlus,
  Link2,
  MailWarning,
  MessageSquare,
  RotateCcw,
  Sparkles,
  StickyNote,
  Zap,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Notice, ToneIcon } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { AttachmentStrip, FilePicker, inboxUpload, useAttachments } from "@/components/widget/attachments";
import { MAX_VIDEO_MINUTES } from "@/components/widget/video-compress";
import {
  api,
  ApiError,
  lastSeq,
  mergeMessages,
  newClientId,
  type ChatAttachment,
  type ChatMessage,
} from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Panel } from "./app-shell";
import { cachedConversation, fetchConversation, rememberConversation } from "./conversation-cache";
import { CustomerPanel, type ConversationDetail } from "./customer-panel";
import { fillItem, itemKey, type Order } from "./order-panel";
import { fillBlanks, itemVars, moveRanges, type FillItem, type Range } from "@/lib/client/quick-reply-vars";
import {
  CATEGORY_LABEL,
  contactDisplayName,
  hoursSince,
  PRIORITY_LABEL,
  SLA_HOURS,
  shortWait,
  STATUS_LABEL,
  waitLevel,
} from "./labels";
import { NativeSelect } from "./native-select";
import { copyConversationLink, copyConversationSummary } from "./share-link";
import type { AgentInfo } from "./use-agent";

const POLL_MS = 2500;

export type QuickReply = {
  id: string;
  shortcut: string;
  title: string;
  body: string;
};

type State = {
  status: string;
  customer_last_read_at: string | null;
  assigned_agent_id: string | null;
  typing_agent_id: string | null;
  typing_agent_name: string | null;
  someone_typing: boolean;
};


// 빠른 답변(매크로)의 건별로 바꿔 쓸 칸: {상품명} {컬러} 처럼 중괄호로 감싼다
const BLANK = /\{[^{}\n]{1,20}\}/;

// 답변 입력창과 그 뒤에 깔아 칠하는 층이 글자 위치가 똑같도록 같은 글꼴·여백을 쓴다
const DRAFT_TEXT =
  "whitespace-pre-wrap break-words px-4 py-3 text-[14px] leading-relaxed md:text-[14px] [overflow-wrap:anywhere] [scrollbar-gutter:stable]";

// 입력창 뒤 층: 자동으로 채운 값은 파란 태그, 아직 안 채운 {빈칸}은 노란 태그로 칠한다
// (글자는 투명하고 배경만 보인다. 좌우 여백 대신 그림자로 태그 테두리를 넓혀 글자 위치를 바꾸지 않는다)
function highlightDraft(text: string, filled: Range[]) {
  const blanks = [...text.matchAll(new RegExp(BLANK.source, "g"))]
    .map((m) => ({ start: m.index, end: m.index + m[0].length, blank: true }))
    .filter((b) => !filled.some((r) => b.start < r.end && r.start < b.end));
  const marks = [...filled.map((r) => ({ ...r, blank: false })), ...blanks].sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of marks) {
    if (m.start < last) continue;
    out.push(text.slice(last, m.start));
    out.push(
      <mark
        key={m.start}
        className={cn(
          "rounded-[4px] text-transparent [box-decoration-break:clone]",
          m.blank
            ? "bg-warn/20 shadow-[0_0_0_2px_color-mix(in_oklch,var(--color-warn)_20%,transparent)]"
            : "bg-signal/15 shadow-[0_0_0_2px_color-mix(in_oklch,var(--color-signal)_15%,transparent)]",
        )}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    last = m.end;
  }
  out.push(text.slice(last) + "\u200b");
  return out;
}

export function ConversationView({
  conversationId,
  agent,
  agents,
  quickReplies,
  onChanged,
  onMarkedUnread,
  onOpen,
  onShown,
  busy = false,
}: {
  conversationId: string;
  agent: AgentInfo;
  agents: { id: string; name: string }[];
  quickReplies: QuickReply[];
  onChanged: () => void;
  // '안 읽음으로 표시' 뒤 화면을 닫는다
  onMarkedUnread: () => void;
  // 고객의 이전 문의 열기 (주소창에도 기록)
  onOpen: (id: string) => void;
  // 내용을 처음 받았을 때 (공유 링크로 들어온 문의의 탭 맞추기)
  onShown?: (status: string) => void;
  // 다른 문의로 바꾸는 중 (새 문의를 받는 동안 이 화면을 흐리게 두고 입력을 막는다)
  busy?: boolean;
}) {
  // 열어 본 적 있는 문의면 기억해 둔 내용으로 바로 그린다
  const [detail, setDetail] = useState<ConversationDetail | null>(() => cachedConversation(conversationId) ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => cachedConversation(conversationId)?.messages ?? []);
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"reply" | "memo">("reply");
  const [conflict, setConflict] = useState<{
    name: string;
    message: ChatMessage;
  } | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [aiDraft, setAiDraft] = useState<{ busy: boolean; notes: string | null; error: string | null }>({
    busy: false,
    notes: null,
    error: null,
  });

  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  // 매크로(빠른 답변)의 {상품명} 같은 빈칸이 남은 채 보내려 할 때
  const [blankWarn, setBlankWarn] = useState<string | null>(null);
  // 빈칸({상품명} {컬러} {사이즈} {주문번호})을 채울 주문 상품. 상품이 하나뿐이면 자동으로, 아니면 주문 패널에서 고른다
  const [fill, setFill] = useState<{ key: string; item: FillItem; auto: boolean } | null>(null);
  // 자동으로 채운 값들. 입력창 안에서 태그처럼 칠해 제대로 들어갔는지 보이게 한다
  const [filled, setFilled] = useState<Range[]>([]);
  const backdropRef = useRef<HTMLDivElement>(null);
  // 행동 기록용: 지금 쓰는 답변에 AI 초안·빠른 답변을 불러왔는지 (보내면 초기화)
  const composeRef = useRef({ aiDraft: false, macro: false });
  // 답변·메모 사진 첨부 (저장소가 설정된 경우만). 고른 즉시 올리고, 보낼 때 id 만 넘긴다.
  const upload = useMemo(
    () => (agent.attachments ? inboxUpload(conversationId) : null),
    [agent.attachments, conversationId],
  );
  const photos = useAttachments(upload);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDetail = useCallback(async () => {
    const d = await api<ConversationDetail & { messages: ChatMessage[] }>(`/api/inbox/conversations/${conversationId}`);
    setDetail(d);
    setMessages((cur) => mergeMessages(cur, d.messages));
  }, [conversationId]);

  // 공유 링크가 잘못됐거나 지워진 문의
  const [missing, setMissing] = useState(false);
  const onShownRef = useRef(onShown);
  useEffect(() => {
    onShownRef.current = onShown;
  }, [onShown]);

  // 대화가 바뀌면 부모가 key 로 새로 마운트하므로 초기화는 필요 없다
  useEffect(() => {
    fetchConversation(conversationId)
      .then((d) => {
        setDetail(d);
        setMessages((cur) => mergeMessages(cur, d.messages));
        onShownRef.current?.(d.conversation.status);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
      });
  }, [conversationId]);

  // 지금 보이는 내용을 기억해 둔다 (다시 열 때 바로 그리기용, 최신 여부는 다시 받아 확인)
  useEffect(() => {
    if (detail) rememberConversation(conversationId, { ...detail, messages }, 0);
  }, [conversationId, detail, messages]);

  // 새 메시지 polling (Supabase 전환 후 Realtime 으로 교체 예정)
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await api<{ messages: ChatMessage[]; state: State }>(
            `/api/inbox/conversations/${conversationId}/messages?after=${lastSeq(messagesRef.current)}`,
          );
          if (stopped) return;
          if (res.messages.length) setMessages((cur) => mergeMessages(cur, res.messages));
          setState(res.state);
        } catch {}
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [conversationId]);

  // 화면에 보이는 대화는 읽음 처리
  const latestCustomerSeq = useMemo(
    () => messages.filter((m) => m.sender_type === "customer" && !m.pending).at(-1)?.seq ?? 0,
    [messages],
  );
  useEffect(() => {
    if (!latestCustomerSeq) return;
    api(`/api/inbox/conversations/${conversationId}/read`, { method: "POST" })
      .then(onChanged)
      .catch(() => {});
  }, [conversationId, latestCustomerSeq, onChanged]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, conversationId]);

  // 성공은 화면이 바로 바뀌므로 알리지 않고, 실패만 토스트로 알린다
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/inbox/conversations/${conversationId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } catch (err) {
      toast.error("문의 정보를 바꾸지 못했어요.", err);
      return;
    }
    await loadDetail().catch(() => {});
    onChanged();
  };

  const send = async (message: ChatMessage, force = false, compose?: { aiDraft: boolean; macro: boolean }) => {
    setMessages((cur) =>
      mergeMessages(
        cur.filter((m) => m.client_message_id !== message.client_message_id),
        [{ ...message, pending: "sending" }],
      ),
    );
    try {
      const res = await api<{ message: ChatMessage }>(`/api/inbox/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          clientMessageId: message.client_message_id,
          body: message.body,
          attachments: (message.attachments ?? []).map((a) => a.id),
          internal: Boolean(message.internal),
          lastSeenSeq: lastSeq(messagesRef.current),
          force,
          compose,
        }),
      });
      setMessages((cur) => mergeMessages(cur, [res.message]));
      onChanged();
      if (!message.internal) loadDetail().catch(() => {});
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code.startsWith("other_agent_replied:")) {
        // 다른 상담원이 방금 답변함 → 보내기 전에 확인
        setMessages((cur) => cur.filter((m) => m.client_message_id !== message.client_message_id));
        setConflict({ name: err.code.split(":")[1], message });
        const res = await api<{ messages: ChatMessage[] }>(
          `/api/inbox/conversations/${conversationId}/messages?after=${lastSeq(messagesRef.current)}`,
        );
        setMessages((cur) => mergeMessages(cur, res.messages));
        return;
      }
      setMessages((cur) =>
        cur.map((m) => (m.client_message_id === message.client_message_id ? { ...m, pending: "failed" } : m)),
      );
    }
  };

  const submit = () => {
    const body = draft.trim();
    const attachments: ChatAttachment[] = photos.items.flatMap((x) =>
      x.status === "done" && x.id ? [{ id: x.id, type: x.type ?? "image/jpeg", size: x.size ?? 0, url: x.preview }] : [],
    );
    if ((!body && !attachments.length) || photos.uploading) return;
    const blank = mode === "reply" ? body.match(BLANK) : null;
    if (blank) {
      setBlankWarn(blank[0]);
      selectBlank(0);
      return;
    }
    setDraft("");
    setFilled([]);
    photos.reset();
    const compose = composeRef.current;
    composeRef.current = { aiDraft: false, macro: false };
    send(
      {
        id: newClientId(),
        seq: Number.MAX_SAFE_INTEGER,
        sender_type: "agent",
        agent_name: agent.name,
        body,
        attachments,
        internal: mode === "memo",
        client_message_id: newClientId(),
        created_at: new Date().toISOString(),
      },
      false,
      compose,
    );
  };

  const onDraftChange = (value: string) => {
    if (!value.trim()) composeRef.current = { aiDraft: false, macro: false };
    setFilled((cur) => (value.trim() ? moveRanges(cur, draft, value) : []));
    setDraft(value);
    setPickerIndex(0);
    setBlankWarn(null);
  };

  // 매크로의 {빈칸}: from 위치 다음(없으면 처음부터)의 빈칸을 선택해 바로 덮어쓰게 한다
  const selectBlank = (from: number, text?: string) => {
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (!el) return;
      const value = text ?? el.value;
      const re = new RegExp(BLANK.source, "g");
      const all = [...value.matchAll(re)];
      const next = all.find((m) => m.index! >= from) ?? all[0];
      el.focus();
      if (next) el.setSelectionRange(next.index!, next.index! + next[0].length);
    });
  };

  // "/배송" 처럼 입력하면 빠른 답변 후보를 보여준다
  const pickerQuery = draft.startsWith("/") ? draft.slice(1).trim() : null;
  const pickerItems =
    pickerQuery === null
      ? []
      : quickReplies.filter((q) => q.shortcut.includes(pickerQuery) || q.title.includes(pickerQuery));
  const fillVars = (text: string, item: FillItem | null, keep?: Range[]) =>
    fillBlanks(text, itemVars(item, detail?.contact.name ?? null), keep);
  const applyQuickReply = (q: QuickReply) => {
    composeRef.current.macro = true;
    const { text: body, ranges } = fillVars(q.body, fill?.item ?? null);
    setFilled(ranges);
    setDraft(body);
    setBlankWarn(null);
    selectBlank(0, body);
  };
  // 주문 패널에서 상품을 고르면 지금 쓰는 답변의 빈칸도 바로 채운다
  const pickItem = (key: string, item: FillItem) => {
    setFill({ key, item, auto: false });
    if (mode !== "reply" || !BLANK.test(draft)) return;
    const { text: body, ranges } = fillVars(draft, item, filled);
    setFilled(ranges);
    setDraft(body);
    setBlankWarn(null);
    selectBlank(0, body);
  };
  // 주문(문의에 적힌 주문번호가 있으면 그 주문)에 상품이 하나뿐이면 따로 고르지 않아도 그 상품으로 채운다
  const onOrders = (orders: Order[]) => {
    if (fill && !fill.auto) return;
    const live = orders.filter((o) => !o.canceled);
    const ref = detail?.conversation.order_ref?.trim();
    const pool = live.find((o) => ref && o.orderId === ref) ? live.filter((o) => o.orderId === ref) : live;
    const items = pool.flatMap((o) => o.items.map((_, idx) => ({ order: o, idx })));
    if (items.length === 1) setFill({ key: itemKey(items[0].order, items[0].idx), item: fillItem(items[0].order, items[0].idx), auto: true });
  };
  const hasBlank = mode === "reply" && BLANK.test(draft);

  if (missing)
    return (
      <Panel className="flex-1 items-center justify-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-panel-3 text-ink-3 edge">
          <Link2 className="size-5" strokeWidth={1.75} />
        </span>
        <p className="text-sm text-muted-foreground">문의를 찾을 수 없어요.</p>
        <p className="text-xs text-ink-3">링크 주소가 잘렸거나 잘못 붙여넣었는지 확인해주세요.</p>
      </Panel>
    );
  // 처음 여는 문의: 글자를 띄웠다 지우면 번쩍여서 빈 패널로 둔다 (보통 금방 채워짐)
  if (!detail) return <Panel className="flex-1" aria-busy />;

  const conv = detail.conversation;
  const assignedToOther = conv.assigned_agent_id && conv.assigned_agent_id !== agent.id;
  const lastCustomerAt = messages.filter((m) => m.sender_type === "customer" && !m.pending).at(-1)?.created_at;
  const waitedH = conv.status === "open" && lastCustomerAt ? hoursSince(lastCustomerAt) : null;
  const level = waitedH === null ? null : waitLevel(waitedH);
  const rawUrl = conv.page_url ?? detail.contact.last_page_url;
  // 고객이 받아 볼 수 있는 마지막 답변 (내부 메모·AI 초안 제외) → 그 아래에 고객 확인 여부를 적는다
  const lastReply = messages.findLast(
    (m) =>
      !m.pending &&
      ((m.sender_type === "agent" && !m.internal) || (m.sender_type === "ai" && m.ai_kind !== "draft")),
  );
  const customerReadAt = state ? state.customer_last_read_at : conv.customer_last_read_at;

  const markUnread = async () => {
    try {
      await api(`/api/inbox/conversations/${conversationId}/read`, { method: "DELETE" });
    } catch (err) {
      toast.error("안 읽음으로 표시하지 못했어요.", err);
      return;
    }
    toast.success("안 읽음으로 표시했어요. 내 목록에만 적용돼요.");
    onMarkedUnread();
  };
  const pagePath = pathOf(rawUrl);

  const copyLink = () =>
    copyConversationLink(conversationId).then(
      () => toast.success("문의 링크를 복사했어요. 로그인한 팀원은 바로 이 문의로 들어와요."),
      (err) => toast.error("링크를 복사하지 못했어요.", err),
    );
  const copySummary = () =>
    copyConversationSummary({
      id: conversationId,
      category: conv.category,
      status: conv.status,
      created_at: conv.created_at,
      firstMessage: messages.find((m) => m.sender_type === "customer" && m.body)?.body ?? null,
    }).then(
      () => toast.success("요약과 링크를 복사했어요. 노션·슬랙에 바로 붙여넣으세요."),
      (err) => toast.error("요약을 복사하지 못했어요.", err),
    );

  return (
    // 다른 문의를 받는 동안: 0.15초가 지나도 안 오면 흐리게, 그동안 입력·클릭은 막는다
    <div
      aria-busy={busy || undefined}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 gap-2 transition-opacity duration-200",
        busy && "pointer-events-none opacity-55 delay-150",
      )}
    >
      <Panel className="flex-1">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 pt-5 pb-4" data-tour="conv-head">
          <div className="mr-auto flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <h2 className="truncate text-[22px] leading-tight font-bold tracking-[-0.025em]">
                {contactDisplayName(detail.contact)}
              </h2>
              <span className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-lg text-ink-3"
                  onClick={copyLink}
                  title="이 문의 링크 복사 — 팀원 공유용 (주소창 주소와 같아요)"
                  aria-label="문의 링크 복사"
                >
                  <Link2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-lg text-ink-3"
                  onClick={copySummary}
                  title="노션 기록용 복사 — 유형·접수일·상태와 첫 문의 요약 + 링크 (고객 이름·연락처는 빠져요)"
                  aria-label="노션 기록용 요약 복사"
                >
                  <ClipboardList />
                </Button>
              </span>
              {waitedH !== null && level && (
                <Chip tone={level === "late" ? "late" : level === "warn" ? "warn" : "neutral"}>
                  <Clock className="size-3" strokeWidth={2} />
                  <span className="num">
                    {shortWait(waitedH)} ·{" "}
                    {waitedH >= SLA_HOURS
                      ? `${shortWait(waitedH - SLA_HOURS)} 초과`
                      : `${shortWait(SLA_HOURS - waitedH)} 남음`}
                  </span>
                </Chip>
              )}
            </div>
            <p className="flex min-w-0 items-center gap-2 font-mono text-[11.5px] text-ink-3">
              <span className="shrink-0 font-sans">{STATUS_LABEL[conv.status]}</span>
              {conv.category && <span className="shrink-0 font-sans">· {CATEGORY_LABEL[conv.category]}</span>}
              {pagePath && <span className="truncate">· {pagePath}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <NativeSelect
              aria-label="담당자"
              value={conv.assigned_agent_id ?? ""}
              onChange={(e) => patch({ assignedAgentId: e.target.value || null })}
            >
              <option value="">미배정</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="처리 유형"
              value={conv.category ?? ""}
              onChange={(e) => patch({ category: e.target.value || null })}
            >
              <option value="">유형 선택</option>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="우선순위"
              value={conv.priority}
              onChange={(e) => patch({ priority: e.target.value })}
            >
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  우선순위 {v}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              className="h-8 rounded-xl"
              onClick={markUnread}
              title="나중에 다시 볼 수 있게 내 목록에서 안 읽음으로 되돌려요"
            >
              <MailWarning />
              안 읽음으로 표시
            </Button>
            {conv.status === "resolved" ? (
              <Button variant="outline" className="h-8 rounded-xl" onClick={() => patch({ status: "open" })}>
                <RotateCcw />
                다시 열기
              </Button>
            ) : (
              <Button variant="outline" className="h-8 rounded-xl" onClick={() => patch({ status: "resolved" })}>
                <Check />
                종료
              </Button>
            )}
          </div>
          {detail.aiOrigin && (
            <Notice tone="info" size="sm" className="w-full">
              AI 응대에서 이어진 문의예요. 고객이 먼저 AI에게 “{detail.aiOrigin.question.slice(0, 60)}”라고 물었고,{" "}
              {detail.aiOrigin.joined
                ? "AI와 대화하는 중에 담당자가 참여해 만든 문의예요. 고객이 위젯을 열어 두고 있으면 답이 몇 초 안에 떠요."
                : detail.aiOrigin.review === "replied"
                ? "고객이 답을 받지 못하고 떠나서 AI 응대에서 답변해 만든 문의예요."
                : detail.aiOrigin.decision === "answered"
                  ? "AI 답변 뒤 문의를 남겼어요."
                  : "AI가 답하지 않고 넘겨서 문의를 남겼어요."}{" "}
              <a href={`/ai?a=${detail.aiOrigin.id}`} className="font-semibold underline-offset-2 hover:underline">
                AI 응대 보기
              </a>
            </Notice>
          )}
          {assignedToOther && (
            <Notice tone="info" size="sm" className="w-full">
              {conv.assigned_agent_name} 님이 담당 중인 문의예요.
            </Notice>
          )}
        </header>

        {/* 넓은 모니터에서 문의(왼쪽)와 답변(오른쪽)이 멀어지지 않게 대화는 760px 칼럼으로 가운데에 모은다 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto pt-2 pb-4">
          <div className="mx-auto w-full max-w-[760px]">
            {messages.map((m) => (
              <Fragment key={m.client_message_id ?? m.id}>
                <MessageBubble message={m} viewer="agent" onRetry={(x) => send(x)} />
                {m === lastReply && <CustomerReceipt sentAt={m.created_at} readAt={customerReadAt} />}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="relative mx-auto mb-4 w-[calc(100%-2rem)] max-w-[728px]">
          {conflict && (
            <div
              role="alert"
              className="mb-2 flex items-center gap-2 rounded-2xl bg-warn/12 px-4 py-2.5 text-[13px] text-warn-text edge"
            >
              <ToneIcon tone="warning" className="size-4" />
              <span className="mr-auto">{conflict.name} 님이 방금 답변했어요. 그래도 보낼까요?</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(conflict.message.body);
                  setFilled([]);
                  photos.restore(conflict.message.attachments ?? []);
                  setConflict(null);
                }}
              >
                수정하기
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const m = conflict.message;
                  setConflict(null);
                  send(m, true);
                }}
              >
                그래도 보내기
              </Button>
            </div>
          )}

          {pickerItems.length > 0 && (
            <ul className="absolute right-0 bottom-full left-0 mb-2 max-h-80 overflow-y-auto rounded-2xl bg-popover p-1 float">
              {pickerItems.map((q, i) => (
                <li key={q.id} ref={i === pickerIndex ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}>
                  <button
                    className={cn(
                      "flex w-full flex-col rounded-xl px-3 py-2 text-left",
                      i === pickerIndex && "bg-panel-3",
                    )}
                    onMouseEnter={() => setPickerIndex(i)}
                    onClick={() => applyQuickReply(q)}
                  >
                    <span className="text-xs font-medium">
                      <span className="font-mono text-signal-text">/{q.shortcut}</span> · {q.title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{q.body.replace(/\s+/g, " ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            data-tour="composer"
            className={cn(
              "overflow-hidden rounded-[20px] backdrop-blur-xl float",
              mode === "memo" ? "bg-bubble-internal" : "bg-raised",
            )}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            // 캡처한 화면을 붙여넣거나 사진·동영상 파일을 끌어다 놓아도 첨부된다
            onPaste={(e) => {
              if (!upload) return;
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
              if (!files.length) return;
              e.preventDefault();
              photos.add(files);
            }}
            onDragOver={(e) => {
              if (upload && e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!upload || !e.dataTransfer.files.length) return;
              e.preventDefault();
              photos.add(e.dataTransfer.files);
            }}
          >
            <div className="flex items-center gap-0.5 px-2 pt-2">
              {(["reply", "memo"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    mode === m
                      ? m === "memo"
                        ? "bg-bubble-internal text-bubble-internal-foreground"
                        : "bg-panel-3 text-foreground"
                      : "text-ink-3 hover:text-muted-foreground",
                  )}
                >
                  {m === "reply" ? <MessageSquare className="size-3.5" /> : <StickyNote className="size-3.5" />}
                  {m === "reply" ? "답변" : "내부 메모"}
                </button>
              ))}
              <button
                type="button"
                disabled={aiDraft.busy}
                onClick={async () => {
                  if (draft.trim() && !confirm("작성 중인 답변을 AI 초안으로 바꿀까요?")) return;
                  setAiDraft({ busy: true, notes: null, error: null });
                  try {
                    const r = await api<{ draft: string | null; notes: string | null }>(
                      `/api/inbox/conversations/${conversationId}/ai-draft`,
                      { method: "POST" },
                    );
                    if (r.draft) {
                      setMode("reply");
                      composeRef.current.aiDraft = true;
                      setDraft(r.draft);
                      setFilled([]);
                    }
                    setAiDraft({
                      busy: false,
                      notes: r.notes,
                      error: r.draft ? null : (r.notes ?? "초안을 만들지 못했어요."),
                    });
                  } catch {
                    setAiDraft({ busy: false, notes: null, error: "초안을 만들지 못했어요." });
                  }
                }}
                className="ml-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-signal-text transition-colors hover:bg-signal-soft disabled:opacity-60"
              >
                <Sparkles className={cn("size-3.5", aiDraft.busy && "animate-pulse")} />
                {aiDraft.busy ? "초안 작성 중…" : "AI 초안"}
              </button>
              <span className="ml-auto hidden items-center gap-1.5 pr-1.5 text-[11px] text-ink-3 md:flex">
                {hasBlank ? (
                  <>
                    {!fill && <span className="mr-1">주문 패널의 ‘답변에 넣기’로 상품 빈칸을 채울 수 있어요 ·</span>}
                    <Kbd>Tab</Kbd> 다음 빈칸 <Kbd>⇧Tab</Kbd> 이전 빈칸
                  </>
                ) : (
                  <>
                    <Kbd>/</Kbd> 빠른 답변 <Kbd>↵</Kbd> 전송 <Kbd>⇧↵</Kbd> 줄바꿈
                  </>
                )}
              </span>
            </div>
            {aiDraft.error ? (
              <Notice tone="error" size="sm" className="mx-3 mt-2">
                {aiDraft.error}
              </Notice>
            ) : (
              aiDraft.notes && (
                <Notice tone="info" size="sm" className="mx-3 mt-2">
                  AI 메모: {aiDraft.notes} — 보내기 전에 꼭 확인하고 다듬어주세요.
                </Notice>
              )
            )}
            {blankWarn && (
              <Notice tone="warning" size="sm" className="mx-3 mt-2">
                아직 채우지 않은 빈칸 <b className="font-semibold">{blankWarn}</b> 이 있어요. 채운 뒤 보내주세요.
              </Notice>
            )}
            <div className="relative">
            {mode === "reply" && (
              <div
                ref={backdropRef}
                aria-hidden
                className={cn(DRAFT_TEXT, "pointer-events-none absolute inset-0 overflow-hidden text-transparent")}
              >
                {highlightDraft(draft, filled)}
              </div>
            )}
            <Textarea
              ref={draftRef}
              value={draft}
              onScroll={(e) => {
                if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (pickerItems.length) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setPickerIndex(
                      (i) => (i + (e.key === "ArrowDown" ? 1 : -1) + pickerItems.length) % pickerItems.length,
                    );
                    return;
                  }
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    applyQuickReply(pickerItems[pickerIndex]);
                    return;
                  }
                }
                // 매크로 빈칸 사이 이동 (Shift+Tab 은 이전 빈칸)
                if (e.key === "Tab" && hasBlank && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  if (e.shiftKey) {
                    const re = new RegExp(BLANK.source, "g");
                    const prev = [...el.value.matchAll(re)].filter((m) => m.index! < el.selectionStart).at(-1);
                    selectBlank(prev?.index ?? 0);
                  } else selectBlank(el.selectionEnd);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={mode === "memo" ? "상담원끼리만 보는 메모" : "고객에게 보낼 답변"}
              rows={3}
              className={cn(DRAFT_TEXT, "relative max-h-60 min-h-20 resize-none rounded-none border-0 bg-transparent focus-visible:ring-0 dark:bg-transparent")}
              aria-label={mode === "memo" ? "내부 메모 입력" : "답변 입력"}
            />
            </div>
            {upload && <AttachmentStrip state={photos} className="px-4 pb-3" />}
            <div className="flex items-center gap-2 border-t px-3 py-2">
              <span className="truncate text-xs text-ink-3">
                {mode === "memo"
                  ? "고객에게 보이지 않아요"
                  : agent.emailReplies
                    ? "저장하면 고객 이메일로 발송돼요"
                    : "고객 위젯 ‘내 문의’에 표시돼요"}
              </span>
              {upload && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto rounded-xl text-ink-3"
                    disabled={photos.full}
                    aria-label="사진·동영상 첨부"
                    title={`사진·동영상 첨부 (동영상은 1개, ${MAX_VIDEO_MINUTES}분 이내 · 자동으로 줄여서 올려요 · 붙여넣기·끌어다 놓기도 돼요)`}
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImagePlus />
                  </Button>
                  <FilePicker state={photos} inputRef={fileRef} />
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("rounded-xl text-ink-3", !upload && "ml-auto")}
                aria-label="빠른 답변"
                title="빠른 답변 (/)"
                onClick={() => onDraftChange("/")}
              >
                <Zap />
              </Button>
              <Button
                type="submit"
                disabled={(!draft.trim() && !photos.ids.length) || photos.uploading}
                className="h-8 rounded-xl px-4"
              >
                {mode === "memo" ? "메모 남기기" : "보내기"}
              </Button>
            </div>
          </form>
        </div>
      </Panel>

      <CustomerPanel
        key={`${detail.contact.id}:${detail.contact.name}:${detail.contact.phone}`}
        detail={detail}
        onSaved={loadDetail}
        emailReplies={agent.emailReplies}
        picker={{ picked: fill?.key ?? null, onPick: pickItem }}
        onOrders={onOrders}
        onOpen={onOpen}
      />
    </div>
  );
}

// 고객 브라우저가 보낸 값이라 http(s) 만 받고, 깨진 인코딩이어도 화면이 죽지 않게 한다
function pathOf(url: string | null) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
}

// 내 마지막 답변 아래: 고객이 위젯 '내 문의'나 메일 링크로 답변을 열어 봤는지
function CustomerReceipt({ sentAt, readAt }: { sentAt: string; readAt: string | null }) {
  const read = readAt !== null && Date.parse(readAt) >= Date.parse(sentAt);
  const h = hoursSince(sentAt);
  return (
    <p
      className={cn(
        "flex items-center justify-end gap-1 px-5 pb-1 text-[11.5px] font-medium",
        read ? "text-ok-text" : h >= 24 ? "text-warn-text" : "text-ink-3",
      )}
    >
      {read ? <CheckCheck className="size-3.5" strokeWidth={2} /> : <Clock className="size-3.5" strokeWidth={2} />}
      {read ? (
        <>
          고객 확인 · <span className="num">{formatDateTime(readAt)}</span>
        </>
      ) : (
        <>아직 안 읽음 · 보낸 지 {elapsed(h)}</>
      )}
    </p>
  );
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function elapsed(h: number) {
  if (h < 1) return `${Math.max(1, Math.floor(h * 60))}분`;
  if (h < 24) return `${Math.floor(h)}시간`;
  const days = Math.floor(h / 24);
  const rest = Math.floor(h % 24);
  return rest ? `${days}일 ${rest}시간` : `${days}일`;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-input px-1 font-mono text-[10.5px] leading-4 text-ink-3">
      {children}
    </kbd>
  );
}
