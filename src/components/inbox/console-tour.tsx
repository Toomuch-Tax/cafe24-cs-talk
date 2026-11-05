"use client";

import { Compass, Inbox, Settings, Sparkles, X, type LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// 처음 로그인한 사람에게 한 번 뜨는 콘솔 둘러보기.
// 대상은 각 화면의 data-tour="..." 요소. 화면이 다른 단계는 그 메뉴로 이동한 뒤 대상을 찾는다.

const DONE_KEY = "cstalk_tour_done";

type Theme = "start" | "inbox" | "ai" | "set";
const THEMES: Record<Theme, { label: string; icon: LucideIcon }> = {
  start: { label: "시작", icon: Compass },
  inbox: { label: "상담", icon: Inbox },
  ai: { label: "AI", icon: Sparkles },
  set: { label: "설정", icon: Settings },
};

type Step = {
  theme: Theme;
  path: string;
  // 여러 개면 모두 감싸는 영역. 보이는 대상이 없으면 fallback, 그것도 없으면 가운데에 말풍선만
  targets: string[];
  fallback?: string[];
  // 문의 화면을 짚는 단계: 열린 문의가 없으면 상담 화면에 예시 문의(tour-demo.tsx)를 띄워 짚는다
  demo?: boolean;
  side: "right" | "left" | "top" | "bottom";
  // 대상 모서리 둥글기 (pill 은 높이의 절반)
  radius: number | "pill";
  title: string;
  body: React.ReactNode;
};

const STEPS: Step[] = [
  {
    theme: "start", path: "/inbox", targets: ["nav-menu"], side: "right", radius: "pill",
    title: "메뉴는 네 곳이면 충분해요",
    body: (
      <>
        <p>왼쪽 독에서 화면을 오가요. 아이콘에 마우스를 올리면 이름이 떠요.</p>
        <Items items={[["상담", "고객 문의에 답하는 곳"], ["AI 응대", "AI가 고객과 나눈 대화"], ["AI 응답 정책", "AI가 답할 때 보는 문서"], ["설정", "빠른 답변·영업 시간·쇼핑몰 연동"]]} />
      </>
    ),
  },
  {
    theme: "inbox", path: "/inbox", targets: ["list-tabs"], side: "right", radius: 16,
    title: "문의는 세 칸으로 나뉘어요",
    body: (
      <>
        <Items items={[["답변 필요", "고객이 기다리는 문의. 오래 기다린 순서로 위에 있어요"], ["응대 중", "답변을 보냈고 고객 차례인 문의"], ["종료", "끝난 문의"]]} />
        <p className="mt-2">위쪽 <b>내 담당만</b>을 켜면 내 문의만 보여요.</p>
      </>
    ),
  },
  {
    theme: "inbox", path: "/inbox", targets: ["list-search", "list-chips"], side: "right", radius: 14,
    title: "찾기와 걸러보기",
    body: (
      <>
        <p>이름·주문번호·휴대폰 뒷자리로 <b>전체 기간</b>에서 찾아요. 숫자는 4자리만 넣어도 돼요.</p>
        <p className="mt-1.5"><b>안 읽음</b>·<b>미배정</b> 칩으로 아직 아무도 안 본 문의만 골라 볼 수 있어요.</p>
      </>
    ),
  },
  {
    theme: "inbox", path: "/inbox", targets: ["conv-head"], demo: true, side: "bottom", radius: 16,
    title: "문의를 정리하는 버튼",
    body: (
      <>
        <p>문의를 열면 위쪽에서 <b>담당자</b>·<b>처리 유형</b>·<b>우선순위</b>를 정해요. 다 끝나면 <b>종료</b>.</p>
        <p className="mt-1.5">이름 옆 시간은 답변 기한(영업일 24시간)까지 남은 시간이에요.</p>
      </>
    ),
  },
  {
    theme: "inbox", path: "/inbox", targets: ["composer"], demo: true, side: "top", radius: 20,
    title: "답변은 여기서 써요",
    body: (
      <Items items={[["AI 초안", "정책 문서로 초안을 받아 다듬어서 보내요"], ["/", "키로 빠른 답변을 불러와요"], ["메모", "탭은 상담원끼리만 보여요. 고객에게 안 가요"]]} />
    ),
  },
  {
    theme: "inbox", path: "/inbox", targets: ["customer"], demo: true, side: "left", radius: 22,
    title: "고객·주문은 오른쪽에",
    body: (
      <>
        <p>문의를 열면 회원 정보와 <b>최근 3개월 주문</b>, 배송 상태가 오른쪽에 바로 보여요. 고객에게 다시 묻기 전에 먼저 확인해 보세요.</p>
        <p className="mt-1.5">비회원은 주문번호나 휴대폰으로 조회할 수 있어요.</p>
      </>
    ),
  },
  {
    theme: "ai", path: "/ai", targets: ["ai-list"], side: "right", radius: 22,
    title: "AI 응대 — 사람이 봐야 할 것",
    body: (
      <>
        <p>AI가 고객에게 바로 답한 대화가 모여요. 독의 <b>주황 숫자</b>는 사람이 봐야 할 건수예요.</p>
        <Items items={[["AI가 넘김", "문서에 없어서 AI가 답하지 않은 질문"], ["해결 안 됨", "고객이 답이 부족하다고 한 대화"]]} />
        <p className="mt-1.5">답변을 보내면 문의로 바뀌어 상담에서 이어져요.</p>
      </>
    ),
  },
  {
    theme: "ai", path: "/policies", targets: ["policy-topics"], side: "right", radius: 0,
    title: "AI는 여기 적힌 것만 답해요",
    body: (
      <>
        <p>주제마다 AI가 어떻게 쓸지 정해요.</p>
        <Items items={[["자동 응답", "고객에게 바로 답해요"], ["초안만", "고객에겐 문의 남기기로 안내하고, 상담원 AI 초안에만 써요"]]} />
        <p className="mt-1.5">답이 틀리면 여기 문장을 고치면 돼요. 바꾼 기록은 버전으로 남아요.</p>
      </>
    ),
  },
  {
    theme: "ai", path: "/policies", targets: ["policy-products"], side: "right", radius: 10,
    title: "상품마다 따로 알려줄 것",
    body: (
      <>
        <p>소재·세탁·핏, 예약 출고일처럼 <b>그 상품에만 해당하는 안내</b>는 상품별 정책으로 적어 두세요. 고객이 그 상품 페이지에서 물을 때만 AI가 참고해요.</p>
        <Items items={[["상품 찾기", "상품 주소·번호·영문 상품명으로 찾고 사진을 보고 골라요"], ["테스트", "오른쪽 테스트에 그 상품 주소가 미리 채워져요"]]} />
      </>
    ),
  },
  {
    theme: "set", path: "/settings", targets: ["settings-menu"], side: "right", radius: 14,
    title: "자주 쓰는 설정 세 가지",
    body: (
      <Items items={[["빠른 답변", "자주 쓰는 답을 /단축어로 저장"], ["영업 시간", "답변 기한 계산과 고객 안내에 쓰여요"], ["Cafe24 연동", "쇼핑몰 연결과 위젯 설치"]]} />
    ),
  },
  {
    theme: "set", path: "/inbox", targets: ["nav-shop", "nav-me"], fallback: ["nav-me"], side: "right", radius: "pill",
    title: "준비 끝! 고객 화면도 미리 보세요",
    body: (
      <>
        <p><b>가게 아이콘</b>을 누르면 테스트 쇼핑몰이 새 창으로 열려요. 고객이 보는 위젯을 직접 써 볼 수 있어요.</p>
        <p className="mt-1.5">이 가이드는 <b>설정 → 내 프로필</b>에서 언제든 다시 볼 수 있어요.</p>
      </>
    ),
  },
];

function Items({ items }: { items: [string, string][] }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px]">
      {items.map(([k, v]) => (
        <li key={k} className="flex gap-2 leading-normal">
          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-signal" />
          <span>
            <b className="font-semibold text-foreground">{k}</b> {v}
          </span>
        </li>
      ))}
    </ul>
  );
}

