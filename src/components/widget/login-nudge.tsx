"use client";

import { Check, Lock, Package } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { trackEvent } from "@/lib/client/track";
import { cn } from "@/lib/utils";
import { categoryOf } from "./inquiry-fields";
import type { InquiryPrefill } from "./order-status";

// 비회원에게 로그인·회원가입 권하기.
// 막지 않는다 — 비회원 경로는 그대로 두고, 회원이 실제로 얻는 것만 말한다.
// 쇼핑몰 로그인·가입 화면으로 나가기 직전 widget.js 에 이어갈 화면(cstalk:resume)을 맡기면,
// 돌아온 쇼핑몰 페이지에서 위젯이 다시 열린다. 회원 정보는 그때 위젯 세션이 Cafe24 회원 토큰으로 다시 확인한다.

export type NudgeSpot = "inquiry" | "orders" | "orders_gate" | "submitted";
// 다시 열 때 이어갈 화면. 사진(File)은 넘길 수 없어 빠진다.
export type Resume =
  | { view: "form"; prefill: Pick<InquiryPrefill, "category" | "orderRef" | "body" | "fields" | "fromAi"> }
  | { view: "orders" }
  | { view: "chats" };

const GUEST_KEY = "cstalk_guest_ok"; // '비회원으로 남기기'·'주문번호로 조회하기'를 고른 기기는 다시 묻지 않는다

export const guestChosen = () => {
  try {
    return localStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
};
export const rememberGuest = () => {
  try {
    localStorage.setItem(GUEST_KEY, "1");
  } catch {}
};

// 주문을 찾아야 하는 유형이거나 아직 유형을 모를 때만 묻는다 (재입고·사이즈는 회원이어도 얻는 게 작다)
export const loginWorthAsking = (category: string) => category === "etc" || categoryOf(category).needsOrder;

// 테스트 스킨(/skin-skinNN/)에서 열었으면 로그인·가입 화면도 같은 스킨으로 연다
function shopPaths(shopOrigin: string, pageUrl: string | null) {
  let path = "/";
  let search = "";
  try {
    const u = new URL(pageUrl ?? "");
    path = u.pathname;
    search = u.search;
  } catch {}
  const skin = path.match(/^\/skin-skin\d+/)?.[0] ?? "";
  return {
    login: `${shopOrigin}${skin}/member/login.html?returnUrl=${encodeURIComponent(path + search)}`,
    signup: `${shopOrigin}${skin}/member/agreement.html`,
  };
}

export function shopLinks(shopOrigin: string | null, pageUrl: string | null) {
  if (!shopOrigin) return null;
  const paths = shopPaths(shopOrigin, pageUrl);
  // 링크를 누르는 순간: 이어갈 화면을 쇼핑몰 쪽에 맡기고 기록한 뒤, 링크(target=_top)가 쇼핑몰 화면을 바꾼다
  const leave = (at: NudgeSpot, action: "login" | "signup", resume: Resume) => {
    window.parent.postMessage({ type: "cstalk:resume", resume }, shopOrigin);
    trackEvent({ name: "login_nudge_click", props: { at, action } }, { now: true });
  };
  return { ...paths, leave };
}

// 위젯 세션이 받은 resume 이 올바른 모양일 때만 쓴다 (쇼핑몰 페이지가 보낸 값이라 그대로 믿지 않는다)
export function parseResume(v: unknown): Resume | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (r.view === "orders" || r.view === "chats") return { view: r.view };
  if (r.view !== "form" || !r.prefill || typeof r.prefill !== "object") return null;
  const p = r.prefill as Record<string, unknown>;
  const str = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.slice(0, max) : undefined);
  const category = str(p.category, 40) ?? "etc";
  const fields =
    p.fields && typeof p.fields === "object"
      ? Object.fromEntries(
          Object.entries(p.fields as Record<string, unknown>)
            .filter((e): e is [string, string] => typeof e[1] === "string")
            .slice(0, 10)
            .map(([k, val]) => [k.slice(0, 40), val.slice(0, 500)]),
        )
      : undefined;
  const ai = p.fromAi && typeof p.fromAi === "object" ? (p.fromAi as Record<string, unknown>) : null;
  const question = ai ? str(ai.question, 3000) : undefined;
  return {
    view: "form",
    prefill: {
      category,
      orderRef: str(p.orderRef, 40),
      body: str(p.body, 3000),
      fields,
      fromAi: question
        ? { question, answer: str(ai?.answer, 3000) ?? null, answerId: str(ai?.answerId, 64) ?? null }
        : undefined,
    },
  };
}

const rise = "animate-in fade-in slide-in-from-bottom-1.5 fill-mode-both duration-300 ease-out";

