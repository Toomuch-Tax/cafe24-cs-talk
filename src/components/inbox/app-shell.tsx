"use client";

import { ArrowUpRight, Inbox, LogOut, ScrollText, Settings, Sparkles, Store } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { Toaster } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { installErrorReporter } from "@/lib/client/report-error";
import { testShopUrl } from "@/lib/client/test-shop";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./agent-avatar";
import { ConsoleTour, tourSeen } from "./console-tour";
import { forgetConversations } from "./conversation-cache";
import { useAgent, type AgentInfo } from "./use-agent";

type Console = {
  // 로그인 확인 전에는 null (틀만 먼저 그린다)
  agent: AgentInfo | null;
  // 상담 화면이 '내가 안 읽은 문의' 여부를 독 점으로 알린다
  setHasUnread: (v: boolean) => void;
  // 설정 → 사용자에서 승인·거절하면 독의 승인 대기 점도 바로 바뀌게
  setPendingUsers: (n: number) => void;
  // 설정 → 내 프로필의 '가이드 다시 보기'
  startTour: () => void;
  // 둘러보기가 문의 화면(4~6단계)을 설명하는 중 → 열린 문의가 없으면 상담 화면이 예시 문의를 그린다
  tourDemo: boolean;
};
const ConsoleContext = createContext<Console | null>(null);

export function useConsole() {
  const c = useContext(ConsoleContext);
  if (!c) throw new Error("useConsole 은 ConsoleShell 안에서만 쓴다");
  return c;
}

// 상담원 화면 공통 틀: 앰비언트 배경 + 왼쪽에 떠 있는 독(dock) + 유리 패널들.
// (console) 레이아웃에서 한 번만 그려서 메뉴를 옮겨도 다시 그려지지 않는다. 로그인 확인도 한 번만.
export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const agent = useAgent();
  const [hasUnread, setHasUnread] = useState(false);
  const [pendingLive, setPendingUsers] = useState<number | null>(null);
  // 콘솔 둘러보기: 처음 로그인한 사람에게 한 번 (넓은 화면에서만 자동으로)
  const [touring, setTouring] = useState(false);
  const [tourDemo, setTourDemo] = useState(false);
  const startTour = useCallback(() => setTouring(true), []);
  const value = useMemo(
    () => ({ agent, setHasUnread, setPendingUsers, startTour, tourDemo }),
    [agent, startTour, tourDemo],
  );
  const agentId = agent?.id;
  useEffect(() => {
    if (!agentId || tourSeen(agentId) || window.innerWidth < 1024) return;
    const t = setTimeout(() => setTouring(true), 600);
    return () => clearTimeout(t);
  }, [agentId]);
  const pendingUsers = pendingLive ?? agent?.pendingUsers ?? 0;
  const pathname = usePathname();
  const router = useRouter();
  // 어느 화면에서든 테스트 쇼핑몰로 바로 갈 수 있게 독에 바로가기를 둔다
  const [mallId, setMallId] = useState<string | null>(null);
  // 화면에서 난 오류를 운영 개선 → 오류 기록으로 보낸다
  useEffect(() => installErrorReporter(), []);
  // 아래 두 요청은 로그인 확인이 끝난 뒤에 한 번만 시작한다
  const signedIn = agent !== null;
  useEffect(() => {
    if (!signedIn) return;
    api<{ connected: boolean; mallId: string }>("/api/cafe24/status")
      .then((s) => setMallId(s.connected ? s.mallId : null))
      .catch(() => {});
  }, [signedIn]);
  // AI 응대 '확인 필요' 건수 (화면이 보일 때만 1분마다)
  const [aiNeed, setAiNeed] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible")
        await api<{ counts: { need: number } }>("/api/inbox/ai?count=1")
          .then((r) => !stopped && setAiNeed(r.counts.need))
          .catch(() => {});
      if (!stopped) timer = setTimeout(tick, 60_000);
    };
    tick();
    const onChange = (e: Event) => setAiNeed((e as CustomEvent<number>).detail);
    window.addEventListener("cstalk:ai-need", onChange);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("cstalk:ai-need", onChange);
    };
  }, [signedIn]);
  const items = [
    { href: "/inbox", label: "상담", icon: Inbox, dot: hasUnread && pathname.startsWith("/inbox") },
    { href: "/ai", label: "AI 응대", icon: Sparkles, dot: false, count: aiNeed },
    { href: "/policies", label: "AI 응답 정책", icon: ScrollText, dot: false },
    { href: "/settings", label: "설정", icon: Settings, dot: pendingUsers > 0 },
  ];
  // 메뉴 이름 툴팁: 기다림 없이 바로 뜨고, 버튼을 옮기면 같은 라벨이 따라 움직인다
  const [tip, setTip] = useState<DockTipState | null>(null);
  const tipFor = (label: string, extra?: Omit<DockTipState, "label" | "y" | "moving">) => {
    const open = (e: React.SyntheticEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const y = el.offsetTop + el.offsetHeight / 2;
      setTip((t) => ({ label, ...extra, y, moving: !!t && !t.hidden }));
    };
    return { onPointerEnter: open, onFocus: open };
  };
  const closeTip = () => setTip((t) => t && { ...t, hidden: true });

  return (
    <ConsoleContext.Provider value={value}>
    <Toaster>
    {/* AI 응대는 '다른 방' — 배경·패널 선·AI 말풍선이 AI 색으로 바뀐다 (globals.css [data-room="ai"]) */}
    <div className="ambient flex h-dvh gap-2 p-2" data-room={pathname.startsWith("/ai") ? "ai" : undefined}>
      <nav
        aria-label="주 메뉴"
        className="glass relative z-10 flex w-14 shrink-0 flex-col items-center gap-1 self-center rounded-full py-2.5"
        onPointerLeave={closeTip}
        onBlur={closeTip}
      >
        <BrandMark className="mb-2" />
        <div data-tour="nav-menu" className="flex flex-col items-center gap-1">
        {items.map(({ href, label, icon: Icon, dot, count }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              {...tipFor(
                label,
                count
                  ? { chip: `확인 필요 ${count > 99 ? "99+" : count}`, tone: "warn" }
                  : href === "/settings" && pendingUsers > 0
                    ? { chip: `승인 대기 ${pendingUsers}`, tone: "signal" }
                    : undefined,
              )}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative grid size-10 place-items-center rounded-full text-ink-3 transition-colors hover:bg-panel-3 hover:text-foreground",
                active && (href === "/ai" ? "ai-grad text-white shadow-[var(--cs-ai-glow)] hover:text-white" : "bg-panel-3 text-foreground edge"),
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
              {dot && <span className="absolute top-2 right-2 size-[7px] rounded-full bg-signal glow" />}
              {count ? (
                <span
                  className="num absolute -top-0.5 -right-0.5 min-w-[18px] rounded-full bg-warn px-1 text-center text-[10px] leading-[18px] font-semibold text-white"
                  aria-label={`확인 필요 ${count}건`}
                >
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </Link>
          );
        })}
        </div>
        {mallId && (
          <a
            href={testShopUrl()}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="테스트 쇼핑몰 열기"
            data-tour="nav-shop"
            {...tipFor("테스트 쇼핑몰", { external: true })}
            className="grid size-10 place-items-center rounded-full text-ink-3 transition-colors hover:bg-panel-3 hover:text-foreground"
          >
            <Store className="size-[18px]" strokeWidth={1.75} />
          </a>
        )}
        <div className="mt-2 h-px w-6 bg-border" />
        {agent ? (
          <Link
            href="/settings?tab=me"
            aria-label="내 프로필"
            data-tour="nav-me"
            {...tipFor(`${agent.name} · 내 프로필`)}
            className="mt-2 rounded-full transition-transform hover:scale-105"
          >
            <AgentAvatar agent={agent} size={32} />
          </Link>
        ) : (
          <span className="mt-2 size-8 rounded-full bg-panel-3" />
        )}
        <button
          type="button"
          aria-label="로그아웃"
          {...tipFor("로그아웃")}
          className="grid size-10 place-items-center rounded-full text-ink-3 transition-colors hover:bg-panel-3 hover:text-foreground"
          onClick={async () => {
            await api("/api/auth/logout", { method: "POST" });
            forgetConversations();
            router.replace("/login");
          }}
        >
          <LogOut className="size-4" strokeWidth={1.75} />
        </button>
        {tip && <DockTip {...tip} />}
      </nav>
      {/* 각 화면은 로그인 확인 전(agent 없음)에는 아무것도 그리지 않는다. 여기서 children 을 빼면 Next 가 화면을 못 그린 것으로 본다 */}
      {children}
    </div>
    {touring && agent && <ConsoleTour agentId={agent.id} onDemo={setTourDemo} onClose={() => setTouring(false)} />}
    </Toaster>
    </ConsoleContext.Provider>
  );
}

