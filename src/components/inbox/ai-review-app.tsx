"use client";

import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Eye,
  Mail,
  MessagesSquare,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { toast } from "@/components/ui/toast";
import { api, ApiError, type ChatMessage, formatTime, newClientId } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Panel, useConsole } from "./app-shell";
import { CATEGORY_LABEL } from "./labels";

// 인박스 'AI 응대'.
// 고객이 위젯에서 AI 와 나눈 대화를 모은다. 지금 위젯을 보고 있는 고객은 '대화 중' → 대화 참여(문의로 바꿔 바로 답함),
// AI 답을 받지 못하고 떠난 대화는 '확인 필요' → 답변 남기기 / 확인함. 서버 규칙은 src/lib/ai-review.ts
type Tab = "live" | "need" | "linked" | "done";
type Turn = {
  id: string;
  question: string;
  answer: string | null;
  decision: "answered" | "handoff" | "blocked" | "error";
  reason: string | null;
  feedback: "helpful" | "not_helpful" | null;
  feedback_at: string | null;
  created_at: string;
  topics: string[];
};
type Item = {
  id: string;
  grp: Tab | "waiting";
  question: string;
  answer: string | null;
  decision: "answered" | "handoff" | "blocked" | "error";
  reason: string | null;
  feedback: "helpful" | "not_helpful" | null;
  category: string | null;
  page_url: string | null;
  created_at: string;
  activity_at: string;
  last_seen_at: string | null;
  turns: number;
  contact_id: string;
  contact_name: string | null;
  member_id: string | null;
  email: string | null;
  linked_conversation_id: string | null;
  topics: string[];
};
type Detail = Item & {
  feedback_at: string | null;
  review: "dismissed" | "replied" | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  joined_at: string | null;
  joined_name: string | null;
  linked_submitted_at: string | null;
  turnList: Turn[];
};

// 목록은 사람이 볼 것(확인 필요)이 기본. 대화 중은 위 관제 보드, 해결됨·문의로 이어짐은 목록 아래 요약에서 연다
type ListTab = Exclude<Tab, "live">;
type Counts = Record<Tab, number> & { today_done: number; today_total: number };
const LIST_TITLE: Record<ListTab, string> = {
  need: "사람이 봐야 할 것",
  linked: "문의로 이어짐",
  done: "AI가 혼자 해결",
};
const POLL_MS = 15_000;
// 대화 중인 고객이 있으면 새 질문과 떠남을 바로 보여준다 (상담원 화면이라 방문자 수와 무관)
const LIVE_POLL_MS = 4_000;
const IDLE_LIVE_POLL_MS = 10_000;

const who = (x: Pick<Item, "contact_name" | "member_id" | "contact_id">) =>
  x.contact_name ?? (x.member_id ? `회원 ${x.member_id.slice(0, 3)}***` : `비회원 ${x.contact_id.slice(0, 6)}`);

// 결과 칩: 무엇 때문에 사람이 봐야 하는지
function outcome(x: Pick<Item, "decision" | "feedback">): { label: string; tone: "warn" | "late" | "ok" | "neutral" } {
  if (x.decision !== "answered") return { label: x.decision === "error" ? "답변 오류" : "AI가 넘김", tone: "warn" };
  if (x.feedback === "not_helpful") return { label: "해결 안 됨", tone: "late" };
  if (x.feedback === "helpful") return { label: "해결됐어요", tone: "ok" };
  return { label: "반응 없음", tone: "neutral" };
}

function reasonText(x: Pick<Turn, "decision" | "reason" | "feedback">) {
  if (x.decision === "error") return "AI 답변을 불러오지 못했어요";
  if (x.decision === "answered") return x.feedback === "not_helpful" ? "AI 답변 뒤 고객이 '해결 안 됨'을 눌렀어요" : "AI가 답변했어요";
  const r = x.reason ?? "";
  if (r === "escalation_keyword") return "불량·가품 같은 표현이 있어 AI를 거치지 않고 바로 넘겼어요";
  if (r.startsWith("draft_only:")) return `상담원 확인 주제(${r.slice(11)})라 AI가 답하지 않았어요`;
  if (r === "no_grounding") return "정책·상품 정보에 근거가 없어 AI가 답하지 않았어요";
  if (r === "forbidden_phrase") return "약속할 수 없는 표현이 들어가 AI 답변을 막았어요";
  return r ? `AI가 넘겼어요 (${r})` : "AI가 넘겼어요";
}