// A. 문의 남기기 직전: 로그인하고 남기기 / 비회원으로 남기기
export function LoginChoice({
  links,
  prefill,
  onGuest,
}: {
  links: NonNullable<ReturnType<typeof shopLinks>>;
  prefill: InquiryPrefill;
  onGuest: () => void;
}) {
  const resume: Resume = {
    view: "form",
    prefill: { category: prefill.category, orderRef: prefill.orderRef, body: prefill.body, fields: prefill.fields, fromAi: prefill.fromAi },
  };
  return (
    <div className="flex flex-col gap-2">
      <p className={cn("max-w-[82%] self-start rounded-2xl rounded-bl-md bg-raised px-3.5 py-2.5 text-[13.5px] leading-relaxed edge", rise)}>
        어떻게 남기실까요?
      </p>
      <div className="flex w-[92%] flex-col gap-2 self-end">
        <a
          href={links.login}
          target="_top"
          onClick={() => links.leave("inquiry", "login", resume)}
          className={cn(
            "rounded-2xl bg-raised px-3.5 py-3 outline-2 outline-signal/30 edge transition-transform active:scale-[0.98]",
            rise,
          )}
          style={{ animationDelay: "140ms" }}
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            로그인하고 남기기
            <em className="rounded-full bg-signal-soft px-1.5 py-px text-[10.5px] font-semibold text-signal-text not-italic">추천</em>
          </span>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-xs leading-relaxed text-muted-foreground">
            {["주문 목록에서 바로 골라요 (주문번호 없이)", "이름·연락처를 적지 않아도 돼요", "휴대폰·PC 어디서든 답변을 확인해요"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="size-3 shrink-0 text-ok-text" strokeWidth={2.5} />
                {t}
              </li>
            ))}
          </ul>
        </a>
        <button
          type="button"
          onClick={() => {
            rememberGuest();
            trackEvent({ name: "login_nudge_click", props: { at: "inquiry", action: "guest" } });
            onGuest();
          }}
          className={cn("rounded-2xl bg-raised px-3.5 py-2.5 text-left edge transition-transform active:scale-[0.98]", rise)}
          style={{ animationDelay: "200ms" }}
        >
          <span className="block text-[13.5px] font-medium">비회원으로 남기기</span>
          <span className="block text-xs text-ink-3">이 기기에서만 답변을 확인할 수 있어요</span>
        </button>
      </div>
      <p className={cn("self-end text-xs text-ink-3", rise)} style={{ animationDelay: "260ms" }}>
        아직 회원이 아니신가요?{" "}
        <a
          href={links.signup}
          target="_top"
          onClick={() => links.leave("inquiry", "signup", resume)}
          className="font-semibold text-signal-text underline-offset-2 hover:underline"
        >
          회원가입
        </a>
      </p>
    </div>
  );
}

// B. 비회원 주문 조회 위: 로그인하고 바로 확인
export function OrdersLoginCard({ links }: { links: NonNullable<ReturnType<typeof shopLinks>> }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-raised p-3.5 edge">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal-soft text-signal-text">
          <Package className="size-[18px]" strokeWidth={1.75} />
        </span>
        <span className="min-w-0">
          <b className="block text-sm font-semibold">로그인하고 바로 확인</b>
          <small className="block text-xs text-ink-3">최근 3개월 주문이 한 번에 보여요</small>
        </span>
      </div>
      <a
        href={links.login}
        target="_top"
        onClick={() => links.leave("orders", "login", { view: "orders" })}
        className="grid h-10 place-items-center rounded-xl bg-foreground text-[13.5px] font-semibold text-background transition-transform active:scale-[0.98]"
      >
        로그인
      </a>
      <p className="text-center text-xs text-ink-3">
        처음이신가요?{" "}
        <a
          href={links.signup}
          target="_top"
          onClick={() => links.leave("orders", "signup", { view: "orders" })}
          className="font-semibold text-signal-text underline-offset-2 hover:underline"
        >
          회원가입
        </a>
      </p>
    </div>
  );
}

// C-1. 주문·배송 조회에 들어오면 먼저: 로그인하면 보일 주문 목록을 흐리게 미리 보여준다.
// 흐린 목록은 모양만 — 비회원의 주문 정보는 불러오지 않는다. 카카오 가입은 쇼핑몰 로그인 화면의 "카카오로 시작하기"로 이어진다.
const PREVIEW = [
  { w: "w-30", status: "배송 중", tone: "signal" },
  { w: "w-24", status: "상품 준비 중", tone: "warn" },
  { w: "w-33", status: "배송 완료", tone: "ok" },
] as const;

