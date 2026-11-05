"use client";

import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { Panel, useConsole } from "./app-shell";
import { BulkPanel } from "./bulk-panel";
import { cachedConversation, fetchConversation } from "./conversation-cache";
import { APP_NAME } from "@/lib/brand";
import {
  ConversationList,
  SEARCH_MIN,
  type ClickKeys,
  type ConversationSummary,
  type Filters,
  type View,
} from "./conversation-list";
import { ConversationView, type QuickReply } from "./conversation-view";
import { TourDemo } from "./tour-demo";

const LIST_POLL_MS = 3000;
// 다른 탭을 보고 있을 때도 새 문의가 탭 아이콘 점으로 보이도록 드물게 확인한다
const HIDDEN_POLL_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 300;
const MINE_KEY = "cstalk_inbox_mine";
const NO_FILTERS: Filters = { unread: false, unassigned: false, stale: false };

// 목록 요청 주소. 응답이 늦게 와도 지금 화면 조건과 같은지 이 값으로 확인한다.
function listQuery(view: View, mine: boolean, f: Filters, q: string) {
  const p = new URLSearchParams({ view });
  if (q.length >= SEARCH_MIN) {
    p.set("q", q);
    return p.toString();
  }
  if (mine) p.set("mine", "1");
  if (f.unread) p.set("unread", "1");
  if (f.unassigned) p.set("unassigned", "1");
  if (f.stale && view === "waiting") p.set("stale", "1");
  return p.toString();
}

