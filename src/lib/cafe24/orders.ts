import { cafe24Get } from "./client";

// 상담원 화면에 필요한 값만 추린다 (배송지 주소 등은 가져오지 않음)

const STATUS: Record<string, string> = {
  N00: "입금전", N01: "교환접수(교환상품)", N02: "주문접수중", N03: "교환접수(카드결제대기)",
  N10: "상품준비중", N20: "배송준비중", N21: "배송대기", N22: "배송보류", N30: "배송중", N40: "배송완료", N50: "구매확정",
  C00: "취소신청", C10: "취소접수", C11: "취소접수거부", C34: "취소처리중(환불전)", C35: "취소처리중(환불완료)",
  C36: "취소처리중(환불보류)", C40: "취소완료", C41: "취소완료(환불전)", C42: "취소완료(환불요청중)",
  C43: "취소완료(환불보류)", C47: "입금전취소(구매자)", C48: "입금전취소(자동)", C49: "입금전취소(관리자)",
  R00: "반품신청", R10: "반품접수", R11: "반품접수거부", R12: "반품보류", R13: "반품접수(수거완료)",
  R20: "반품수거완료", R30: "반품처리중(수거전)", R31: "반품처리중(수거완료)", R34: "반품처리중(환불전)",
  R36: "반품처리중(환불보류)", R40: "반품완료(환불완료)", R41: "반품완료(환불전)", R42: "반품완료(환불요청중)",
  R43: "반품완료(환불보류)",
  E00: "교환신청", E10: "교환접수", E11: "교환접수거부", E12: "교환보류", E13: "교환접수(수거완료)",
  E20: "교환준비", E30: "교환처리중(수거전)", E31: "교환처리중(수거완료)", E32: "교환처리중(입금전)",
  E33: "교환처리중(입금완료)", E34: "교환처리중(환불전)", E35: "교환처리중(환불완료)", E36: "교환처리중(환불보류)",
  E40: "교환완료",
};

type RawItem = {
  order_item_code?: string;
  product_name?: string;
  option_value?: string;
  quantity?: number;
  order_status?: string;
  status_text?: string;
  shipping_company_name?: string;
  tracking_no?: string;
  shipped_date?: string;
  delivered_date?: string;
};
type RawOrder = {
  order_id: string;
  order_date: string;
  member_id?: string;
  paid?: string;
  canceled?: string;
  payment_amount?: string;
  actual_order_amount?: { payment_amount?: string } | string;
  items?: RawItem[];
  buyer?: { name?: string; cellphone?: string };
};

export type OrderSummary = {
  orderId: string;
  orderDate: string;
  memberId: string | null;
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
    statusCode: string | null;
    shippingCompany: string | null;
    trackingNo: string | null;
    shippedDate: string | null;
    deliveredDate: string | null;
  }[];
};

// 010-1234-5678 → 010-****-5678
export const maskPhone = (p?: string | null) =>
  p ? p.replace(/^(\d{2,3})-?(\d{3,4})-?(\d{4})$/, (_, a, b, c) => `${a}-${"*".repeat(b.length)}-${c}`) : null;

function normalize(o: RawOrder): OrderSummary {
  const amount =
    o.payment_amount ?? (typeof o.actual_order_amount === "object" ? o.actual_order_amount?.payment_amount : o.actual_order_amount);
  return {
    orderId: o.order_id,
    orderDate: o.order_date,
    memberId: o.member_id || null,
    paid: o.paid === "T",
    canceled: o.canceled === "T",
    paymentAmount: amount ?? null,
    buyerName: o.buyer?.name ?? null,
    buyerPhone: maskPhone(o.buyer?.cellphone),
    items: (o.items ?? []).map((i) => ({
      code: i.order_item_code ?? null,
      name: i.product_name ?? "",
      option: i.option_value || null,
      quantity: Number(i.quantity ?? 1),
      status: i.status_text || (i.order_status && STATUS[i.order_status]) || i.order_status || "",
      statusCode: i.order_status ?? null,
      shippingCompany: i.shipping_company_name || null,
      trackingNo: i.tracking_no || null,
      shippedDate: i.shipped_date || null,
      deliveredDate: i.delivered_date || null,
    })),
  };
}

// Cafe24 주문 검색은 한 번에 3개월 미만만 가능
function recentRange() {
  const fmt = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d);
  const end = new Date();
  const start = new Date(end.getTime() - 89 * 24 * 60 * 60 * 1000);
  return { start_date: fmt(start), end_date: fmt(end) };
}

const sortDesc = (orders: OrderSummary[]) => orders.sort((a, b) => b.orderDate.localeCompare(a.orderDate));

const digits = (v?: string | null) => (v ?? "").replace(/[^\d]/g, "");

// Cafe24 가 검색 조건을 무시하고 다른 주문을 돌려줄 수 있으므로(실제로 휴대폰 조건에서 확인됨)
// 응답을 받은 뒤 서버에서 조건과 일치하는 주문만 남긴다.
async function searchOrders(params: Record<string, string>) {
  const q = new URLSearchParams({ ...recentRange(), ...params, embed: "items,buyer", limit: "50" });
  const { orders } = await cafe24Get<{ orders: RawOrder[] }>(`/orders?${q}`);
  return orders ?? [];
}

export async function ordersByMember(memberId: string) {
  const raw = await searchOrders({ member_id: memberId });
  return sortDesc(raw.filter((o) => o.member_id === memberId).map(normalize));
}

// 회원 최근 주문의 주문자 이름·휴대폰 (상담원 연락처 칸 채우기용, 가리지 않은 값)
export async function latestBuyer(memberId: string) {
  const raw = (await searchOrders({ member_id: memberId })).filter((o) => o.member_id === memberId && o.buyer);
  raw.sort((a, b) => b.order_date.localeCompare(a.order_date));
  const buyer = raw[0]?.buyer;
  return buyer ? { name: buyer.name || null, phone: buyer.cellphone || null } : null;
}

export async function ordersByPhone(phone: string) {
  const want = digits(phone);
  const match = (o: RawOrder) => digits(o.buyer?.cellphone) === want;
  const dashed = want.length === 11 ? `${want.slice(0, 3)}-${want.slice(3, 7)}-${want.slice(7)}` : want;
  let raw = (await searchOrders({ buyer_cellphone: dashed })).filter(match);
  if (raw.length === 0 && dashed !== want) raw = (await searchOrders({ buyer_cellphone: want })).filter(match);
  return sortDesc(raw.map(normalize));
}

export async function orderById(orderId: string) {
  const q = new URLSearchParams({ embed: "items,buyer" });
  const data = await cafe24Get<{ order?: RawOrder; orders?: RawOrder[] }>(`/orders/${encodeURIComponent(orderId)}?${q}`);
  const raw = data.order ?? data.orders?.[0];
  return raw?.order_id === orderId ? normalize(raw) : null;
}
