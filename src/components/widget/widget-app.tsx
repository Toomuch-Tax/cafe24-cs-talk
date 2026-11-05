"use client";

import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  House,
  type LucideIcon,
  MessageCircle,
  Package,
  PenLine,
  Plus,
  RefreshCw,
  Ruler,
  Sparkles,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PUBLIC_PROFILE, ProfileAvatar, PublicProfileProvider, type PublicProfile } from "@/components/chat/public-profile";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import { api, ApiError, formatTime, type ChatMessage } from "@/lib/client/api";
import { installErrorReporter, setClientScreen } from "@/lib/client/report-error";
import { flushEvents, installTrackFlush, pageTypeOf, setTrackToken, trackEvent } from "@/lib/client/track";
import { isFeatureOn } from "@/lib/features";
import type { WidgetEnv } from "@/lib/widget-token";
import { AiChat } from "./ai-chat";
import { AskAi } from "./ask-ai";
import { widgetUpload } from "./attachments";
import { WidgetEnvContext } from "./env";
import { categoryOf } from "./inquiry-fields";
import { InquiryForm } from "./inquiry-form";
import { parseResume, type Resume, shopLinks, SignupNote } from "./login-nudge";
import { OrderStatus, type InquiryPrefill } from "./order-status";
import { INQUIRY_STATUS, ThreadView } from "./thread-view";

// 실시간 상담이 아닌 셀프서비스 + 문의 접수 위젯.
// 하단 탭: 홈(AI 질문 / 주문 조회 / 재입고·사이즈) · 대화(남긴 문의 + AI 대화 목록)

// 홈의 '문의 남기기' 줄. 꺼 두면 문의는 AI 질문을 거쳐 들어온다(양식·대화 탭 경로는 그대로)
const SHOW_DIRECT_INQUIRY = false;

const TOKEN_KEY = "cstalk_visitor_token";
const INQUIRY_POLL_MS = 60_000; // 새 답변 배지 확인 (위젯이 열려 있지 않을 때도 느슨하게)

