// 슬랙 알림 문구 조립 (순수 함수 — DB·네트워크 없음).
// 문의 내용은 슬랙에서 대응 여부를 판단할 만큼만 보낸다: 연락처·이메일·계좌·카드번호·도로명 주소는 가리고 길이를 자른다.
// 고객 이름은 '예금주·수령인' 처럼 이름이 붙는 자리만 가린다 (문장 속 이름은 기계적으로 찾을 수 없다. 위젯 문의 양식에는 이름 칸이 없다).

const PHONE = /(?:\+?82[-\s]?0?|0)\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g;
// "예금주 홍길동", "이름: 홍길동" 처럼 이름이 붙는 자리 (이름·성함은 "상품 이름 바꿔" 같은 오탐을 피하려고 콜론이 있을 때만)
const NAMED = /((?:예금주|수령인|받는\s?분|받는\s?사람)\s?[:：]?\s?|(?:이름|성함)\s?[:：]\s?)[가-힣]{2,4}/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const ORDER_NO = /\b\d{8}-\d{7}\b/g; // Cafe24 주문번호는 그대로 둔다 (관리자에서 찾을 때 필요)
const LONG_DIGITS = /\d[\d -]{8,}\d/g; // 계좌·카드번호 등 10자리 이상 숫자
const ROAD_ADDRESS = /[가-힣\d]+(?:로|길)\s?\d+(?:-\d+)?(?:,?\s?[\d가-힣]*\d+\s?(?:동|층|호))*/g;

export function maskPersonal(text: string) {
  // 주문번호를 잠시 빼 두고 가린 뒤 되돌린다 (주문번호 안의 숫자가 전화번호로 잡히지 않게)
  const orders: string[] = [];
  return text
    .replace(ORDER_NO, (m) => `\u0000${orders.push(m) - 1}\u0000`)
    .replace(EMAIL, "[이메일]")
    .replace(PHONE, "[연락처]")
    .replace(LONG_DIGITS, "[번호]")
    .replace(ROAD_ADDRESS, "[주소]")
    .replace(NAMED, "$1[이름]")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => orders[Number(i)]);
}

// 슬랙 mrkdwn 특수문자. 고객 글에 <!channel> 같은 멘션이나 링크 문법이 들어와도 그대로 글자로 보이게 한다.
export const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 본문 → 인용 블록. 줄 수와 길이를 자르고 빈 줄은 접는다.
export function quoteBody(body: string, opts: { maxChars?: number; maxLines?: number } = {}) {
  const maxChars = opts.maxChars ?? 300;
  const maxLines = opts.maxLines ?? 8;
  const lines = escapeSlack(maskPersonal(body))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out: string[] = [];
  let used = 0;
  let cut = false;
  for (const line of lines) {
    if (out.length >= maxLines || used >= maxChars) {
      cut = true;
      break;
    }
    const room = maxChars - used;
    if (line.length > room) {
      out.push(`${line.slice(0, room).trimEnd()}…`);
      cut = true;
      break;
    }
    out.push(line);
    used += line.length;
  }
  if (out.length === 0) return "> _(내용 없음 — 사진만 보냈을 수 있어요)_";
  if (cut && !out.at(-1)!.endsWith("…")) out.push("…");
  return out.map((l) => `> ${l}`).join("\n");
}

// 한 줄 미리보기 (요약 목록용)
export function oneLine(body: string, max = 60) {
  const t = escapeSlack(maskPersonal(body)).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t || "(내용 없음)";
}

export const waitText = (hours: number) =>
  hours < 1 ? `${Math.max(1, Math.round(hours * 60))}분` : hours < 48 ? `${Math.floor(hours)}시간` : `${Math.floor(hours / 24)}일`;
