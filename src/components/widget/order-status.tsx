"use client";

import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useFeature } from "./env";
import { guestChosen, OrdersGate, OrdersLoginCard, shopLinks } from "./login-nudge";

export type CustomerOrderItem = {
  name: string;
  option: string | null;
  quantity: number;
  status: string;
  guide: string;
  trackingUrl: string | null;
  shippingCompany: string | null;
  trackingNo: string | null;
  action: "cancel_in_mypage" | "inquiry_return" | "inquiry_not_received" | null;
};
export type CustomerOrder = {
  orderId: string;
  orderDate: string;
  items: CustomerOrderItem[];
};

export type InquiryPrefill = {
  category: string;
  orderRef?: string;
  body?: string;
  // 유형별 칸 미리 채우기 (예: 보고 있던 상품 → item)
  fields?: Record<string, string>;
  // AI 답변 화면에서 넘어온 경우: 질문·답변을 문의 화면 위에 그대로 이어 보여주고 본문에 함께 남긴다
  fromAi?: { question: string; answer: string | null; answerId?: string | null };
  // AI 대화에서 고른 사진 (문의 폼의 사진 단계에 미리 담아 둔다)
  photos?: File[];
};

function OrderCard({
  order,
  shopOrigin,
  onInquiry,
}: {
  order: CustomerOrder;
  shopOrigin: string | null;
  onInquiry: (p: InquiryPrefill) => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-raised p-3.5 edge">
      <div className="flex items-center text-[11px] text-ink-3">
        <span className="font-mono">{order.orderId}</span>
        <span className="num ml-auto">{order.orderDate}</span>
      </div>
      <ul className="flex flex-col gap-4">
        {order.items.map((i, idx) => (
          <li key={idx} className="flex flex-col gap-1.5">
            <Chip tone={statusTone(i.status)} className="w-fit">
              <span className="size-1.5 rounded-full bg-current" />
              {i.status}
            </Chip>
            <p className="text-sm leading-snug font-semibold">
              {i.name}
              {i.option && <span className="font-normal text-muted-foreground"> · {i.option}</span>}
              {i.quantity > 1 && <span className="num font-normal text-muted-foreground"> ×{i.quantity}</span>}
            </p>
            {i.guide && <p className="text-xs leading-relaxed text-muted-foreground">{i.guide}</p>}
            {i.trackingNo && (
              <a
                href={i.trackingUrl ?? "#"}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(buttonVariants(), "mt-1 h-10 w-full rounded-xl")}
              >
                배송 조회
                <span className="font-mono text-xs opacity-60">
                  {i.shippingCompany} {i.trackingNo}
                </span>
              </a>
            )}
            {i.action === "cancel_in_mypage" && shopOrigin && (
              <a
                href={`${shopOrigin}/myshop/order/list.html`}
                target="_top"
                className="w-fit text-xs text-signal-text underline-offset-2 hover:underline"
              >
                마이페이지 주문조회에서 직접 취소할 수 있어요
              </a>
            )}
            {(i.action === "inquiry_return" || i.action === "inquiry_not_received") && (
              <Button
                variant="outline"
                className="mt-1 h-10 w-full rounded-xl"
                onClick={() =>
                  onInquiry({
                    category: i.action === "inquiry_return" ? "return" : "shipping",
                    orderRef: order.orderId,
                    body:
                      i.action === "inquiry_return"
                        ? `반품 접수 부탁드려요. (${i.name})`
                        : `배송완료로 나오는데 상품을 받지 못했어요. (${i.name})`,
                  })
                }
              >
                {i.action === "inquiry_return" ? "반품 접수 요청하기" : "받지 못했어요"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <button
        className="border-t pt-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => onInquiry({ category: "shipping", orderRef: order.orderId })}
      >
        이 주문으로 문의 남기기
      </button>
    </li>
  );
}

export const statusTone = (status: string) =>
  /배송완료|구매확정/.test(status)
    ? "ok"
    : /배송중|배송 중|출고/.test(status)
      ? "signal"
      : /취소|반품|교환/.test(status)
        ? "warn"
        : "neutral";

export function OrderStatus({
  token,
  member,
  shopOrigin,
  pageUrl,
  onInquiry,
}: {
  token: string;
  member: boolean;
  shopOrigin: string | null;
  pageUrl: string | null;
  onInquiry: (p: InquiryPrefill) => void;
}) {
  // 비회원: 들어오자마자 로그인 권유 전체 화면(C-1, 테스트 스킨), 비회원으로 계속하면 주문번호 조회 위에 로그인 카드(B)
  const links = shopLinks(shopOrigin, pageUrl);
  const nudge = useFeature("loginNudge") && !member && links !== null;
  const gateOn = useFeature("ordersGate");
  const [gate, setGate] = useState(() => gateOn && nudge && !guestChosen());
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  // 주문번호로 찾은 비회원 주문 (회원도 가입 전 비회원 주문을 로그아웃 없이 찾을 수 있게 회원 목록과 따로 둔다)
  const [found, setFound] = useState<CustomerOrder | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!member) return;
    api<{ orders: CustomerOrder[] }>("/api/widget/orders", { token })
      .then((r) => setOrders(r.orders))
      .catch(() => setError("주문을 불러오지 못했어요. 잠시 후 다시 시도해주세요."));
  }, [member, token]);

  const lookup = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: CustomerOrder | null }>("/api/widget/orders/lookup", {
        method: "POST",
        token,
        body: JSON.stringify({ orderId: orderId.trim(), name: name.trim() }),
      });
      setFound(r.order);
      if (!r.order) setError("일치하는 주문을 찾지 못했어요. 주문번호와 주문자 이름을 확인해주세요.");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "조회를 너무 많이 시도했어요. 10분 뒤에 다시 시도해주세요."
          : err instanceof ApiError && err.code === "invalid_body"
            ? "주문번호는 20261017-0000123 형식이에요."
            : "조회하지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setBusy(false);
    }
  };

  // 비회원 주문 조회 칸. 회원에게는 가입 전 비회원 주문용으로 보여준다
  const lookupForm = (head: React.ReactNode, hint: string, className?: string) => (
    <form
      className={cn("flex flex-col gap-2.5 rounded-2xl bg-raised p-4 edge", className)}
      onSubmit={(e) => {
        e.preventDefault();
        lookup();
      }}
    >
      {head}
      <Input
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
        placeholder="주문번호 (예: 20261017-0000123)"
        inputMode="numeric"
        aria-label="주문번호"
        className="h-10 rounded-xl font-mono"
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="주문자 이름"
        aria-label="주문자 이름"
        className="h-10 rounded-xl"
      />
      <Button type="submit" className="mt-1 h-10 rounded-xl" disabled={busy || !orderId.trim() || !name.trim()}>
        {busy ? "조회 중…" : "조회하기"}
      </Button>
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </form>
  );
  const rise = "animate-in fade-in slide-in-from-bottom-1.5 fill-mode-both duration-300 ease-out";
  const memberEmpty = member && orders !== null && orders.length === 0;

  if (gate && links) return <OrdersGate links={links} onGuest={() => setGate(false)} />;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pt-4 pb-5">
      {nudge && links && (
        <>
          <OrdersLoginCard links={links} />
          <p className="flex items-center gap-2.5 text-[11px] text-ink-3 before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
            또는 주문번호로 조회
          </p>
        </>
      )}
      {!member &&
        (nudge
          ? lookupForm(null, "주문번호는 주문 완료 문자·메일에 있어요.")
          : lookupForm(
              <>
                <p className="text-[15px] font-bold tracking-[-0.015em]">비회원 주문 조회</p>
                <p className="mb-1 text-xs leading-relaxed text-muted-foreground">
                  로그인하시면 주문번호 없이 바로 확인할 수 있어요. 주문번호는 주문 완료 문자·메일에 있어요.
                </p>
              </>,
              "",
            ))}
      {member && <p className="px-1 font-mono text-[11px] text-ink-3">최근 3개월 주문</p>}
      {member && orders === null && !error && <p className="px-1 text-xs text-ink-3">불러오는 중…</p>}
      {memberEmpty && <p className="px-1 text-sm text-muted-foreground">회원으로 주문한 내역이 없어요.</p>}
      {orders && orders.length > 0 && (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => (
            <OrderCard key={o.orderId} order={o} shopOrigin={shopOrigin} onInquiry={onInquiry} />
          ))}
        </ul>
      )}

      {/* 회원: 가입 전에 비회원으로 한 주문은 회원 목록에 없다. 로그아웃하지 않고 주문번호로 찾게 한다 */}
      {memberEmpty &&
        lookupForm(
          <>
            <p className="text-[15px] font-bold tracking-[-0.015em]">비회원으로 주문하셨나요?</p>
            <p className="mb-1 text-xs leading-relaxed text-muted-foreground">
              가입 전에 한 주문은 회원 목록에 보이지 않아요. 주문번호로 찾아드릴게요.
            </p>
          </>,
          "주문번호는 주문 완료 문자·메일에 있어요.",
          rise,
        )}
      {member && orders && orders.length > 0 && (
        <>
          <button
            className="py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setLookupOpen((v) => !v)}
          >
            {lookupOpen ? (
              <>
                비회원 주문 조회 <b className="font-semibold text-signal-text">닫기</b>
              </>
            ) : (
              <>
                비회원으로 주문하셨나요? <b className="font-semibold text-signal-text">주문번호로 조회</b>
              </>
            )}
          </button>
          {lookupOpen && lookupForm(null, "주문번호는 주문 완료 문자·메일에 있어요.", rise)}
        </>
      )}

      {error && (
        <Notice tone="error" size="sm">
          {error}
        </Notice>
      )}
      {found && (
        <ul className="flex flex-col gap-3">
          <OrderCard order={found} shopOrigin={shopOrigin} onInquiry={onInquiry} />
        </ul>
      )}
      <button
        className="mt-1 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => onInquiry({ category: "shipping" })}
      >
        찾는 내용이 없나요? 문의 남기기
      </button>
    </div>
  );
}
