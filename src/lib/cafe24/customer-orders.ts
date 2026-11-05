import type { OrderSummary } from "./orders";

// 고객에게 보여줄 주문 상태. 금액·연락처·주소는 넣지 않는다.
export type CustomerOrderItem = {
  name: string;
  option: string | null;
  quantity: number;
  status: string;
  guide: string;
  trackingUrl: string | null;
  shippingCompany: string | null;
  trackingNo: string | null;
  // 고객이 다음에 할 수 있는 일
  action: "cancel_in_mypage" | "inquiry_return" | "inquiry_not_received" | null;
};
export type CustomerOrder = { orderId: string; orderDate: string; items: CustomerOrderItem[] };

const DAY = 24 * 60 * 60 * 1000;

function guideFor(code: string | null, shippedDate: string | null): { guide: string; action: CustomerOrderItem["action"] } {
  const c = code ?? "";
  if (c === "N00" || c === "N02") return { guide: "입금(결제) 확인 전이에요. 확인되면 바로 출고 준비를 시작해요.", action: "cancel_in_mypage" };
  if (c === "N10" || c === "N20" || c === "N21")
    return { guide: "출고 준비 중이에요. 출고되면 송장번호가 여기에 표시돼요.", action: "cancel_in_mypage" };
  if (c === "N22") return { guide: "확인이 필요한 부분이 있어 출고가 잠시 보류됐어요. 문의를 남겨주시면 확인해드릴게요.", action: null };
  if (c === "N30") {
    // 출고 후 4일이 지나도 배송중이면 택배사 완료 처리가 늦어진 경우가 많다 → 반품 버튼이 안 보이는 원인
    const late = shippedDate && Date.now() - Date.parse(shippedDate) > 4 * DAY;
    return late
      ? { guide: "택배사에서 배송완료 처리가 늦어지고 있어요. 이미 받으셨고 반품을 원하시면 문의를 남겨주세요. 대신 접수해드릴게요.", action: "inquiry_return" }
      : { guide: "배송 중이에요. 출고 후 보통 1~3일 안에 도착해요.", action: null };
  }
  if (c === "N40") return { guide: "배송이 완료됐어요. 받지 못하셨다면 문의를 남겨주세요.", action: "inquiry_not_received" };
  if (c === "N50") return { guide: "구매확정된 주문이에요.", action: null };
  if (c.startsWith("C")) return { guide: "취소된 주문이에요. 결제 수단에 따라 환불 반영까지 며칠 걸릴 수 있어요.", action: null };
  if (["R00", "R10", "R12", "R30"].includes(c))
    return { guide: "반품이 접수됐어요. 수거 기사님이 방문해 상품을 가져갈 예정이에요.", action: null };
  if (["R13", "R20", "R31", "R34", "R36"].includes(c))
    return { guide: "반품 상품이 물류센터에 도착했어요. 상품 확인 후 1~3일 안에 환불돼요.", action: null };
  if (c.startsWith("R4")) return { guide: "반품이 완료됐어요. 환불 반영은 결제 수단에 따라 며칠 걸릴 수 있어요.", action: null };
  if (c === "R11" || c === "E11") return { guide: "접수가 거절된 요청이에요. 자세한 사유는 문의를 남겨주시면 안내해드릴게요.", action: null };
  if (c.startsWith("E4")) return { guide: "교환이 완료됐어요.", action: null };
  if (c.startsWith("E")) return { guide: "교환이 진행 중이에요. 기존 상품 수거 후 새 상품을 보내드려요.", action: null };
  return { guide: "", action: null };
}

const trackingUrl = (company: string | null, no: string | null) =>
  no ? `https://search.naver.com/search.naver?query=${encodeURIComponent(`${company ?? ""} ${no}`.trim())}` : null;

export function toCustomerOrder(o: OrderSummary): CustomerOrder {
  return {
    orderId: o.orderId,
    orderDate: o.orderDate.slice(0, 10),
    items: o.items.map((i) => {
      const g = guideFor(i.statusCode, i.shippedDate);
      return {
        name: i.name,
        option: i.option,
        quantity: i.quantity,
        status: i.status,
        guide: g.guide,
        action: g.action,
        shippingCompany: i.shippingCompany,
        trackingNo: i.trackingNo,
        trackingUrl: trackingUrl(i.shippingCompany, i.trackingNo),
      };
    }),
  };
}

// 비회원 확인용: 주문자 이름 비교 (공백 무시)
export const sameName = (a: string | null, b: string) =>
  !!a && a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();