type DockTipState = {
  label: string;
  chip?: string;
  tone?: "warn" | "signal";
  external?: boolean;
  // 독 안에서 버튼 가운데 높이
  y: number;
  // 이미 떠 있던 라벨이 다른 버튼으로 옮겨 가는 중이면 미끄러지게
  moving: boolean;
  hidden?: boolean;
};

// 독 오른쪽에 뜨는 라벨. 독(glass) 안이라 backdrop-blur 가 먹지 않아 불투명 흰 바탕을 쓴다. 스크린리더는 버튼의 aria-label 을 읽으므로 숨긴다
function DockTip({ label, chip, tone, external, y, moving, hidden }: DockTipState) {
  const [entered, setEntered] = useState(false);
  // 처음 그릴 때 한 프레임 숨겼다가 보여야 페이드인이 보인다
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = entered && !hidden;
  return (
    <div
      aria-hidden
      style={{ top: y }}
      className={cn(
        "pointer-events-none absolute left-[calc(100%+10px)] flex h-8 -translate-y-1/2 items-center gap-1.5 rounded-xl bg-popover px-3 text-[13px] font-semibold whitespace-nowrap text-foreground float",
        "transition-[opacity,translate] duration-[120ms] ease-out motion-reduce:transition-opacity",
        moving && shown && "transition-[opacity,translate,top] duration-[180ms] motion-reduce:transition-opacity",
        shown ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0 motion-reduce:translate-x-0",
      )}
    >
      {label}
      {chip && (
        <span
          className={cn(
            "num rounded-full px-1.5 py-px text-[11px] font-semibold",
            tone === "warn" ? "bg-warn/15 text-warn-text" : "bg-signal-soft text-signal-text",
          )}
        >
          {chip}
        </span>
      )}
      {external && <ArrowUpRight className="size-3 text-ink-3" strokeWidth={2} />}
    </div>
  );
}

export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("glass flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel", className)}
      {...props}
    />
  );
}

export function Section({ title, last, children }: { title?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn("px-4 pt-4 pb-5", !last && "border-b")}>
      {title && <h3 className="mb-3 font-mono text-[11px] font-medium text-ink-3">{title}</h3>}
      {children}
    </section>
  );
}

export function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] bg-panel-2 p-5 edge sm:p-6">
      <h2 className="text-base font-bold tracking-[-0.015em]">{title}</h2>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