const allowedParents = (process.env.NEXT_PUBLIC_WIDGET_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

type Init = {
  token: string | null;
  pageUrl: string | null;
  // 상품 상세에서 열었을 때 화면의 상품명 (widget.js 가 읽어 보낸다)
  productName?: string | null;
  memberIdHint: string | null;
  memberToken?: string | null;
  env?: WidgetEnv;
  open: boolean;
  // 로그인·회원가입을 마치고 돌아와 다시 열렸을 때 이어갈 화면 (login-nudge.tsx)
  resume?: Resume | null;
};
type Inquiry = {
  id: string;
  status: string;
  category: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  has_new_reply: boolean;
};
// 대화 탭의 AI 대화 (담당자가 참여해 문의로 바뀐 대화는 문의 쪽에 있다)
type AiChatItem = { id: string; last_turn_at: string; preview: string };
type Tab = "home" | "chats";
type View =
  | { name: "home" }
  | { name: "chats" }
  | { name: "orders" }
  | { name: "ask"; question: string | null; resumeChatId?: string | null }
  | { name: "form"; prefill: InquiryPrefill }
  | { name: "submitted"; conversationId: string; emailGiven: boolean }
  | { name: "thread"; conversationId: string };

function readLocalToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeLocalToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

function detectFrame(): {
  parentOrigin: string | null;
  blocked: boolean;
  embedded: boolean;
} {
  const embedded = window.parent !== window;
  if (!embedded) return { parentOrigin: location.origin, blocked: false, embedded };
  const origin = new URLSearchParams(location.search).get("origin");
  // 같은 서버의 데모 페이지에서 띄운 경우도 허용 (preview 배포 테스트용)
  const allowed = origin === location.origin || (origin !== null && allowedParents.includes(origin));
  if (!origin || !allowed) return { parentOrigin: null, blocked: true, embedded };
  return { parentOrigin: origin, blocked: false, embedded };
}

const productFromUrl = (url: string | null) => {
  if (!url) return null;
  // 상품 상세는 /product/{상품명}/{상품번호}/... — /product/list.html(카테고리 목록)·search.html 은 상품이 아니다
  const m = url.match(/\/product\/([^/?#]+)\/\d+(?:[/?#]|$)/);
  return m ? decodeURIComponent(m[1]).replace(/-/g, " ") : null;
};

export function WidgetApp() {
  const [frame] = useState(detectFrame);
  const { parentOrigin, blocked, embedded } = frame;
  const [token, setToken] = useState<string | null>(null);
  const [member, setMember] = useState(false);
  const [env, setEnv] = useState<WidgetEnv>("live");
  const [emailOn, setEmailOn] = useState(false);
  const [attachOn, setAttachOn] = useState(false);
  const [greeting, setGreeting] = useState("");
  const [sla, setSla] = useState("영업일 기준 24시간 이내");
  const [hours, setHours] = useState<{ text: string; open: boolean } | null>(null);
  const [profile, setProfile] = useState<PublicProfile>(DEFAULT_PUBLIC_PROFILE);
  const [open, setOpen] = useState(true);
  const [view, setViewState] = useState<View>({ name: "home" });
  // 모션: 화면 전환 방향(탭으로 돌아가면 뒤로, 탭끼리는 살짝 떠오름), 첫 오픈 홈 스태거는 한 번만, 엣지 트레이스는 첫 오픈 1회
  const [viewDir, setViewDir] = useState<"forward" | "back" | "tab" | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const [edgeDone, setEdgeDone] = useState(false);
  const [wideScreen] = useState(() => window.screen.width > 480); // 모바일은 전체 화면이라 모서리 빛을 그리지 않는다
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ name: "home" });
  // 대화·문의 화면에서 ‹ 를 누르면 들어온 탭으로 돌아간다
  const tabRef = useRef<Tab>("home");
  const aiChatRef = useRef(false);
  const setView = useCallback((next: View) => {
    // 행동 기록: 홈에서 고른 메뉴, AI 답변 화면에서 '문의 남기기'로 넘어간 것
    const from = viewRef.current.name;
    if (from === "home") {
      const menu =
        next.name === "orders"
          ? "order"
          : next.name === "ask"
            ? "ai"
            : next.name === "form"
              ? next.prefill.category === "restock"
                ? "restock"
                : next.prefill.category === "size"
                  ? "size"
                  : "inquiry"
              : null;
      if (menu) trackEvent({ name: "menu_click", props: { menu } });
    } else if (from === "ask" && next.name === "form") {
      trackEvent({ name: "ai_handoff_click", props: { from: aiChatRef.current ? "ai_chat" : "ask_ai" } });
    }
    const isTab = (n: View["name"]): n is Tab => n === "home" || n === "chats";
    viewRef.current = next;
    setClientScreen(next.name);
    setViewDir(isTab(next.name) ? (isTab(from) ? "tab" : "back") : "forward");
    if (isTab(next.name)) tabRef.current = next.name;
    if (next.name !== "home") setIntroDone(true);
    setViewState(next);
  }, []);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [pageProduct, setPageProduct] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [chats, setChats] = useState<AiChatItem[] | null>(null);
  // '내 문의' 이어쓰기 사진 첨부 (미공개 기능 + 저장소 연결 시)
  const threadUpload = useMemo(
    () => (isFeatureOn("attachments", env) && attachOn && token ? widgetUpload(token) : null),
    [env, attachOn, token],
  );

  const postToParent = useCallback(
    (msg: Record<string, unknown>) => {
      if (parentOrigin) window.parent.postMessage(msg, parentOrigin);
    },
    [parentOrigin],
  );

  useEffect(() => {
    if (embedded && parentOrigin) window.parent.postMessage({ type: "cstalk:ready" }, parentOrigin);
  }, [embedded, parentOrigin]);

  // 위젯 안 오류 수집 + 탭이 숨겨질 때 행동 기록 보내기
  useEffect(() => {
    installErrorReporter();
    installTrackFlush();
    setClientScreen("home");
  }, []);
  useEffect(() => setTrackToken(token), [token]);
  useEffect(() => {
    aiChatRef.current = isFeatureOn("aiChat", env);
  }, [env]);
  // 열 때마다 widget_open 한 번 (바로 전송), 닫히면 남은 기록 전송
  const openTracked = useRef(false);
  useEffect(() => {
    if (!open) {
      if (openTracked.current) flushEvents(true);
      openTracked.current = false;
      return;
    }
    if (!token || openTracked.current) return;
    openTracked.current = true;
    trackEvent({ name: "widget_open", props: { page_type: pageTypeOf(pageUrl), member } }, { now: true });
  }, [open, token, pageUrl, member]);

  const startSession = useCallback(async (init: Init) => {
    setPageUrl(init.pageUrl);
    setPageProduct(init.productName ?? null);
    try {
      const res = await api<{
        token: string;
        greeting: string;
        sla: string;
        member: boolean;
        env: WidgetEnv;
        emailEnabled: boolean;
        attachments?: boolean;
        hours?: { text: string; open: boolean } | null;
        profile?: PublicProfile;
      }>("/api/widget/session", {
        method: "POST",
        body: JSON.stringify({
          token: init.token ?? readLocalToken(),
          pageUrl: init.pageUrl,
          memberIdHint: init.memberIdHint,
          memberToken: init.memberToken ?? null,
          env: init.env ?? "live",
        }),
      });
      writeLocalToken(res.token);
      setToken(res.token);
      setGreeting(res.greeting);
      setSla(res.sla);
      setHours(res.hours ?? null);
      if (res.profile) setProfile(res.profile);
      setMember(res.member);
      setEnv(res.env);
      setEmailOn(res.emailEnabled);
      setAttachOn(Boolean(res.attachments));
      setConnectionError(false);
      const r = init.resume;
      if (r?.view === "form") setView({ name: "form", prefill: r.prefill });
      else if (r?.view === "orders") setView({ name: "orders" });
      else if (r?.view === "chats") setView({ name: "chats" });
    } catch {
      setConnectionError(true);
    }
  }, [setView]);

  useEffect(() => {
    if (!parentOrigin) return;
    if (!embedded) {
      const t = setTimeout(
        () =>
          startSession({
            token: null,
            pageUrl: null,
            memberIdHint: null,
            open: true,
          }),
        0,
      );
      return () => clearTimeout(t);
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== parentOrigin || e.source !== window.parent) return;
      const d = e.data ?? {};
      if (d.type === "cstalk:init") {
        setOpen(d.open !== false);
        startSession({
          token: typeof d.token === "string" ? d.token : null,
          pageUrl: typeof d.pageUrl === "string" ? d.pageUrl : null,
          productName: typeof d.productName === "string" ? d.productName.slice(0, 120) : null,
          memberIdHint: typeof d.memberIdHint === "string" ? d.memberIdHint : null,
          memberToken: typeof d.memberToken === "string" ? d.memberToken : null,
          env: d.env === "test" ? "test" : "live",
          open: d.open !== false,
          resume: parseResume(d.resume),
        });
      } else if (d.type === "cstalk:visibility") {
        setOpen(Boolean(d.open));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded, parentOrigin, startSession]);

  // widget.js 가 iframe 을 런처에서 패널로 늘리는 동안 내용은 늦게 선명해지고, 닫힐 때는 먼저 사라진다
  useEffect(() => {
    const el = rootRef.current;
    if (!embedded || !el?.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.getAnimations().forEach((a) => a.cancel());
    if (open) {
      el.animate(
        [
          { opacity: 0, filter: "blur(6px)" },
          { opacity: 1, filter: "blur(0)" },
        ],
        {
          duration: 300,
          delay: 140,
          easing: "cubic-bezier(.23,1,.32,1)",
          fill: "backwards",
        },
      );
    } else {
      el.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 100,
        easing: "ease",
        fill: "forwards",
      });
    }
  }, [open, embedded]);

  useEffect(() => {
    if (token) postToParent({ type: "cstalk:token", token });
  }, [token, postToParent]);

  // 내 문의 목록 + 새 답변 배지
  const loadInquiries = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api<{ inquiries: Inquiry[]; email: string | null; watch?: boolean }>("/api/widget/inquiries", { token });
      setInquiries(r.inquiries);
      setEmail(r.email);
      postToParent({
        type: "cstalk:unread",
        count: r.inquiries.filter((i) => i.has_new_reply).length,
      });
      postToParent({
        type: "cstalk:has_inquiry",
        value: r.inquiries.length > 0 || Boolean(r.watch),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setToken(null);
        startSession({ token: null, pageUrl, memberIdHint: null, open });
      }
    }
  }, [token, postToParent, startSession, open, pageUrl]);

  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await loadInquiries();
      timer = setTimeout(tick, INQUIRY_POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [token, loadInquiries]);

  // AI 대화 목록은 대화 탭을 볼 때만 불러온다 (문의 목록은 배지 확인 때 이미 받아 둠)
  const viewName = view.name;
  useEffect(() => {
    if (!token || viewName !== "chats") return;
    api<{ chats: AiChatItem[] }>("/api/widget/ai-chat", { token })
      .then((r) => setChats(r.chats))
      .catch(() => setChats((cur) => cur ?? []));
  }, [token, viewName]);

  const goHome = () => {
    setView({ name: "home" });
    loadInquiries();
  };
  const goBack = () => {
    setView({ name: tabRef.current });
    loadInquiries();
  };
  // 화면의 상품명이 우선, 예전 widget.js(캐시)가 보내지 않으면 주소에서 읽는다
  const product = pageProduct ?? productFromUrl(pageUrl);
  // 상품 페이지에서 열었으면 상품명 칸을 미리 채운다 (유형에 상품명 칸이 있을 때만 쓰인다, 눌러서 고칠 수 있음)
  const startInquiry = (prefill: InquiryPrefill) =>
    setView({
      name: "form",
      prefill: product ? { ...prefill, fields: { item: product, ...prefill.fields } } : prefill,
    });

  if (blocked) return null;

  const title =
    view.name === "orders"
      ? "주문·배송 조회"
      : view.name === "ask"
        ? "AI 답변"
        : view.name === "form"
          ? "문의 남기기"
          : view.name === "thread"
            ? "내 문의"
            : null;
  const newReplies = inquiries.filter((q) => q.has_new_reply).length;
  const aiChatOn = isFeatureOn("aiChat", env);
  const onTab = view.name === "home" || view.name === "chats";
  // 접수 완료: 비회원에게 회원가입하면 이 문의가 회원 계정으로 이어진다고 알린다 (login-nudge.tsx D)
  const signupLinks =
    isFeatureOn("loginNudge", env) && !member && embedded ? shopLinks(parentOrigin, pageUrl) : null;

  return (
    <WidgetEnvContext.Provider value={env}>
    <PublicProfileProvider value={profile}>
      <div ref={rootRef} className="ambient flex h-dvh flex-col overflow-hidden bg-card">
        {embedded && wideScreen && token && open && !edgeDone && (
          <span aria-hidden className="widget-edge-trace" onAnimationEnd={() => setEdgeDone(true)} />
        )}
        <header className={cn("flex h-14 shrink-0 items-center gap-1 px-2", title ? "border-b" : "pl-4")}>
          {view.name === "chats" ? (
            <h1 className="text-[17px] font-bold tracking-[-0.02em]">대화</h1>
          ) : title ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl text-muted-foreground"
                aria-label="뒤로"
                onClick={goBack}
              >
                <ChevronLeft className="size-[18px]" />
              </Button>
              {view.name === "ask" && aiChatOn ? (
                // AI 대화는 메신저처럼 답하는 쪽(고객 노출 이름·로고)을 위에 보여준다
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="relative shrink-0">
                    <ProfileAvatar size="md" />
                    <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-ok ring-2 ring-card" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate text-sm leading-tight font-semibold">{profile.name}</b>
                    <small className="truncate text-[11px] text-ink-3">보통 몇 초 안에 답해요</small>
                  </span>
                </span>
              ) : (
                <p className="text-sm font-semibold">{title}</p>
              )}
            </>
          ) : (
            <>
              <ProfileAvatar size="sm" />
              <p className="ml-1.5 truncate text-xs text-ink-3">{profile.name}</p>
            </>
          )}
          {embedded && (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto rounded-xl text-muted-foreground"
              aria-label="닫기"
              onClick={() => postToParent({ type: "cstalk:close" })}
            >
              <X className="size-[18px]" />
            </Button>
          )}
        </header>

        {connectionError && (
          <Notice tone="warning" size="sm" className="rounded-none px-4">
            연결이 불안정해요. 잠시 후 다시 시도해주세요.
          </Notice>
        )}

        {/* 화면이 바뀔 때마다 새로 마운트되어 방향 있는 슬라이드로 들어온다 */}
        <div
          key={view.name === "thread" || view.name === "submitted" ? view.conversationId : view.name}
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            viewDir === "forward" && "widget-view-forward",
            viewDir === "back" && "widget-view-back",
            viewDir === "tab" && "widget-rise",
          )}
        >
          {!token ? (
            <div className="flex flex-1 items-center justify-center text-sm text-ink-3">불러오는 중…</div>
          ) : view.name === "home" ? (
            <div
              className={cn(
                "flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-5",
                !introDone && "widget-stagger",
              )}
            >
              <div className="px-1 pb-1">
                <h1 className="text-[24px] leading-tight font-bold tracking-[-0.035em]">무엇을 도와드릴까요?</h1>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {greeting || "주문·배송은 바로 확인할 수 있어요."}
                </p>
              </div>

              {/* 홈에서 가장 먼저 눈이 가야 하는 입구 — 흰 카드 + 파란 링 + 파란 전송 버튼 */}
              <form
                className="flex h-14 items-center gap-2.5 rounded-[20px] bg-raised pr-2 pl-4 edge ring-[3px] ring-signal-soft transition-shadow focus-within:ring-signal/30"
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = question.trim();
                  if (q.length < 2) return;
                  setQuestion("");
                  setView({ name: "ask", question: q });
                }}
              >
                <Sparkles className="size-[18px] shrink-0 text-signal-text" strokeWidth={1.75} />
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={1000}
                  placeholder="궁금한 점을 물어보세요"
                  aria-label="AI에게 질문"
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
                />
                <button
                  type="submit"
                  className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-signal text-signal-foreground glow transition-[opacity,transform] active:scale-95 disabled:opacity-45 disabled:shadow-none"
                  aria-label="질문하기"
                  disabled={question.trim().length < 2}
                >
                  <ArrowUp className="size-[18px]" />
                </button>
              </form>
              <p className="-mt-1.5 px-2 text-xs leading-relaxed text-ink-3">
                사이즈·재입고·교환·반품, 무엇이든 물어보세요.
                <br />
                AI가 바로 답하고, 필요하면 담당자에게 이어드려요.
              </p>

              <button
                onClick={() => setView({ name: "orders" })}
                className="group flex w-full items-center gap-3 rounded-2xl bg-raised p-3.5 text-left transition-transform edge active:scale-[0.99]"
              >
                {/* 파란 채움은 질문창 전송 버튼에만 — 여기는 연한 파랑으로 한 단계 낮춘다 */}
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal-soft text-signal-text">
                  <Package className="size-[18px]" strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <b className="block text-sm font-semibold">주문·배송 조회</b>
                  <small className="block text-xs text-ink-3">출고 · 송장 · 반품 진행</small>
                </span>
                <ChevronRight className="ml-auto size-4 text-ink-3 transition-transform group-hover:translate-x-0.5" />
              </button>

              <div className="flex flex-col rounded-2xl bg-raised p-1 edge">
                <HomeItem
                  icon={RefreshCw}
                  title="재입고 문의"
                  sub={product ? "보고 계신 상품" : "상품·옵션 입력"}
                  onClick={() => startInquiry({ category: "restock" })}
                />
                <HomeItem
                  icon={Ruler}
                  title="사이즈·상품 문의"
                  sub="실측 · 소재 · 세탁"
                  onClick={() => startInquiry({ category: "size" })}
                />
                {/* '문의 남기기'는 AI 질문을 거치게 해서 홈에서 숨김 — AI 답의 '담당자에게 남기기'·대화 탭의 '새 문의 남기기'로 들어간다 */}
                {SHOW_DIRECT_INQUIRY && (
                  <HomeItem
                    icon={PenLine}
                    title="문의 남기기"
                    sub={`담당자가 확인 후 답변 · ${sla}`}
                    onClick={() => startInquiry({ category: "etc" })}
                  />
                )}
              </div>

              {hours && <BusinessHoursNote hours={hours} />}

            </div>
          ) : view.name === "chats" ? (
            <ChatList
              inquiries={inquiries}
              chats={chats}
              onInquiry={(id) => setView({ name: "thread", conversationId: id })}
              onChat={(id) => setView({ name: "ask", question: null, resumeChatId: id })}
              onNew={() => startInquiry({ category: "etc" })}
            />
          ) : view.name === "ask" && aiChatOn ? (
            <AiChat
              key={view.resumeChatId ?? view.question ?? ""}
              token={token}
              question={view.question}
              resumeChatId={view.resumeChatId ?? null}
              pageUrl={pageUrl}
              active={open}
              onInquiry={startInquiry}
              onOrders={() => setView({ name: "orders" })}
              onHome={goHome}
              upload={threadUpload}
              // 담당자가 나중에 답할 수 있으니 쇼핑몰 페이지에서 새 답변 배지를 확인하게 한다
              onUnresolved={() => postToParent({ type: "cstalk:has_inquiry", value: true })}
            />
          ) : view.name === "ask" ? (
            <AskAi
              key={view.question}
              token={token}
              question={view.question ?? ""}
              pageUrl={pageUrl}
              onInquiry={startInquiry}
              onOrders={() => setView({ name: "orders" })}
              // 답을 못 받았으면 상담원이 나중에 답할 수 있으니 쇼핑몰 페이지에서 새 답변 배지를 확인하게 한다
              onUnresolved={() => postToParent({ type: "cstalk:has_inquiry", value: true })}
            />
          ) : view.name === "orders" ? (
            <OrderStatus
              token={token}
              member={member}
              shopOrigin={embedded ? parentOrigin : null}
              pageUrl={pageUrl}
              onInquiry={startInquiry}
            />
          ) : view.name === "form" ? (
            <InquiryForm
              token={token}
              prefill={view.prefill}
              defaultEmail={email}
              pageUrl={pageUrl}
              emailEnabled={emailOn}
              attachmentsEnabled={attachOn}
              member={member}
              shopOrigin={embedded ? parentOrigin : null}
              onDone={(id, emailGiven) => {
                setView({ name: "submitted", conversationId: id, emailGiven });
                loadInquiries();
              }}
            />
          ) : view.name === "submitted" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="mb-2 grid size-12 place-items-center rounded-2xl bg-ok/15 text-ok-text edge">
                <Check className="size-5" strokeWidth={2} />
              </span>
              <p className="text-lg font-bold tracking-[-0.02em]">문의가 접수됐어요</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {view.emailGiven ? (
                  <>
                    {sla} 답변드릴게요.
                    <br />
                    쇼핑몰에서 확인하지 않으시면 남겨주신 이메일로도 알려드려요.
                  </>
                ) : (
                  <>
                    {sla} 답변드릴게요.
                    <br />
                    쇼핑몰에 다시 오시면 문의 목록에서 답변을 확인할 수 있고, 새 답변이 있으면 버튼에
                    표시돼요.
                  </>
                )}
              </p>
              {hours && !hours.open && (
                <p className="text-xs leading-relaxed break-keep text-ink-3">
                  지금은 운영 시간이 아니라 다음 영업일에 순서대로 답변드려요.
                  <br />
                  운영 시간 {hours.text}
                </p>
              )}
              <Button
                variant="outline"
                className="mt-3 h-10 w-full max-w-60 rounded-xl"
                onClick={() =>
                  setView({
                    name: "thread",
                    conversationId: view.conversationId,
                  })
                }
              >
                접수한 문의 보기
              </Button>
              <Button variant="ghost" className="h-10 text-muted-foreground" onClick={goHome}>
                처음으로
              </Button>
              {signupLinks && <SignupNote links={signupLinks} />}
            </div>
          ) : (
            <ThreadView
              key={view.conversationId}
              sla={sla}
              // 이메일을 남긴 고객에게만 "메일로도 알려드려요" 안내
              emailEnabled={emailOn && Boolean(email)}
              upload={threadUpload}
              close={async () => {
                await api(`/api/widget/inquiries/${view.conversationId}/close`, { method: "POST", token });
                loadInquiries();
              }}
              load={(after) =>
                api<{ status: string; messages: ChatMessage[] }>(
                  `/api/widget/inquiries/${view.conversationId}/messages?after=${after}`,
                  { token },
                )
              }
              send={async (m) =>
                (
                  await api<{ message: ChatMessage }>(`/api/widget/inquiries/${view.conversationId}/messages`, {
                    method: "POST",
                    token,
                    body: JSON.stringify(m),
                  })
                ).message
              }
            />
          )}
        </div>

        {token && onTab && (
          <nav className="relative grid shrink-0 grid-cols-2 border-t bg-card/80 px-6 pt-1.5 pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur-md">
            {/* 선택된 탭 위 경계선에 짧은 막대가 따라온다 */}
            <span
              aria-hidden
              className={cn(
                "absolute -top-px h-0.5 w-7 rounded-b-sm bg-foreground transition-[left] duration-300 ease-out",
                view.name === "home" ? "left-[calc(25%-2px)]" : "left-[calc(75%-26px)]",
              )}
            />
            <TabButton icon={House} solid={<SolidHouse />} label="홈" on={view.name === "home"} onClick={() => view.name !== "home" && setView({ name: "home" })} />
            <TabButton
              icon={MessageCircle}
              solid={<SolidChat />}
              label="대화"
              badge={newReplies}
              on={view.name === "chats"}
              onClick={() => {
                if (view.name === "chats") return;
                setView({ name: "chats" });
                loadInquiries();
              }}
            />
          </nav>
        )}
      </div>
    </PublicProfileProvider>
    </WidgetEnvContext.Provider>
  );
}