export function InboxApp() {
  const { agent, setHasUnread, tourDemo } = useConsole();
  const [view, setView] = useState<View>("open");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [counts, setCounts] = useState<Partial<Record<View, number>>>({});
  // 답변 필요 중 내가 안 읽은 문의 수 (보고 있는 탭·필터와 무관, 탭 제목·사이드바 점에 씀)
  const [mineUnread, setMineUnread] = useState(0);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // 입력 중인 검색어 / 서버에 보낸 검색어 (입력을 멈추면 보낸다)
  const [query, setQuery] = useState("");
  const [sentQuery, setSentQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 오른쪽에 실제로 그리고 있는 문의. 다른 문의를 누르면 그 내용이 올 때까지 앞 문의를 (흐리게) 남겨 둬서
  // "앞 대화 → 빈 화면 → 새 대화"로 번쩍이지 않게 한다. 열어 본 적 있는 문의는 바로 바뀐다.
  const [shownId, setShownId] = useState<string | null>(null);
  // 여러 개 선택 (⌘/Ctrl 클릭·Shift 클릭·체크박스). 탭·필터·검색을 바꾸면 푼다.
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  // Shift 클릭 범위의 시작점: 마지막으로 누른 줄
  const anchorRef = useRef<string | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  // "내 담당만" 토글. 이 브라우저에만 기억한다. (목록은 로그인 확인 뒤에 그려져서 서버 렌더와 어긋나지 않음)
  const [mine, setMine] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(MINE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const queryRef = useRef("");
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    queryRef.current = listQuery(view, mine, filters, sentQuery);
    selectedRef.current = selectedId;
  }, [view, mine, filters, sentQuery, selectedId]);

  const loadList = useCallback(async () => {
    const asked = queryRef.current;
    const res = await api<{
      conversations: ConversationSummary[];
      counts: Partial<Record<View, number>>;
      mineUnread: number;
    }>(`/api/inbox/conversations?${asked}`);
    setCounts(res.counts);
    setMineUnread(res.mineUnread);
    if (asked !== queryRef.current) return;
    // '안 읽음'만 보는 중에 문의를 열면 읽음이 되어 목록에서 빠진다 → 보고 있는 문의는 제자리에 남겨 둔다
    const sel = selectedRef.current;
    setConversations((prev) => {
      const next = res.conversations;
      if (!sel || !asked.includes("unread=1") || next.some((c) => c.id === sel)) return next;
      const at = prev.findIndex((c) => c.id === sel);
      if (at < 0) return next;
      return [...next.slice(0, at), { ...prev[at], unread: false }, ...next.slice(at)];
    });
    setSearching(false);
  }, []);

  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(() => setSentQuery(q.length >= SEARCH_MIN ? q : ""), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // 문의마다 고유 주소(/inbox?c=<id>) — 슬랙 알림·팀원이 공유한 링크로 들어오면 그 문의를 연다.
  // 문의를 열면 주소창도 그 주소로 바꿔서 그대로 복사해 공유할 수 있고, 뒤로/앞으로 가기로 보던 문의를 오간다.
  const linkedRef = useRef(false);
  useEffect(() => {
    const read = () => new URLSearchParams(location.search).get("c");
    const c = read();
    linkedRef.current = Boolean(c);
    const t = c ? setTimeout(() => setSelectedId(c), 0) : undefined;
    const onPop = () => {
      setPickedIds([]);
      setSelectedId(read());
    };
    window.addEventListener("popstate", onPop);
    return () => {
      clearTimeout(t);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  // 목록·이전 문의에서 열기 (주소창에 기록). 같은 문의를 다시 누르면 기록을 쌓지 않는다.
  const openConversation = useCallback((id: string | null) => {
    setSelectedId(id);
    if (new URLSearchParams(location.search).get("c") === (id ?? null)) return;
    history.pushState(null, "", id ? `/inbox?c=${id}` : "/inbox");
  }, []);

  useEffect(() => {
    if (!agent) return;
    api<{ agents: { id: string; name: string }[] }>("/api/inbox/agents").then((r) => setAgents(r.agents));
    api<{ quickReplies: QuickReply[] }>("/api/inbox/quick-replies").then((r) => setQuickReplies(r.quickReplies));
  }, [agent]);

  useEffect(() => {
    if (!agent) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let last = 0;
    const tick = async () => {
      if (document.visibilityState === "visible" || Date.now() - last >= HIDDEN_POLL_MS) {
        last = Date.now();
        await loadList().catch(() => {});
      }
      if (!stopped) timer = setTimeout(tick, LIST_POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [agent, view, mine, filters, sentQuery, loadList]);

  // 목록이 새로 고쳐져 빠진 문의는 선택에서도 뺀다 (목록에 보이는 것만 처리)
  const picked = useMemo(() => {
    const ids = new Set(pickedIds);
    return conversations.filter((c) => ids.has(c.id));
  }, [pickedIds, conversations]);
  const pickedSet = useMemo(() => new Set(picked.map((c) => c.id)), [picked]);
  const clearPicked = useCallback(() => setPickedIds([]), []);

  // ⌘/Ctrl 클릭 = 하나씩 넣고 빼기 (지금 열어 둔 문의도 함께 — 메일 앱과 같음), Shift 클릭 = 마지막으로 누른 줄부터 범위,
  // 그냥 클릭 = 선택을 풀고 그 문의 하나만 연다
  const clickRow = (id: string, keys: ClickKeys) => {
    const ids = conversations.map((c) => c.id);
    const base = picked.length ? picked.map((c) => c.id) : selectedId && ids.includes(selectedId) ? [selectedId] : [];
    if (keys.shiftKey) {
      const from = anchorRef.current ?? selectedId ?? id;
      let i = ids.indexOf(from);
      const j = ids.indexOf(id);
      if (i < 0) i = j;
      const range = ids.slice(Math.min(i, j), Math.max(i, j) + 1);
      setPickedIds([...base, ...range.filter((r) => !base.includes(r))]);
      return;
    }
    anchorRef.current = id;
    if (keys.metaKey || keys.ctrlKey) {
      setPickedIds(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
      return;
    }
    setPickedIds([]);
    openConversation(id);
  };
  // 체크박스는 열어 둔 문의를 끼워 넣지 않고 그 줄만 넣고 뺀다
  const toggleRow = (id: string, keys: ClickKeys) => {
    if (keys.shiftKey && picked.length) return clickRow(id, keys);
    anchorRef.current = id;
    const cur = picked.map((c) => c.id);
    setPickedIds(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const selectAll = useCallback(() => setPickedIds(conversations.map((c) => c.id)), [conversations]);

  // 선택 중: Esc 해제, ⌘/Ctrl+A 목록 전체 (입력 칸에 있을 땐 원래 동작)
  const selecting = picked.length > 0;
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "Escape") clearPicked();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, clearPicked, selectAll]);

  // 답변 필요 중 내가 안 읽은 문의 수를 탭 제목에 표시
  useEffect(() => {
    if (!selectedId) return;
    let off = false;
    fetchConversation(selectedId)
      .catch(() => {})
      .finally(() => !off && setShownId(selectedId));
    return () => {
      off = true;
    };
  }, [selectedId]);
  // 비어 있던 자리에서 처음 여는 문의와 열어 본 적 있는 문의는 기다리지 않고 바로 그린다
  const viewId =
    selectedId && (!shownId || shownId === selectedId || cachedConversation(selectedId)) ? selectedId : shownId;
  const switching = Boolean(selectedId && viewId !== selectedId);

  useEffect(() => {
    setHasUnread(mineUnread > 0);
  }, [mineUnread, setHasUnread]);

  useEffect(() => {
    document.title = mineUnread ? `(${mineUnread}) ${APP_NAME}` : APP_NAME;
  }, [mineUnread]);

  useEffect(() => {
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    links.forEach((l) => (l.href = mineUnread ? "/icon-unread.svg" : "/icon.svg"));
    return () => links.forEach((l) => (l.href = "/icon.svg"));
  }, [mineUnread]);

  if (!agent) return null;

  return (
    <>
      <Panel className="w-80 shrink-0">
        <ConversationList
          view={view}
          onViewChange={(v) => {
            setView(v);
            // '하루 넘게 고객 미확인'은 응대 중 탭에서만 쓴다
            setFilters((f) => ({ ...f, stale: false }));
            setConversations([]);
            setPickedIds([]);
          }}
          mine={mine}
          onMineChange={(v) => {
            setMine(v);
            // 내 담당만과 미배정은 함께 켤 수 없다
            if (v) setFilters((f) => ({ ...f, unassigned: false }));
            setConversations([]);
            setPickedIds([]);
            try {
              localStorage.setItem(MINE_KEY, v ? "1" : "0");
            } catch {}
          }}
          filters={filters}
          onFiltersChange={(f) => {
            setFilters(f);
            setConversations([]);
            setPickedIds([]);
          }}
          query={query}
          onQueryChange={(q) => {
            setQuery(q);
            setPickedIds([]);
            const searchNow = q.trim().length >= SEARCH_MIN;
            setSearching(searchNow);
            // 검색을 지우면 바로 원래 목록으로 (입력 중에는 멈출 때까지 기다렸다가 서버에 보낸다)
            if (!searchNow) setSentQuery("");
            if (searchNow !== sentQuery.length >= SEARCH_MIN) setConversations([]);
          }}
          searching={searching}
          counts={counts}
          conversations={conversations}
          selectedId={selectedId}
          onRowClick={clickRow}
          picked={pickedSet}
          onToggle={toggleRow}
          onSelectAll={selectAll}
          onClearPicked={clearPicked}
        />
      </Panel>
      {selecting ? (
        <BulkPanel
          picked={picked}
          agentId={agent.id}
          agents={agents}
          onChanged={() => loadList().catch(() => {})}
          onResolved={clearPicked}
        />
      ) : selectedId && viewId ? (
        <ConversationView
          key={viewId}
          conversationId={viewId}
          busy={switching}
          agent={agent}
          agents={agents}
          quickReplies={quickReplies}
          onChanged={loadList}
          onOpen={openConversation}
          onShown={(status) => {
            // 공유 링크로 들어온 문의는 그 상태의 탭을 열어 목록에서도 위치가 보이게 한다 (처음 한 번만)
            if (!linkedRef.current) return;
            linkedRef.current = false;
            const v: View = status === "waiting_customer" ? "waiting" : status === "resolved" ? "resolved" : "open";
            if (v === view || query.trim().length >= SEARCH_MIN) return;
            setView(v);
            setFilters(NO_FILTERS);
            setMine(false);
            setConversations([]);
          }}
          onMarkedUnread={() => {
            openConversation(null);
            setShownId(null);
            loadList().catch(() => {});
          }}
        />
      ) : tourDemo ? (
        <TourDemo />
      ) : (
        <Panel className="flex-1 items-center justify-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-panel-3 text-ink-3 edge">
            <MessageSquare className="size-5" strokeWidth={1.75} />
          </span>
          <p className="text-sm text-muted-foreground">왼쪽에서 문의를 선택하세요.</p>
          <p className="font-mono text-[11px] text-ink-3">오래 기다린 문의가 위에 있어요</p>
        </Panel>
      )}
    </>
  );
}