const doneKey = (agentId: string) => `${DONE_KEY}:${agentId}`;

export function tourSeen(agentId: string) {
  try {
    return localStorage.getItem(doneKey(agentId)) === "1";
  } catch {
    // 저장소를 못 쓰면 매번 띄우지 않는다
    return true;
  }
}

// inside: 대상 대신 fallback 영역을 짚는 중 → 말풍선을 그 안 가운데에
type Rect = { x: number; y: number; w: number; h: number; r: number; inside?: boolean };

const PAD = 6;
const TIP_W = 320;
const GAP = 16;
const MARGIN = 16;

function findRect(keys: string[], radius: Step["radius"]): Rect | null {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const k of keys) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${k}"]`)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top);
      x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
  }
  if (x1 === Infinity) return null;
  // 화면 밖으로 나가지 않게 (스크롤 영역 안 요소)
  x1 = Math.max(x1 - PAD, 2); y1 = Math.max(y1 - PAD, 2);
  x2 = Math.min(x2 + PAD, window.innerWidth - 2); y2 = Math.min(y2 + PAD, window.innerHeight - 2);
  const w = x2 - x1, h = y2 - y1;
  const r = radius === "pill" ? Math.min(w, h) / 2 : radius ? radius + PAD : 8;
  return { x: x1, y: y1, w, h, r: Math.min(r, w / 2, h / 2) };
}