// 고객센터 운영 시간 (설정 → 영업 시간). 홈 맨 아래 작은 한 줄 — 운영 시간 밖이면 답변이 늦어지는 이유를 함께 알린다
function BusinessHoursNote({ hours }: { hours: { text: string; open: boolean } }) {
  return (
    <div className="mt-auto flex flex-col items-center gap-1 border-t pt-3 text-center text-[11px] leading-relaxed break-keep text-ink-3">
      <p className="flex items-start gap-1.5">
        <Clock className="mt-[2.5px] size-3 shrink-0" strokeWidth={1.75} />
        <span>
          운영 시간 <span className="num">{hours.text}</span>
        </span>
      </p>
      {!hours.open && (
        <p className="flex items-start gap-1.5 text-warn-text">
          <span className="mt-[6px] size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
          지금은 운영 시간 밖이에요 · 남긴 문의는 다음 영업일에 순서대로 답변드려요
        </p>
      )}
    </div>
  );
}

function HomeItem({
  icon: Icon,
  title,
  sub,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-panel-3"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel-3 text-muted-foreground edge">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <b className="block text-[13.5px] font-semibold">{title}</b>
        <small className="block truncate text-xs text-ink-3">{sub}</small>
      </span>
      <ChevronRight className="ml-auto size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

// 선택된 탭은 꽉 찬 아이콘 (집은 문을 비우고, 말풍선은 점 세 개)
function SolidHouse() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[22px]">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M13.3 2.5a2 2 0 0 0-2.6 0l-7 6A2 2 0 0 0 3 10v9a2 2 0 0 0 2 2h4.2v-7.2a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1V21H19a2 2 0 0 0 2-2v-9a2 2 0 0 0-.7-1.5z"
      />
    </svg>
  );
}
function SolidChat() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[22px]">
      <path fill="currentColor" d="M12 2.6a9.4 9.4 0 0 0-8.3 13.8L2.1 21a.7.7 0 0 0 .9.9l4.6-1.6A9.4 9.4 0 1 0 12 2.6z" />
      <circle cx="8" cy="12" r="1.15" className="fill-card" />
      <circle cx="12" cy="12" r="1.15" className="fill-card" />
      <circle cx="16" cy="12" r="1.15" className="fill-card" />
    </svg>
  );
}