export function OrdersGate({ links, onGuest }: { links: NonNullable<ReturnType<typeof shopLinks>>; onGuest: () => void }) {
  const motion = "motion-reduce:animate-none";
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-[18px] pt-[18px] pb-3.5">
      <div className={cn(rise, motion)} style={{ animationDelay: "60ms" }}>
        <h3 className="text-[23px] leading-[1.3] font-bold tracking-[-0.035em]">
          로그인하면
          <br />내 주문이 바로 보여요
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">주문번호를 찾으러 문자함을 뒤지지 않아도 돼요.</p>
      </div>
      <div
        aria-hidden
        className={cn("relative mt-4 flex flex-col gap-2 overflow-hidden rounded-[18px] bg-raised p-3 edge", rise, motion)}
        style={{ animationDelay: "140ms" }}
      >
        {PREVIEW.map((o, i) => (
          <div
            key={o.status}
            className={cn(
              "flex items-center gap-2.5 rounded-xl bg-card p-2 ring-1 ring-border animate-in fade-in slide-in-from-left-3 fill-mode-both duration-700 ease-out",
              motion,
            )}
            style={{ animationDelay: `${260 + i * 80}ms` }}
          >
            <span className="size-10 shrink-0 rounded-[10px] bg-linear-135 from-panel-3 to-ink-3/30" />
            <span className="flex flex-col gap-[7px]">
              <span className={cn("h-[9px] rounded-full bg-ink-3/35", o.w)} />
              <span className="h-[7px] w-20 rounded-full bg-ink-3/20" />
            </span>
            <Chip tone={o.tone} className="ml-auto">
              {o.status}
            </Chip>
          </div>
        ))}
        <div className="absolute inset-0 grid place-items-center bg-background/35 backdrop-blur-[3px]">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background float animate-in fade-in zoom-in-90 fill-mode-both duration-500 ease-out",
              motion,
            )}
            style={{ animationDelay: "700ms" }}
          >
            <Lock className="size-3" strokeWidth={2.5} />
            로그인하면 보여요
          </span>
        </div>
      </div>
      <ul className={cn("mt-3.5 flex flex-col gap-[9px]", rise, motion)} style={{ animationDelay: "420ms" }}>
        {[
          ["최근 3개월 주문·배송 상태를 한 번에", "송장 번호·반품 진행까지"],
          ["문의할 땐 주문을 골라서 바로", "이름·연락처 입력 없이"],
        ].map(([t, s]) => (
          <li key={t} className="flex items-start gap-2.5 text-[13px] leading-normal">
            <span className="grid size-[22px] shrink-0 place-items-center rounded-[7px] bg-signal-soft text-signal-text">
              <Check className="size-3" strokeWidth={2.75} />
            </span>
            <span>
              {t}
              <small className="block text-[11.5px] text-ink-3">{s}</small>
            </span>
          </li>
        ))}
      </ul>
      <div className={cn("mt-auto flex flex-col gap-2 pt-3.5", rise, motion)} style={{ animationDelay: "520ms" }}>
        <a
          href={links.login}
          target="_top"
          onClick={() => links.leave("orders_gate", "login", { view: "orders" })}
          className="grid h-[46px] place-items-center rounded-[14px] bg-foreground text-[14.5px] font-semibold text-background transition-transform active:scale-[0.98]"
        >
          로그인
        </a>
        <a
          href={links.login}
          target="_top"
          onClick={() => links.leave("orders_gate", "signup", { view: "orders" })}
          className="grid h-[46px] place-items-center rounded-[14px] bg-kakao text-[14.5px] font-semibold text-kakao-foreground transition-transform active:scale-[0.98]"
        >
          카카오로 간편 가입
        </a>
        <p className="pt-1.5 pb-0.5 text-center text-[12.5px] text-ink-3">
          비회원이신가요?{" "}
          <button
            type="button"
            onClick={() => {
              rememberGuest();
              trackEvent({ name: "login_nudge_click", props: { at: "orders_gate", action: "guest" } });
              onGuest();
            }}
            className="text-muted-foreground underline underline-offset-3"
          >
            주문번호로 조회하기
          </button>
        </p>
      </div>
    </div>
  );
}

// D. 접수 완료: 회원가입하면 방금 남긴 문의가 회원 계정으로 이어진다.
// 로그인은 권하지 않는다 — 이미 회원 기록이 있는 분은 그쪽이 우선이라 방금 남긴 비회원 문의가 목록에서 빠진다 (api/widget/session).
export function SignupNote({ links }: { links: NonNullable<ReturnType<typeof shopLinks>> }) {
  return (
    <div className={cn("mt-3 w-full rounded-2xl bg-panel-2 px-3.5 py-3 text-left text-[12.5px] leading-relaxed text-muted-foreground ring-1 ring-border", rise)} style={{ animationDelay: "300ms" }}>
      <b className="mb-0.5 block text-[13px] text-foreground">다른 기기에서도 답변을 보려면</b>
      지금 회원가입하면 이 문의가 회원 계정으로 이어져, 휴대폰·PC 어디서든 확인할 수 있어요.
      <a
        href={links.signup}
        target="_top"
        onClick={() => links.leave("submitted", "signup", { view: "chats" })}
        className="mt-2 block font-semibold text-signal-text underline-offset-2 hover:underline"
      >
        회원가입
      </a>
    </div>
  );
}