// 바깥 사각형 + 둥근 구멍 (evenodd). 명령 순서가 늘 같아서 단계 사이에 부드럽게 바뀐다
function holePath(vw: number, vh: number, { x, y, w, h, r }: Rect) {
  return `path(evenodd, "M0 0H${vw}V${vh}H0Z M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z")`;
}

export function ConsoleTour({
  agentId,
  onDemo,
  onClose,
}: {
  agentId: string;
  onDemo: (on: boolean) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [tipPos, setTipPos] = useState<{ x: number; y: number; arrow: number } | null>(null);
  // 단계를 넘길 때 글자만 잠깐 흐렸다가 바꾼다
  const [swapping, setSwapping] = useState(false);
  // 처음 자리 잡을 때는 미끄러지지 않고 그 자리에 나타난다 (그 뒤 단계부터 미끄러짐)
  const placed = tipPos !== null;
  const [gliding, setGliding] = useState(false);
  useEffect(() => {
    if (!placed) return;
    const t = setTimeout(() => setGliding(true), 50);
    return () => clearTimeout(t);
  }, [placed]);
  const tipRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const finish = useCallback(() => {
    try {
      localStorage.setItem(doneKey(agentId), "1");
    } catch {}
    onClose();
  }, [agentId, onClose]);

  const go = useCallback(
    (i: number) => {
      if (i < 0) return;
      if (i >= STEPS.length) return finish();
      setSwapping(true);
      setTimeout(() => {
        setIndex(i);
        setSwapping(false);
      }, 120);
    },
    [finish],
  );

  const demo = Boolean(step.demo);
  useEffect(() => onDemo(demo), [demo, onDemo]);
  useEffect(() => () => onDemo(false), [onDemo]);

  // 단계 화면으로 이동
  useEffect(() => {
    if (!pathname.startsWith(step.path)) router.push(step.path);
  }, [step.path, pathname, router]);

  // 대상 찾기: 화면이 바뀌는 중이면 나타날 때까지 잠깐 기다리고, 크기가 바뀌면 따라간다
  useEffect(() => {
    let stopped = false;
    let raf = 0;
    const started = performance.now();
    const measure = () => {
      setView({ w: window.innerWidth, h: window.innerHeight });
      const waited = performance.now() - started;
      const fb = step.fallback && waited > 800 ? findRect(step.fallback, 22) : null;
      const r = findRect(step.targets, step.radius) ?? (fb && { ...fb, inside: true });
      return { r, waited };
    };
    const poll = () => {
      if (stopped) return;
      const { r, waited } = measure();
      if (r || waited > 2500) {
        setRect(r);
        return;
      }
      raf = requestAnimationFrame(poll);
    };
    poll();
    const onResize = () => setRect(measure().r);
    window.addEventListener("resize", onResize);
    // 목록이 불러와지며 자리가 바뀌는 경우
    const timer = setInterval(() => {
      if (stopped) return;
      setRect((prev) => {
        const r = measure().r;
        if (!prev || !r) return r ?? prev;
        const same = prev.inside === r.inside && Math.abs(prev.x - r.x) < 1 && Math.abs(prev.y - r.y) < 1 && Math.abs(prev.w - r.w) < 1 && Math.abs(prev.h - r.h) < 1;
        return same ? prev : r;
      });
    }, 400);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearInterval(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [step]);

  // 말풍선 위치: 대상 옆에 붙이고 화면 밖으로 나가지 않게, 화살표는 대상 쪽으로
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !view.w) return;
    const th = tip.offsetHeight;
    const clampX = (v: number) => Math.max(MARGIN, Math.min(view.w - TIP_W - MARGIN, v));
    const clampY = (v: number) => Math.max(MARGIN, Math.min(view.h - th - MARGIN, v));
    if (!rect) {
      setTipPos({ x: (view.w - TIP_W) / 2, y: (view.h - th) / 2, arrow: -1 });
      return;
    }
    const { x, y, w, h } = rect;
    let tx: number, ty: number, arrow: number;
    if (rect.inside) {
      tx = clampX(x + w / 2 - TIP_W / 2);
      ty = clampY(y + h / 2 - th / 2);
      arrow = -1;
    } else if (step.side === "right" || step.side === "left") {
      tx = clampX(step.side === "right" ? x + w + GAP : x - GAP - TIP_W);
      // 키 큰 대상은 위쪽에 맞추고, 작은 대상은 가운데에
      ty = clampY(h > 320 ? y + 24 : y + h / 2 - th / 2);
      const cy = h > 320 ? y + 48 : y + h / 2;
      arrow = Math.max(18, Math.min(th - 30, cy - ty - 7));
    } else {
      tx = clampX(x + w / 2 - TIP_W / 2);
      ty = clampY(step.side === "bottom" ? y + h + GAP : y - GAP - th);
      arrow = Math.max(18, Math.min(TIP_W - 32, x + w / 2 - tx - 7));
    }
    setTipPos({ x: tx, y: ty, arrow });
  }, [rect, view, step, index]);

  useEffect(() => {
    if (!swapping) nextRef.current?.focus({ preventScroll: true });
  }, [index, swapping]);

  // 가이드 중에는 화면 단축키가 동작하지 않게 먼저 받는다 (Tab·Enter·Space 는 말풍선 버튼용으로 둔다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["Tab", "Enter", " "].includes(e.key)) return;
      e.stopPropagation();
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "Escape") finish();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, finish, index]);

  const theme = THEMES[step.theme];
  const ThemeIcon = theme.icon;
  const groups = (Object.keys(THEMES) as Theme[]).map((t) => STEPS.map((s, i) => (s.theme === t ? i : -1)).filter((i) => i >= 0));
  const side = rect && !rect.inside ? step.side : null;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="콘솔 둘러보기">
      {/* 뒤 화면 클릭 막기 (구멍 안도 막는다 — 가이드 중 실수로 보내기 등을 누르지 않게) */}
      <div className="absolute inset-0" />
      <div
        className="tour-veil absolute inset-0 animate-in fade-in duration-300"
        style={{ clipPath: rect && view.w ? holePath(view.w, view.h, rect) : undefined }}
      />
      {rect && (
        <div
          aria-hidden
          className="tour-ring pointer-events-none absolute"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: rect.r }}
        />
      )}
      <div
        ref={tipRef}
        aria-live="polite"
        style={{ left: tipPos?.x ?? -9999, top: tipPos?.y ?? 0, width: TIP_W }}
        className={cn(
          "absolute rounded-[20px] bg-popover px-[18px] pt-4 pb-3.5 text-foreground float edge",
          gliding && "tour-move",
          !tipPos && "invisible",
        )}
      >
        {side && tipPos && tipPos.arrow >= 0 && (
          <span
            aria-hidden
            className={cn(
              "absolute size-3.5 rotate-45 rounded-[3px] bg-popover",
              gliding && "tour-move",
              side === "right" && "-left-1.5",
              side === "left" && "-right-1.5",
              side === "bottom" && "-top-1.5",
              side === "top" && "-bottom-1.5",
            )}
            style={side === "right" || side === "left" ? { top: tipPos.arrow } : { left: tipPos.arrow }}
          />
        )}
        <div className={cn("relative transition-[opacity,filter] duration-150", swapping && "opacity-0 blur-[3px]")}>
          <div className="mb-2 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                step.theme === "ai" ? "ai-grad text-white" : "bg-signal-soft text-signal-text",
              )}
            >
              <ThemeIcon className="size-3" strokeWidth={2} />
              {theme.label}
            </span>
            <span className="num text-[11.5px] text-ink-3">
              {index + 1} / {STEPS.length}
            </span>
            <button
              type="button"
              aria-label="가이드 닫기"
              onClick={finish}
              className="ml-auto grid size-[26px] place-items-center rounded-full text-ink-3 transition-colors hover:bg-panel-3 hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </div>
          <h2 className="mb-1.5 text-[15.5px] font-bold tracking-[-0.02em]">{step.title}</h2>
          <div className="text-[13px] leading-[1.65] text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
            {step.body}
          </div>
          <div className="mt-3.5 flex items-center gap-2">
            <span className="flex items-center gap-1.5" aria-hidden>
              {groups.map((g, gi) => (
                <span key={gi} className="flex gap-[3px]">
                  {g.map((i) => (
                    <i
                      key={i}
                      className={cn(
                        "h-1.5 rounded-full transition-[width,background-color] duration-300",
                        i === index ? "w-4 bg-signal" : i < index ? "w-1.5 bg-signal/40" : "w-1.5 bg-panel-3 edge",
                      )}
                    />
                  ))}
                </span>
              ))}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => (index ? go(index - 1) : finish())}
              className="h-8 rounded-[10px] px-3 text-[12.5px] font-semibold text-ink-3 transition-colors hover:bg-panel-3 hover:text-foreground"
            >
              {index ? "이전" : "건너뛰기"}
            </button>
            <button
              ref={nextRef}
              type="button"
              onClick={() => go(index + 1)}
              className="h-8 rounded-[10px] bg-foreground px-3.5 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              {last ? "시작하기" : "다음"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
