"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { api, ApiError } from "@/lib/client/api";
import { errorReason } from "@/lib/client/error-text";
import type { FillItem } from "@/lib/client/quick-reply-vars";
import { cn } from "@/lib/utils";
import { Section } from "./app-shell";

export type Order = {
  orderId: string;
  orderDate: string;
  paid: boolean;
  canceled: boolean;
  paymentAmount: string | null;
  buyerName: string | null;
  buyerPhone: string | null;
  items: {
    code: string | null;
    name: string;
    option: string | null;
    quantity: number;
    status: string;
    shippingCompany: string | null;
    trackingNo: string | null;
    shippedDate: string | null;
    deliveredDate: string | null;
  }[];
};

const ERROR_TEXT: Record<string, string> = {
  cafe24_not_connected: "Cafe24 가 아직 연결되지 않았어요. 설정에서 연결해주세요.",
  cafe24_reconnect_required: "Cafe24 연결이 만료됐어요. 설정에서 다시 연결해주세요.",
  invalid_order_id: "주문번호 형식이 맞지 않아요.",
  invalid_phone: "휴대폰 번호를 확인해주세요.",
};
const errorText = (err: unknown) =>
  err instanceof ApiError
    ? (ERROR_TEXT[err.code] ?? `주문을 불러오지 못했어요. ${errorReason(err).reason}`)
    : `주문을 불러오지 못했어요. ${errorReason(err).reason}`;

const won = (v: string | null) => (v ? `${Number(v).toLocaleString("ko-KR")}원` : "");

const md = (d: string | null) => (d ? d.slice(5, 10).replace("-", ".") : null);

// 넓은 화면(1600px 이상)에서만: 주문 → 출고 → 배송완료 진행 단계와 날짜
function ShippingSteps({ orderDate, item }: { orderDate: string; item: Order["items"][number] }) {
  const steps = [
    { label: "주문", date: md(orderDate) },
    { label: "출고", date: md(item.shippedDate) },
    { label: "배송완료", date: md(item.deliveredDate) },
  ];
  return (
    <ol className="hidden items-center gap-1.5 pt-0.5 text-[11.5px] min-[1600px]:flex">
      {steps.map((s, idx) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {idx > 0 && <span className={cn("h-px w-4", s.date ? "bg-signal" : "bg-border")} />}
          <span className={cn("size-1.5 rounded-full", s.date ? "bg-signal" : "bg-panel-3 edge")} />
          <span className={s.date ? "text-muted-foreground" : "text-ink-3"}>{s.label}</span>
          <span className="num text-ink-3">{s.date ?? "—"}</span>
        </li>
      ))}
    </ol>
  );
}

// 답변 빈칸({상품명} 등)을 채울 상품을 고르고 표시한다
export type ItemPicker = {
  picked: string | null;
  onPick: (key: string, item: FillItem) => void;
};
export const itemKey = (order: Order, idx: number) => `${order.orderId}:${order.items[idx].code ?? idx}`;
export const fillItem = (order: Order, idx: number): FillItem => {
  const i = order.items[idx];
  return { orderId: order.orderId, name: i.name, option: i.option, quantity: i.quantity };
};

