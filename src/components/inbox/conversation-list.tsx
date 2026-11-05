"use client";

import { Check, Clock, Minus, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/client/api";
import { AgentAvatar } from "./agent-avatar";
import {
  CATEGORY_LABEL,
  contactDisplayName,
  hoursSince,
  SLA_HOURS,
  shortWait,
  STATUS_LABEL,
  WAIT_TEXT,
  waitLevel,
} from "./labels";

export type ConversationSummary = {
  id: string;
  status: "open" | "waiting_customer" | "resolved";
  handling_mode: "ai" | "human";
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  assigned_agent_avatar_url: string | null;
  assigned_agent_avatar_emoji: string | null;
  priority: "normal" | "high" | "urgent";
  category: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_customer_message_at: string | null;
  order_ref: string | null;
  contact_id: string;
  contact_name: string | null;
  cafe24_member_id_hint: string | null;
  verified_member_id: string | null;
  // 나(로그인한 상담원)에게 안 읽음
  unread: boolean;
  last_agent_reply_at: string | null;
  // 마지막 답변을 고객이 아직 안 읽음
  customer_unread: boolean;
  from_ai?: boolean;
  // 검색 결과일 때만: 어디서 찾았는지
  match_field?: "name" | "member" | "order" | "email" | "phone" | "message";
  match_body?: string | null;
  match_sender?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
};

export type Filters = { unread: boolean; unassigned: boolean; stale: boolean };

// 검색 최소 글자 수 (서버도 같은 기준)
export const SEARCH_MIN = 2;

export type View = "open" | "waiting" | "resolved";

// 줄을 누를 때 함께 누른 키 (⌘/Ctrl 클릭 = 하나씩, Shift 클릭 = 범위)
export type ClickKeys = {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

const VIEWS: { key: View; label: string }[] = [
  { key: "open", label: "답변 필요" },
  { key: "waiting", label: "응대 중" },
  { key: "resolved", label: "종료" },
];

export function ConversationList({
  view,
  onViewChange,
  mine,
  onMineChange,
  filters,
  onFiltersChange,
  query,
  onQueryChange,
  searching,
  counts,
  conversations,
  selectedId,
  onRowClick,
  picked,
  onToggle,
  onSelectAll,
  onClearPicked,
}: {
  view: View;
  onViewChange: (v: View) => void;
  mine: boolean;
  onMineChange: (v: boolean) => void;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  query: string;
  onQueryChange: (q: string) => void;
  // 검색어를 서버에 보내고 결과를 기다리는 중
  searching: boolean;
  counts: Partial<Record<View, number>>;
  conversations: ConversationSummary[];
  selectedId: string | null;
  onRowClick: (id: string, keys: ClickKeys) => void;
  // 여러 개 선택 (비어 있으면 평소 화면)
  picked: Set<string>;
  onToggle: (id: string, keys: ClickKeys) => void;
  onSelectAll: () => void;
  onClearPicked: () => void;
}) {
  const selecting = picked.size > 0;
  const q = query.trim();
  const inSearch = q.length >= SEARCH_MIN;
  const title = VIEWS.find((v) => v.key === view)?.label;
  const empty = filters.unread
    ? "안 읽은 문의가 없어요."
    : view === "waiting" && filters.stale
      ? "하루 넘게 안 읽힌 답변이 없어요."
      : filters.unassigned
        ? "담당자가 없는 문의가 없어요."
        : mine
          ? "내가 담당인 문의가 없어요."
          : "문의가 없어요.";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
        {selecting ? (
          <SelectionBar
            n={picked.size}
            total={conversations.length}
            onSelectAll={onSelectAll}
            onClear={onClearPicked}
          />
        ) : (
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-bold tracking-[-0.02em]">{inSearch ? "검색" : title}</h1>
            {!inSearch && counts[view] !== undefined && (
              <span className="num text-[13px] text-ink-3">{counts[view]}</span>
            )}
            {/* 어느 탭에서든 내가 담당인 문의만 보기 (검색은 전체에서 찾으므로 숨김) */}
            <label
              className={cn(
                "ml-auto flex cursor-pointer items-center gap-1.5 self-center text-[12px] font-medium text-muted-foreground",
                inSearch && "invisible",
              )}
            >
              내 담당만
              <button
                type="button"
                role="switch"
                aria-checked={mine}
                aria-label="내 담당만 보기"
                onClick={() => onMineChange(!mine)}
                className={cn(
                  "relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  mine ? "bg-foreground" : "bg-panel-3 edge",
                )}
              >
                <span
                  className={cn(
                    "absolute top-[3px] left-[3px] size-3 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
                    mine && "translate-x-3",
                  )}
                />
              </button>
            </label>
          </div>
        )}
        <label data-tour="list-search" className="flex h-9 items-center gap-2 rounded-xl bg-panel-2 px-3 text-ink-3 edge focus-within:ring-2 focus-within:ring-ring/50">
          <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
          <input
            id="inbox-search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onQueryChange("")}
            placeholder="이름, 주문번호, 내용, 이메일, 휴대폰"
            aria-label="문의 검색 (전체 기간)"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-ink-3"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="검색어 지우기"
              className="grid size-5 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-panel-3 hover:text-foreground"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          )}
        </label>
      </div>

      {inSearch ? (
        <>
          <p className="px-4 pb-1 text-[12px] text-muted-foreground" aria-live="polite">
            {searching ? (
              "전체 문의에서 찾는 중…"
            ) : (
              <>
                <b className="num font-semibold text-foreground">{conversations.length}건</b> · 전체 기간, 모든 상태에서
                찾았어요
                {conversations.length >= 50 && " (최근 50건까지)"}
              </>
            )}
          </p>
          <div className="h-px bg-border" />
          <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
            {!searching && conversations.length === 0 && (
              <li className="px-6 py-10 text-center text-sm text-ink-3">
                일치하는 문의가 없어요.
                <br />
                <span className="text-[12px]">휴대폰·주문번호는 숫자 4자리 이상이면 일부만 넣어도 돼요.</span>
              </li>
            )}
            {conversations.map((c) => (
              <Row
                key={c.id}
                c={c}
                q={q}
                selected={!selecting && selectedId === c.id}
                picked={picked.has(c.id)}
                selecting={selecting}
                onClick={(keys) => onRowClick(c.id, keys)}
                onToggle={(keys) => onToggle(c.id, keys)}
              />
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="flex gap-0.5 px-3" role="tablist" data-tour="list-tabs">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                onClick={() => onViewChange(v.key)}
                className={cn(
                  "relative flex items-center gap-1 px-2 pt-1.5 pb-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
                  view === v.key
                    ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-signal after:shadow-[var(--cs-glow)]"
                    : "text-ink-3 hover:text-muted-foreground",
                )}
              >
                {v.label}
                {counts[v.key] !== undefined && (
                  <span className={cn("num text-[11px]", view === v.key ? "text-signal-text" : "text-ink-3")}>
                    {counts[v.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="h-px bg-border" />
          {/* 걸러보기: 안 읽음(나에게)·미배정(아직 아무도 답하지 않음), 응대 중 탭에는 하루 넘게 고객 미확인 */}
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-1" role="group" aria-label="걸러보기" data-tour="list-chips">
            <FilterChip on={filters.unread} onClick={() => onFiltersChange({ ...filters, unread: !filters.unread })}>
              <span className={cn("size-1.5 rounded-full", filters.unread ? "bg-background" : "bg-signal")} />안 읽음
            </FilterChip>
            <FilterChip
              on={filters.unassigned}
              onClick={() => {
                // 미배정과 '내 담당만'은 함께 켤 수 없다
                if (!filters.unassigned && mine) onMineChange(false);
                onFiltersChange({
                  ...filters,
                  unassigned: !filters.unassigned,
                });
              }}
            >
              미배정
            </FilterChip>
            {view === "waiting" && (
              <FilterChip on={filters.stale} onClick={() => onFiltersChange({ ...filters, stale: !filters.stale })}>
                하루 넘게 고객 미확인
              </FilterChip>
            )}
          </div>
          <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
            {conversations.length === 0 && <li className="px-6 py-10 text-center text-sm text-ink-3">{empty}</li>}
            {conversations.map((c) => (
              <Row
                key={c.id}
                c={c}
                selected={!selecting && selectedId === c.id}
                picked={picked.has(c.id)}
                selecting={selecting}
                onClick={(keys) => onRowClick(c.id, keys)}
                onToggle={(keys) => onToggle(c.id, keys)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// 선택 중 제목 줄: 몇 개 골랐는지, 전체 선택, 해제
function SelectionBar({
  n,
  total,
  onSelectAll,
  onClear,
}: {
  n: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const all = n >= total;
  return (
    <div className="flex h-[22px] items-center gap-2" aria-live="polite">
      <button
        type="button"
        role="checkbox"
        aria-checked={all ? true : "mixed"}
        aria-label={all ? "선택 해제" : "전체 선택"}
        onClick={all ? onClear : onSelectAll}
        className="grid size-3.5 shrink-0 place-items-center rounded-[4.5px] bg-signal text-background focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        {all ? <Check className="size-2.5" strokeWidth={3.5} /> : <Minus className="size-2.5" strokeWidth={3.5} />}
      </button>
      <h1 className="text-[15px] font-bold tracking-[-0.01em]">
        <span className="num">{n}</span>개 선택
      </h1>
      {!all && (
        <button
          type="button"
          onClick={onSelectAll}
          className="rounded-md px-1 py-0.5 text-[12px] font-semibold text-signal-text hover:bg-signal/10"
        >
          전체 <span className="num">{total}</span>개 선택
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto flex h-6 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-muted-foreground hover:bg-panel-3 hover:text-foreground"
      >
        <X className="size-3" strokeWidth={2.2} />
        해제
      </button>
    </div>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        on ? "bg-foreground text-background" : "bg-panel-2 text-muted-foreground edge hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const MATCH_LABEL: Record<NonNullable<ConversationSummary["match_field"]>, string> = {
  name: "이름",
  member: "회원 아이디",
  order: "주문번호",
  email: "이메일",
  phone: "휴대폰",
  message: "내용",
};

// 검색어 주변만 잘라 강조한다. 숫자만 맞은 경우(휴대폰 하이픈 등)는 강조 없이 보여준다.
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  const start = Math.max(0, i - 14);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, i)}
      <mark className="rounded-[3px] bg-warn/30 px-px text-foreground">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function matchText(c: ConversationSummary) {
  switch (c.match_field) {
    case "name":
      return contactDisplayName(c);
    case "member":
      return c.verified_member_id ?? c.cafe24_member_id_hint ?? "";
    case "order":
      return c.order_ref ?? "";
    case "email":
      return c.contact_email ?? "";
    case "phone":
      return c.contact_phone ?? "";
    default:
      return (c.match_body ?? "").replace(/\s+/g, " ");
  }
}

function Row({
  c,
  q,
  selected,
  picked,
  selecting,
  onClick,
  onToggle,
}: {
  c: ConversationSummary;
  // 검색 결과 줄이면 검색어 (어디서 찾았는지·상태를 함께 보여준다)
  q?: string;
  selected: boolean;
  picked: boolean;
  // 하나라도 골랐으면 모든 줄에 체크박스를 보인다
  selecting: boolean;
  onClick: (keys: ClickKeys) => void;
  onToggle: (keys: ClickKeys) => void;
}) {
  const waiting = c.status === "open" && Boolean(c.last_customer_message_at);
  const h = hoursSince(c.last_customer_message_at);
  const level = waiting ? waitLevel(h) : "fresh";
  const unread = c.unread;
  const customerUnread = c.status === "waiting_customer" && c.customer_unread;
  const customerLate = customerUnread && hoursSince(c.last_agent_reply_at) >= 24;

  return (
    <li className="group/row relative">
      <button
        onClick={(e) => onClick(e)}
        // Shift 클릭으로 범위를 고를 때 글자가 드래그 선택되지 않게
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        aria-current={selected || undefined}
        className={cn(
          "relative grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 rounded-2xl pt-3 pr-3.5 pb-3.5 pl-[22px] text-left transition-colors",
          picked ? "bg-signal/10 ring-1 ring-signal/20 ring-inset" : selected ? "bg-raised edge" : "hover:bg-panel-2",
        )}
      >
        {unread && (
          <span
            className={cn(
              "absolute top-[19px] left-2 size-[5px] rounded-full bg-signal glow transition-opacity group-hover/row:opacity-0",
              selecting && "opacity-0",
            )}
            aria-label="안 읽음"
          />
        )}
        <span className="flex min-w-0 items-center gap-1.5">
          {c.priority !== "normal" && (
            <span
              className={cn("size-1.5 shrink-0 rounded-full", c.priority === "urgent" ? "bg-late" : "bg-warn")}
              aria-label={c.priority === "urgent" ? "긴급" : "높음"}
            />
          )}
          <span className="truncate text-[13.5px] font-semibold">{contactDisplayName(c)}</span>
          {c.verified_member_id ? (
            <ShieldCheck
              className="size-3.5 shrink-0 text-signal-text"
              strokeWidth={2}
              aria-label="Cafe24 회원 확인됨"
            />
          ) : (
            c.cafe24_member_id_hint && <span className="shrink-0 text-[10px] text-ink-3">회원추정</span>
          )}
        </span>
        <span className={cn("num self-center text-[11.5px] font-semibold whitespace-nowrap", WAIT_TEXT[level])}>
          {waiting ? shortWait(h) : formatTime(c.last_message_at)}
        </span>
        {q && c.match_field ? (
          <span className="col-span-2 truncate text-[12.5px] text-muted-foreground">
            <span className="mr-1.5 text-[11px] text-ink-3">
              {c.match_field === "message" && c.match_sender !== "customer" ? "답변·메모" : MATCH_LABEL[c.match_field]}
            </span>
            <Highlight text={matchText(c)} q={q} />
          </span>
        ) : (
          <span className={cn("col-span-2 truncate text-[13px]", unread ? "text-foreground" : "text-muted-foreground")}>
            {c.last_message_preview ?? ""}
          </span>
        )}
        <span className="col-span-2 mt-1 flex items-center gap-1">
          {q && (
            <Chip tone={c.status === "open" ? "warn" : c.status === "waiting_customer" ? "signal" : "neutral"}>
              {STATUS_LABEL[c.status]}
            </Chip>
          )}
          {level === "late" && (
            <Chip tone="late">
              <span className="size-1.5 rounded-full bg-current" />
              기한 초과
            </Chip>
          )}
          {c.category && <Chip>{CATEGORY_LABEL[c.category]}</Chip>}
          {c.from_ai && (
            <Chip tone="signal">
              <Sparkles className="size-3" strokeWidth={2} />
              AI에서 이어짐
            </Chip>
          )}
          {customerUnread && (
            <Chip tone={customerLate ? "warn" : "neutral"} title="고객이 마지막 답변을 아직 안 읽었어요">
              <Clock className="size-3" strokeWidth={2} />
              고객 미확인
            </Chip>
          )}
          <span className="ml-auto flex min-w-0 items-center gap-1 text-[11px] text-ink-3">
            {c.assigned_agent_name && (
              <AgentAvatar
                agent={{
                  name: c.assigned_agent_name,
                  avatar_url: c.assigned_agent_avatar_url,
                  avatar_emoji: c.assigned_agent_avatar_emoji,
                }}
                size={16}
              />
            )}
            <span className="truncate">{c.assigned_agent_name ?? "미배정"}</span>
          </span>
        </span>
        {waiting && (
          <span className="col-span-2 mt-2 h-0.5 overflow-hidden rounded-full bg-panel-3" aria-hidden>
            <span
              className={cn(
                "block h-full rounded-full",
                level === "late"
                  ? "bg-late shadow-[0_0_8px_var(--cs-late)]"
                  : level === "warn"
                    ? "bg-warn"
                    : "bg-ink-3",
              )}
              style={{
                width: `${Math.min(100, Math.max(2, (h / SLA_HOURS) * 100))}%`,
              }}
            />
          </span>
        )}
      </button>
      {/* 체크박스는 안 읽음 점 자리(왼쪽 여백)에 겹쳐 나온다 — 줄 내용은 움직이지 않음 */}
      <button
        type="button"
        role="checkbox"
        aria-checked={picked}
        aria-label={`${contactDisplayName(c)} 선택`}
        onClick={(e) => onToggle(e)}
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        className={cn(
          "absolute top-3 left-0.5 grid size-[18px] place-items-center rounded-md transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none motion-reduce:transition-none",
          selecting ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
        )}
      >
        <span
          className={cn(
            "grid size-3.5 place-items-center rounded-[4.5px]",
            picked ? "bg-signal text-background" : "bg-card ring-[1.5px] ring-ink-3/55 ring-inset",
          )}
        >
          {picked && <Check className="size-2.5" strokeWidth={3.5} />}
        </span>
      </button>
    </li>
  );
}