const pathOf = (u: string | null) => {
  try {
    return u ? decodeURIComponent(new URL(u).pathname) : null;
  } catch {
    return null;
  }
};

// 인박스 'AI 응대' = 관제 보드.
// 상담은 '내가 답할 일의 줄'이라 세로 목록 그대로, AI 응대는 '흐르는 대화를 내려다보는 곳'이라 모양부터 다르게:
// 위에 지금 대화 중인 고객 카드 + 오늘 AI 해결률, 아래 목록은 사람이 봐야 할 것만, 할 일 없는 기록은 요약으로 접는다.
export function AiReviewApp() {
  const { agent } = useConsole();
  const [tab, setTab] = useState<ListTab>("need");
  const [items, setItems] = useState<Item[] | null>(null);
  const [live, setLive] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Partial<Counts>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  const liveCountRef = useRef(0);

  const applyCounts = useCallback((c: Counts) => {
    setCounts(c);
    window.dispatchEvent(new CustomEvent("cstalk:ai-need", { detail: c.need }));
  }, []);
  const loadLive = useCallback(async () => {
    const r = await api<{ items: Item[]; counts: Counts }>("/api/inbox/ai?tab=live");
    setLive(r.items);
    applyCounts(r.counts);
  }, [applyCounts]);
  const load = useCallback(async () => {
    const r = await api<{ tab: Tab; items: Item[]; counts: Counts }>(`/api/inbox/ai?tab=${tabRef.current}`);
    if (r.tab !== tabRef.current) return;
    setItems(r.items);
    applyCounts(r.counts);
    // 목록을 읽다가 대화 중 수가 바뀐 걸 보면 위 보드도 바로 다시 읽는다 (보드가 늦게 따라오지 않게)
    if (r.counts.live !== liveCountRef.current) loadLive().catch(() => {});
  }, [applyCounts, loadLive]);
  const reloadAll = useCallback(async () => {
    await Promise.all([load(), loadLive()]);
  }, [load, loadLive]);

  // 슬랙 링크 /ai?a=<id>
  useEffect(() => {
    const a = new URLSearchParams(location.search).get("a");
    if (!a) return;
    const t = setTimeout(() => setSelectedId(a), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!agent) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await load().catch(() => {});
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [agent, tab, load]);

  // 대화 중인 고객이 있을 때만 빠르게 다시 읽는다
  const liveCount = live?.length ?? 0;
  useEffect(() => {
    liveCountRef.current = liveCount;
  }, [liveCount]);
  useEffect(() => {
    if (!agent) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await loadLive().catch(() => {});
      if (!stopped) timer = setTimeout(tick, liveCountRef.current ? LIVE_POLL_MS : IDLE_LIVE_POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [agent, loadLive]);

  if (!agent) return null;

  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter((x) => !q || [x.question, who(x)].some((v) => v.toLowerCase().includes(q)));
  const switchTab = (t: ListTab) => {
    setTab(t);
    setItems(null);
  };

  return (
    <>
      <h1 className="sr-only">AI 응대</h1>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <LiveBoard live={live} counts={counts} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="flex min-h-0 flex-1 gap-2">
          <Panel className="w-80 shrink-0" data-tour="ai-list">
            <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
              <div className="flex items-center gap-2">
                {tab === "need" ? (
                  <span className="grid size-5 place-items-center rounded-[7px] ai-grad text-white">
                    <Sparkles className="size-3" strokeWidth={2} />
                  </span>
                ) : (
                  <button
                    onClick={() => switchTab("need")}
                    aria-label="사람이 봐야 할 것으로 돌아가기"
                    title="사람이 봐야 할 것으로 돌아가기"
                    className="-ml-1 grid size-6 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-panel-3 hover:text-foreground"
                  >
                    <ArrowLeft className="size-4" strokeWidth={1.75} />
                  </button>
                )}
                <h2 className="text-base font-bold tracking-[-0.02em]">{LIST_TITLE[tab]}</h2>
                <span className={cn("num text-[13px]", tab === "need" && counts.need ? "text-warn-text" : "text-ink-3")}>
                  {counts[tab]}
                </span>
                <span className="ml-auto font-mono text-[11px] text-ink-3">{tab === "need" ? "AI 응대" : "최근 90일"}</span>
              </div>
              <label className="flex h-9 items-center gap-2 rounded-xl bg-panel-2 px-3 text-ink-3 edge focus-within:ring-2 focus-within:ring-ring/50">
                <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="질문 내용, 고객"
                  aria-label="AI 응대 검색"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-ink-3"
                />
              </label>
            </div>
            <div className="h-px bg-border" />
            <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
              {items !== null && shown.length === 0 && (
                <li className="px-6 py-10 text-center text-sm text-ink-3">
                  {q ? "일치하는 AI 응대가 없어요." : tab === "need" ? "사람이 볼 AI 응대가 없어요. AI가 잘 하고 있어요." : "없어요."}
                </li>
              )}
              {shown.map((x) => {
                const o = outcome(x);
                return (
                  <li key={x.id}>
                    <button
                      onClick={() => setSelectedId(x.id)}
                      aria-current={selectedId === x.id || undefined}
                      className={cn(
                        "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 rounded-2xl px-3 pt-3 pb-3.5 text-left transition-colors",
                        selectedId === x.id ? "bg-raised edge" : "hover:bg-panel-2",
                      )}
                    >
                      <span className="row-span-3 mt-0.5 grid size-7 place-items-center rounded-full ai-grad text-white">
                        <Sparkles className="size-3.5" strokeWidth={2} />
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-semibold">{who(x)}</span>
                        {x.email && !x.member_id && <span className="shrink-0 text-[10px] text-ink-3">메일 있음</span>}
                      </span>
                      <span className="num self-center text-[11.5px] font-semibold whitespace-nowrap text-ink-3">
                        {formatTime(x.activity_at)}
                      </span>
                      <span className="col-span-2 truncate text-[13px]">{x.question}</span>
                      <span className="col-span-2 mt-1 flex flex-wrap items-center gap-1">
                        {x.grp === "linked" ? <Chip tone="signal">문의로 이어짐</Chip> : <Chip tone={o.tone}>{o.label}</Chip>}
                        {x.turns > 1 && <Chip>{x.turns}번 주고받음</Chip>}
                        {x.category && x.category !== "etc" && <Chip>{CATEGORY_LABEL[x.category] ?? x.category}</Chip>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {tab === "need" && (
              <div className="m-1.5 flex flex-col rounded-2xl bg-panel-2 p-1 edge">
                <DigestRow
                  icon={<Check className="size-3.5 text-ok-text" strokeWidth={2} />}
                  label="AI가 혼자 해결"
                  n={counts.done}
                  onClick={() => switchTab("done")}
                />
                <DigestRow
                  icon={<MessagesSquare className="size-3.5 text-ink-3" strokeWidth={1.75} />}
                  label="문의로 이어짐"
                  n={counts.linked}
                  onClick={() => switchTab("linked")}
                />
              </div>
            )}
          </Panel>
          {selectedId ? (
            <AiDetail key={selectedId} id={selectedId} onChanged={reloadAll} />
          ) : (
            <Panel className="flex-1 items-center justify-center gap-3 text-center">
              <span className="grid size-12 place-items-center rounded-2xl ai-grad text-white">
                <Sparkles className="size-5" strokeWidth={1.75} />
              </span>
              <p className="text-sm text-muted-foreground">위의 대화 중 카드나 왼쪽 목록에서 고르세요.</p>
              <p className="max-w-80 text-[12px] leading-relaxed text-ink-3">
                고객이 위젯에서 AI와 대화하는 동안은 위에 카드로 떠요. AI 답을 받지 못하고 문의도 남기지 않은 채 30분이 지나면
                &lsquo;사람이 봐야 할 것&rsquo;에 올라와요.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function DigestRow({ icon, label, n, onClick }: { icon: React.ReactNode; label: string; n?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-panel-3 hover:text-foreground"
    >
      {icon}
      {label}
      <span className="num ml-auto text-[13px] font-semibold text-foreground">{n ?? ""}</span>
      <ChevronRight className="size-3.5 text-ink-3" strokeWidth={1.75} />
    </button>
  );
}

// 위 관제 보드: 지금 위젯에서 AI 와 대화 중인 고객 + 오늘 AI 가 혼자 끝낸 비율
function LiveBoard({
  live,
  counts,
  selectedId,
  onSelect,
}: {
  live: Item[] | null;
  counts: Partial<Counts>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const n = live?.length ?? 0;
  const total = counts.today_total ?? 0;
  const done = counts.today_done ?? 0;
  const rate = total ? Math.round((done / total) * 100) : null;
  return (
    <Panel className="shrink-0 gap-3 px-4 pt-3.5 pb-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.02em]">
          {n ? <LiveDot /> : <span className="size-2 rounded-full bg-ink-3/40" />}
          지금 AI와 대화 중
          <span className={cn("num text-[13px]", n ? "text-ok-text" : "text-ink-3")}>{live ? n : ""}</span>
        </h2>
        {live && !n && <span className="text-[12px] text-ink-3">새 대화가 시작되면 여기에 떠요</span>}
        <div
          className="ml-auto flex items-center gap-2.5 text-[12px] text-muted-foreground"
          title="오늘 시작해 결과가 난 AI 대화 중, 문의로 넘어가거나 확인이 필요하지 않고 끝난 비율"
        >
          오늘 AI 혼자 해결
          {rate === null ? (
            <span className="text-ink-3">아직 없음</span>
          ) : (
            <>
              <span className="h-1.5 w-28 overflow-hidden rounded-full bg-panel-3">
                <span
                  className="block h-full rounded-full bg-ok transition-[width] duration-700 ease-out"
                  style={{ width: `${rate}%` }}
                />
              </span>
              <span className="flex items-baseline gap-1">
                <b className="num text-[15px] font-semibold text-foreground">{rate}%</b>
                <span className="num text-ink-3">
                  {done}/{total}
                </span>
              </span>
            </>
          )}
        </div>
      </div>
      {n > 0 && (
        <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {live!.map((x) => {
            const stuck = x.decision !== "answered" || x.feedback === "not_helpful";
            return (
              <li key={x.id} className="shrink-0">
                <button
                  onClick={() => onSelect(x.id)}
                  aria-current={selectedId === x.id || undefined}
                  className={cn(
                    "flex w-64 flex-col gap-1.5 rounded-2xl bg-raised px-3.5 py-3 text-left edge transition-colors hover:bg-card",
                    selectedId === x.id && "outline-2 outline-ok",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                    <LiveDot />
                    <span className="truncate">{who(x)}</span>
                    <span className="num ml-auto shrink-0 text-[11px] font-medium text-ink-3">{x.turns}번째 질문</span>
                  </span>
                  <span className="truncate text-[12.5px] text-muted-foreground">{x.question}</span>
                  <span className="flex items-center gap-2 text-[11.5px]">
                    <span className={stuck ? "font-medium text-warn-text" : "text-ok-text"}>
                      {stuck ? outcome(x).label : "AI 답변 확인 중"}
                    </span>
                    <span className="ml-auto font-semibold text-foreground">열어서 참여 →</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function LiveDot() {
  return (
    <span className="relative flex size-2 shrink-0" aria-label="대화 중">
      <span className="absolute inset-0 animate-ping rounded-full bg-ok/60 motion-reduce:animate-none" />
      <span className="relative size-2 rounded-full bg-ok" />
    </span>
  );
}

function AiDetail({ id, onChanged }: { id: string; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [item, setItem] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [clientMessageId] = useState(newClientId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const turnCount = item?.turnList.length ?? 0;

  const reload = useCallback(
    () =>
      api<{ item: Detail }>(`/api/inbox/ai/${id}`)
        .then((r) => setItem(r.item))
        .catch((err) => {
          if (err instanceof ApiError && err.status === 404) setMissing(true);
        }),
    [id],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  // 대화 중이면 고객의 새 질문·AI 답을 몇 초마다 다시 읽는다 (떠나면 멈춤)
  const live = item?.grp === "live";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, reload]);
  useEffect(() => {
    if (turnCount) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turnCount]);

  if (missing) return <Panel className="flex-1 items-center justify-center text-sm text-ink-3">찾을 수 없는 AI 응대예요.</Panel>;
  if (!item) return <Panel className="flex-1 items-center justify-center text-sm text-ink-3">불러오는 중…</Panel>;

  const o = outcome(item);
  const need = item.grp === "need" || item.grp === "waiting";
  const page = pathOf(item.page_url);
  const reach = item.member_id
    ? { icon: Eye, text: "회원이라 다음에 쇼핑몰에 오면 위젯 버튼 배지와 '내 문의'로 답변을 봐요." }
    : item.email
      ? { icon: Mail, text: `남긴 메일(${item.email})로도 알려요. 위젯에서 60분 안에 확인하지 않으면 발송돼요.` }
      : { icon: Eye, text: "비회원·메일 없음: 같은 브라우저로 쇼핑몰에 다시 오면 버튼 배지로 답변을 봐요." };

  const steps: { at: string | null; text: string; tone?: "end" | "good" }[] = [];
  item.turnList.forEach((t, i) => {
    steps.push({ at: t.created_at, text: `${i === 0 ? "AI에게 질문" : `이어서 질문 (${i + 1}번째)`} — ${reasonText(t)}` });
    if (t.feedback_at)
      steps.push({ at: t.feedback_at, text: t.feedback === "helpful" ? "고객이 '해결됐어요'를 누름" : "고객이 '문의 남길게요'(해결 안 됨)를 누름" });
  });
  if (item.joined_at)
    steps.push({ at: item.joined_at, text: `${item.joined_name ?? "상담원"} 님이 대화에 참여 → 문의로 만들어 담당`, tone: "good" });
  else if (item.review === "replied")
    steps.push({ at: item.reviewed_at, text: `${item.reviewer_name ?? "상담원"} 님이 답변 → 문의로 만들어 '답변 완료'로`, tone: "good" });
  else if (item.linked_submitted_at)
    steps.push({ at: item.linked_submitted_at, text: "고객이 문의를 남김", tone: "good" });
  else if (item.review === "dismissed")
    steps.push({ at: item.reviewed_at, text: `${item.reviewer_name ?? "상담원"} 님이 확인함 (답변 없이 정리)`, tone: "good" });
  else if (live) steps.push({ at: null, text: "고객이 지금 위젯 대화 화면을 보고 있어요", tone: "good" });
  else if (need) steps.push({ at: null, text: "문의를 남기지 않고 떠남", tone: "end" });

  const alreadyLinked = async (err: unknown) => {
    if (err instanceof ApiError && err.code.startsWith("already_linked:")) {
      toast.error("이미 문의로 이어졌어요. 문의 화면에서 답변해주세요.");
      await Promise.all([reload(), onChanged()]);
      return true;
    }
    return false;
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await api(`/api/inbox/ai/${id}/dismiss`, { method: "POST" });
      toast.success("확인함으로 옮겼어요.");
      await Promise.all([reload(), onChanged()]);
    } catch (err) {
      toast.error("처리하지 못했어요.", err);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api(`/api/inbox/ai/${id}/reply`, { method: "POST", body: JSON.stringify({ clientMessageId, body }) });
      toast.success("답변을 보냈어요. '답변 완료'에서 이어서 볼 수 있어요.");
      setComposing(false);
      await Promise.all([reload(), onChanged()]);
    } catch (err) {
      if (!(await alreadyLinked(err))) toast.error("답변을 보내지 못했어요.", err);
    } finally {
      setBusy(false);
    }
  };

  // 대화 참여: 문의로 바꿔 내 담당으로 두고 문의 화면으로 간다 (고객 위젯은 몇 초 안에 담당자 대화로 바뀜)
  const join = async () => {
    setBusy(true);
    try {
      const r = await api<{ conversationId: string }>(`/api/inbox/ai/${id}/join`, { method: "POST" });
      toast.success("대화에 참여했어요. 여기서 답하면 고객 화면에 바로 떠요.");
      router.push(`/inbox?c=${r.conversationId}`);
    } catch (err) {
      if (!(await alreadyLinked(err))) toast.error("참여하지 못했어요.", err);
      setBusy(false);
    }
  };

  return (
    <Panel className="flex-1">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 px-6 pt-5 pb-4">
        <div className="mr-auto flex min-w-0 flex-col gap-1">
          <h2 className="flex min-w-0 items-center gap-2.5 text-[22px] leading-tight font-bold tracking-[-0.025em]">
            <span className="truncate">{who(item)}</span>
            {live ? <Chip tone="ok">대화 중</Chip> : <Chip tone={o.tone}>{o.label}</Chip>}
          </h2>
          <p className="flex min-w-0 items-center gap-2 font-mono text-[11.5px] text-ink-3">
            <span className="shrink-0 font-sans">AI 응대</span>
            {item.turns > 1 && <span className="shrink-0 font-sans">· {item.turns}번 주고받음</span>}
            {item.category && <span className="shrink-0 font-sans">· {CATEGORY_LABEL[item.category] ?? item.category}</span>}
            {page && <span className="truncate">· {page}</span>}
          </p>
        </div>
        {live ? (
          <Button className="h-8 rounded-xl" onClick={join} disabled={busy}>
            <MessagesSquare />
            대화 참여
          </Button>
        ) : (
          need && (
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" className="h-8 rounded-xl" onClick={dismiss} disabled={busy}>
                <Check />
                확인함
              </Button>
              <Link href="/policies" className={cn(buttonVariants({ variant: "outline" }), "h-8 rounded-xl")}>
                정책 고치기
              </Link>
            </div>
          )
        )}
      </header>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto pt-1 pb-4">
        <div className="px-6">
          {live ? (
            <div className="flex gap-2.5 rounded-2xl bg-ok/12 px-4 py-3 text-[13px] leading-relaxed text-ok-text">
              <MessagesSquare className="mt-0.5 size-4 shrink-0" />
              <p>
                <b className="font-semibold text-foreground">고객이 지금 위젯에서 AI와 대화하고 있어요.</b> 참여하면 이 대화가
                문의로 바뀌어 내 담당이 되고, AI는 더 답하지 않아요. 문의 화면에서 답하면 몇 초 안에 고객 화면에 떠요
                (고객에게는 실명 대신 고객 노출 이름으로 보여요).
              </p>
            </div>
          ) : need ? (
            <div className="flex gap-2.5 rounded-2xl bg-warn/12 px-4 py-3 text-[13px] leading-relaxed text-warn-text">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <p>
                <b className="font-semibold text-foreground">고객이 답을 받지 못하고 떠났어요.</b> {reasonText(item)}. 답변을
                남기면 이 고객의 문의로 만들어져 &lsquo;답변 완료&rsquo;로 가요.
              </p>
            </div>
          ) : item.grp === "linked" ? (
            <div className="flex items-center gap-2.5 rounded-2xl bg-signal-soft px-4 py-3 text-[13px] text-signal-text">
              <ExternalLink className="size-4 shrink-0" />
              <p className="mr-auto">
                <b className="font-semibold text-foreground">
                  {item.joined_at
                    ? `${item.joined_name ?? "상담원"} 님이 대화에 참여해 문의로 만들었어요.`
                    : item.review === "replied"
                      ? "답변을 보내 문의로 만들었어요."
                      : "고객이 문의를 남겼어요."}
                </b>{" "}
                이어지는 대화는 문의 화면에서 해요.
              </p>
              {item.linked_conversation_id && (
                <Link href={`/inbox?c=${item.linked_conversation_id}`} className="shrink-0 font-semibold hover:underline">
                  문의 열기 →
                </Link>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-2xl bg-ok/12 px-4 py-3 text-[13px] text-ok-text">
              <Check className="size-4 shrink-0" />
              <p>
                <b className="font-semibold text-foreground">
                  {item.review === "dismissed"
                    ? "확인함으로 정리했어요."
                    : item.feedback === "helpful"
                      ? "고객이 해결됐다고 했어요."
                      : "AI 답변 뒤 반응이 없어 해결로 봤어요."}
                </b>{" "}
                할 일은 없어요.
              </p>
            </div>
          )}
        </div>

        {item.turnList.map((t, i) => (
          <TurnView key={t.id} turn={t} seq={i} />
        ))}

        <ol className="mx-6 mt-2 flex flex-col border-l border-border" aria-label="진행 기록">
          {steps.map((s, i) => (
            <li key={i} className="relative pb-2.5 pl-4 text-[12.5px] leading-relaxed text-muted-foreground">
              <span
                className={cn(
                  "absolute top-[7px] -left-[4px] size-[7px] rounded-full",
                  s.tone === "end" ? "bg-warn" : s.tone === "good" ? "bg-ok" : "bg-ink-3",
                )}
              />
              {s.at && <time className="num mr-1.5 text-[11px] text-ink-3">{formatTime(s.at)}</time>}
              {s.text}
            </li>
          ))}
        </ol>
      </div>

      {need &&
        (composing ? (
          <div className="mx-4 mb-4 flex flex-col rounded-[18px] bg-raised edge">
            <p className="flex items-center gap-2 border-b px-3.5 py-2.5 text-xs text-muted-foreground">
              <reach.icon className="size-3.5 shrink-0 text-ink-3" />
              {reach.text}
            </p>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              placeholder="고객에게 보낼 답변"
              aria-label="답변"
              rows={3}
              maxLength={4000}
              className="max-h-60 min-h-20 resize-none bg-transparent px-3.5 py-3 text-[14px] leading-relaxed outline-none [field-sizing:content] placeholder:text-ink-3"
            />
            <div className="flex items-center gap-2 px-3.5 pt-1 pb-2.5">
              <span className="mr-auto text-[11.5px] text-ink-3">보내면 이 고객의 문의로 만들어지고 &lsquo;답변 완료&rsquo;로 가요</span>
              <Button variant="ghost" className="h-8 rounded-xl" onClick={() => setComposing(false)} disabled={busy}>
                취소
              </Button>
              <Button className="h-8 rounded-xl" onClick={send} disabled={busy || !draft.trim()}>
                <ArrowUp />
                보내기
              </Button>
            </div>
          </div>
        ) : (
          <div className="mx-4 mb-4 flex items-center gap-3">
            <p className="mr-auto flex items-center gap-2 text-xs text-ink-3">
              <reach.icon className="size-3.5 shrink-0" />
              {reach.text}
            </p>
            <Button className="h-9 rounded-xl" onClick={() => setComposing(true)}>
              답변 남기기
            </Button>
          </div>
        ))}
    </Panel>
  );
}

// 문답 하나: 고객 질문 → AI 답 (또는 답하지 않은 이유) → 근거 주제
function TurnView({ turn: t, seq }: { turn: Turn; seq: number }) {
  const messages: ChatMessage[] = [
    {
      id: `${t.id}:q`,
      seq: seq * 2 + 1,
      sender_type: "customer",
      agent_name: null,
      body: t.question,
      client_message_id: `${t.id}:q`,
      created_at: t.created_at,
    },
    ...(t.answer && t.decision === "answered"
      ? [
          {
            id: `${t.id}:a`,
            seq: seq * 2 + 2,
            sender_type: "ai" as const,
            agent_name: null,
            body: t.answer,
            ai_kind: "auto_sent" as const,
            client_message_id: `${t.id}:a`,
            created_at: t.created_at,
          },
        ]
      : []),
  ];
  return (
    <>
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} viewer="agent" />
      ))}
      {t.decision !== "answered" && (
        <p className="mx-6 self-start rounded-2xl bg-panel-3 px-3.5 py-2 text-[13px] text-muted-foreground">
          AI 답변 없음 — {reasonText(t)}
        </p>
      )}
      {t.topics.length > 0 && (
        <div className="flex flex-wrap gap-1 px-6">
          {t.topics.map((tp) => (
            <span key={tp} className="rounded-md bg-panel-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3 edge">
              {tp}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