function OrderCard({ order, picker }: { order: Order; picker?: ItemPicker }) {
  return (
    <li className="flex flex-col gap-2.5 rounded-2xl bg-raised p-3 edge">
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-xs text-muted-foreground">{order.orderId}</span>
        {order.canceled ? (
          <Chip tone="late" className="ml-auto">
            취소
          </Chip>
        ) : !order.paid ? (
          <Chip tone="warn" className="ml-auto">
            미결제
          </Chip>
        ) : (
          <span className="num ml-auto text-[11px] text-ink-3">{order.orderDate.slice(0, 10)}</span>
        )}
      </div>
      <ul className="flex flex-col gap-2.5">
        {order.items.map((i, idx) => {
          const key = itemKey(order, idx);
          const picked = picker?.picked === key;
          return (
          <li key={i.code ?? idx} className="flex flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 flex-1 truncate text-[13px]">
                {i.name}
                {i.quantity > 1 && <span className="num text-ink-3"> ×{i.quantity}</span>}
              </p>
              {picker && (
                <button
                  type="button"
                  onClick={() => picker.onPick(key, fillItem(order, idx))}
                  title="답변의 {상품명} {컬러} {사이즈} {주문번호} 빈칸을 이 상품으로 채워요"
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] transition-colors",
                    picked ? "bg-signal text-signal-foreground" : "text-ink-3 edge hover:text-foreground",
                  )}
                >
                  {picked ? "답변에 사용 중" : "답변에 넣기"}
                </button>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <Chip
                tone={/배송완료|구매확정/.test(i.status) ? "ok" : /배송중|출고/.test(i.status) ? "signal" : "neutral"}
              >
                {i.status}
              </Chip>
              {i.option && <span className="truncate text-xs text-ink-3">{i.option}</span>}
            </div>
            {i.trackingNo && (
              <p className="truncate border-t border-dashed pt-1.5 text-xs text-muted-foreground">
                {i.shippingCompany} <span className="font-mono">{i.trackingNo}</span>
              </p>
            )}
            {order.paid && !order.canceled && <ShippingSteps orderDate={order.orderDate} item={i} />}
          </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 border-t pt-2 text-xs text-ink-3">
        <span className="num text-muted-foreground">{won(order.paymentAmount)}</span>
        {order.buyerName && (
          <span className="ml-auto truncate">
            {order.buyerName} <span className="font-mono">{order.buyerPhone}</span>
          </span>
        )}
      </div>
    </li>
  );
}

export function OrderPanel({
  contactId,
  conversationId,
  verifiedMemberId,
  orderRef,
  phone,
  onContactFilled,
  picker,
  onOrders,
}: {
  contactId: string;
  conversationId: string;
  verifiedMemberId: string | null;
  // 비회원 문의의 주문번호(없으면 남긴 휴대폰)를 조회 칸에 미리 넣어 둔다 (조회는 상담원이 누른다)
  orderRef: string | null;
  phone: string | null;
  // 회원 정보로 연락처 칸을 채웠을 때 (고객 정보 다시 불러오기)
  onContactFilled?: () => void;
  picker?: ItemPicker;
  // 불러온 주문 (상품이 하나뿐이면 답변 빈칸에 자동으로 쓰도록)
  onOrders?: (orders: Order[]) => void;
}) {
  const [memberOrders, setMemberOrders] = useState<Order[] | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [query, setQuery] = useState(verifiedMemberId ? "" : (orderRef?.trim() || phone || ""));
  const [searchResult, setSearchResult] = useState<Order[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // 부모가 렌더마다 새 함수를 넘겨도 주문을 다시 부르지 않게 최신 값만 들고 있는다
  const filledRef = useRef(onContactFilled);
  const ordersRef = useRef(onOrders);
  useEffect(() => {
    filledRef.current = onContactFilled;
    ordersRef.current = onOrders;
  });

  useEffect(() => {
    if (!verifiedMemberId) return;
    api<{ orders: Order[]; contactFilled?: boolean }>(`/api/inbox/contacts/${contactId}/orders?conversationId=${conversationId}`)
      .then((r) => {
        setMemberOrders(r.orders);
        ordersRef.current?.(r.orders);
        if (r.contactFilled) filledRef.current?.();
      })
      .catch((err) => setMemberError(errorText(err)));
  }, [contactId, conversationId, verifiedMemberId]);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    const digits = q.replace(/[^\d]/g, "");
    const isPhone = /^01\d{8,9}$/.test(digits); // 주문번호는 날짜(2026...)로 시작해 겹치지 않는다
    const param = isPhone ? `phone=${encodeURIComponent(digits)}` : `orderId=${encodeURIComponent(q)}`;
    setSearching(true);
    setSearchError(null);
    try {
      const r = await api<{ orders: Order[] }>(`/api/inbox/orders?${param}&conversationId=${conversationId}`);
      setSearchResult(r.orders);
      onOrders?.(r.orders);
    } catch (err) {
      setSearchError(errorText(err));
      setSearchResult(null);
    } finally {
      setSearching(false);
    }
  };

  return (
    <Section title="주문 · 최근 3개월">
      {verifiedMemberId ? (
        memberError ? (
          <Notice tone="error" size="sm">
            {memberError}
          </Notice>
        ) : memberOrders === null ? (
          <p className="text-xs text-ink-3">불러오는 중…</p>
        ) : memberOrders.length === 0 ? (
          <p className="text-xs text-ink-3">최근 3개월 주문이 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {memberOrders.slice(0, 5).map((o) => (
              <OrderCard key={o.orderId} order={o} picker={picker} />
            ))}
          </ul>
        )
      ) : (
        <p className="rounded-xl bg-panel-2 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground edge">
          로그인 회원이 아니라 주문을 자동으로 불러오지 않아요. 고객에게 주문번호를 받아 조회하세요.
        </p>
      )}

      <form
        className="mt-3 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="주문번호 또는 휴대폰"
          className="h-8 rounded-xl text-xs"
          aria-label="주문 조회"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8 rounded-xl"
          disabled={searching || !query.trim()}
        >
          조회
        </Button>
      </form>
      {searchError && (
        <Notice tone="error" size="sm" className="mt-2">
          {searchError}
        </Notice>
      )}
      {searchResult && (
        <ul className="mt-2 flex flex-col gap-2">
          {searchResult.length === 0 ? (
            <li className="text-xs text-ink-3">일치하는 주문이 없어요.</li>
          ) : (
            searchResult.map((o) => <OrderCard key={o.orderId} order={o} picker={picker} />)
          )}
        </ul>
      )}
    </Section>
  );
}
