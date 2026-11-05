// Cafe24 주문번호: 20261017-0000123 (주문일 8자리 - 일련번호 7자리)
export const ORDER_ID = /^20\d{6}-\d{7}$/;

// 공백·하이픈 없이 붙여 넣은 15자리도 받아 정규 형식으로 바꾼다. 주문번호가 아니면 null.
export function normalizeOrderId(v: string | null | undefined) {
  const s = (v ?? "").replace(/\s/g, "");
  const d = /^\d{15}$/.test(s) ? `${s.slice(0, 8)}-${s.slice(8)}` : s;
  return ORDER_ID.test(d) ? d : null;
}

// "모르는데", "몰라요", "기억 안 나요" 처럼 주문번호 칸에 모른다고 적은 경우 (건너뛰기로 본다)
export const DONT_KNOW_ORDER = /^(모르|몰라|모름|잘\s*(모르|몰)|기억\s*(이\s*)?안|없|찾을\s*수\s*없|확인\s*(이\s*)?(안|어려)|\?+$)/;
