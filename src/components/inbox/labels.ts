export const STATUS_LABEL: Record<string, string> = {
  open: "답변 필요",
  waiting_customer: "응대 중",
  resolved: "종료",
};

export const PRIORITY_LABEL: Record<string, string> = { normal: "보통", high: "높음", urgent: "긴급" };

export const CATEGORY_LABEL: Record<string, string> = {
  shipping: "배송",
  exchange: "교환",
  return: "반품",
  size: "사이즈",
  defect: "불량",
  restock: "재입고",
  etc: "기타",
};

export const contactDisplayName = (c: { contact_name?: string | null; name?: string | null; contact_id?: string; id?: string }) =>
  c.contact_name ?? c.name ?? `고객 ${(c.contact_id ?? c.id ?? "").slice(0, 6)}`;

// 답변 기한(시간). 고객에게 안내하는 "영업일 기준 24시간 이내"와 맞춘다.
export const SLA_HOURS = 24;
// 기한의 절반을 넘기면 주의, 기한을 넘기면 초과
export type WaitLevel = "fresh" | "warn" | "late";

export const hoursSince = (iso: string | null | undefined) => (iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : 0);

export const waitLevel = (h: number): WaitLevel => (h >= SLA_HOURS ? "late" : h >= SLA_HOURS / 2 ? "warn" : "fresh");

export function shortWait(h: number) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.floor(h)}h`;
  return `${Math.floor(h / 24)}d`;
}

export const WAIT_TEXT: Record<WaitLevel, string> = {
  fresh: "text-ink-3",
  warn: "text-warn-text",
  late: "text-late-text",
};