function TabButton({
  icon: Icon,
  solid,
  label,
  on,
  badge = 0,
  onClick,
}: {
  icon: LucideIcon;
  solid: ReactNode;
  label: string;
  on: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={cn(
        "relative flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] transition-colors",
        on ? "font-semibold text-foreground" : "font-medium text-ink-3 hover:text-muted-foreground",
      )}
    >
      <span className="block transition-transform active:scale-90">{on ? solid : <Icon className="size-[22px]" strokeWidth={1.75} />}</span>
      {label}
      {badge > 0 && (
        <span
          className="num absolute top-0.5 left-[calc(50%+6px)] h-4 min-w-4 rounded-full bg-signal px-1 text-center text-[10px] leading-4 font-semibold text-signal-foreground ring-2 ring-card"
          aria-label={`새 답변 ${badge}`}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

// 대화 탭: 남긴 문의와 AI 대화를 최신순으로. 종료된 문의는 '지난 대화'로 아래에 (새 답변이 있으면 종료여도 위에)
function ChatList({
  inquiries,
  chats,
  onInquiry,
  onChat,
  onNew,
}: {
  inquiries: Inquiry[];
  chats: AiChatItem[] | null;
  onInquiry: (id: string) => void;
  onChat: (id: string) => void;
  onNew: () => void;
}) {
  type Row = { key: string; at: string; done: boolean; node: ReactNode };
  const rows: Row[] = [
    ...inquiries.map((q) => {
      const st = INQUIRY_STATUS[q.status];
      return {
        key: q.id,
        at: q.last_message_at,
        done: q.status === "resolved" && !q.has_new_reply,
        node: (
          <ChatRow
            avatar={<ProfileAvatar size="md" />}
            title={`${categoryOf(q.category ?? "etc").label} 문의`}
            chip={<Chip tone={st?.tone ?? "neutral"}>{st?.label ?? q.status}</Chip>}
            time={q.last_message_at}
            preview={q.last_message_preview}
            isNew={q.has_new_reply}
            onClick={() => onInquiry(q.id)}
          />
        ),
      };
    }),
    ...(chats ?? []).map((c) => ({
      key: c.id,
      at: c.last_turn_at,
      done: false,
      node: (
        <ChatRow
          avatar={
            <span className="grid size-[30px] place-items-center rounded-[10px] bg-signal-soft text-signal-text">
              <Sparkles className="size-4" strokeWidth={1.75} />
            </span>
          }
          title="AI 답변"
          time={c.last_turn_at}
          preview={c.preview}
          onClick={() => onChat(c.id)}
        />
      ),
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const active = rows.filter((r) => !r.done);
  const past = rows.filter((r) => r.done);

  return (
    <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pt-1 pb-4">
      {/* 처음엔 AI 대화까지 받은 뒤 한 번에 보여준다 (늦게 끼어든 줄 때문에 잘못 누르지 않게) */}
      {chats === null || rows.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-10 text-[13px] text-ink-3">
          {chats === null ? "불러오는 중…" : "아직 나눈 대화가 없어요"}
        </p>
      ) : (
        <>
          {active.map((r) => (
            <div key={r.key}>{r.node}</div>
          ))}
          {past.length > 0 && <h2 className="px-2.5 pt-3.5 pb-1 font-mono text-[11px] text-ink-3">지난 대화</h2>}
          {past.map((r) => (
            <div key={r.key} className="opacity-60">
              {r.node}
            </div>
          ))}
        </>
      )}
      <Button className="mx-2.5 mt-2 h-11 shrink-0 rounded-[14px]" onClick={onNew}>
        <Plus className="size-4" />새 문의 남기기
      </Button>
    </div>
  );
}

function ChatRow({
  avatar,
  title,
  chip,
  time,
  preview,
  isNew = false,
  onClick,
}: {
  avatar: ReactNode;
  title: string;
  chip?: ReactNode;
  time: string;
  preview: string | null;
  isNew?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-[14px] px-2.5 py-3 text-left transition-colors hover:bg-panel-3"
    >
      <span className="relative mt-0.5 shrink-0">
        {avatar}
        {isNew && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-signal ring-2 ring-card" aria-label="새 답변" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <b className="truncate text-[13.5px] font-semibold">{title}</b>
          {chip}
          <span className="num ml-auto shrink-0 text-[11px] text-ink-3">{formatTime(time)}</span>
        </span>
        <span className={cn("truncate text-[13px]", isNew ? "font-medium text-foreground" : "text-muted-foreground")}>
          {preview}
        </span>
      </span>
    </button>
  );
}
