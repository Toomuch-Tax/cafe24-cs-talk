// 빠른 답변의 {상품명} ({컬러}/{사이즈}) 같은 빈칸을 주문 상품·고객 정보로 채운다.
// 모르는 빈칸이나 값이 없는 빈칸은 그대로 남겨 상담원이 Tab 으로 채우게 한다.

export type FillItem = {
  orderId: string;
  name: string;
  option: string | null;
  quantity: number;
};

const BLANK_G = /\{([^{}\n]{1,20})\}/g;

// 빈칸 이름(공백 무시) → 채울 값의 종류
const ALIASES: Record<string, keyof Vars> = {
  상품명: "product",
  상품: "product",
  제품명: "product",
  컬러: "color",
  색상: "color",
  색: "color",
  사이즈: "size",
  옵션: "option",
  주문번호: "orderId",
  수량: "quantity",
  고객명: "customer",
  이름: "customer",
  성함: "customer",
};

type Vars = {
  product: string;
  // 컬러를 뺀 상품명 (템플릿에 {컬러} 칸도 있을 때만 쓴다)
  productBase: string;
  color: string;
  size: string;
  option: string;
  orderId: string;
  quantity: string;
  customer: string;
};

// Cafe24 option_value: "색상=Black, 사이즈=M" / "Color=Black, Size=M" / "Black / M" / "M"
function parseOption(option: string | null) {
  const out: { color?: string; size?: string } = {};
  if (!option) return out;
  const pairs = option.split(/,\s*/).map((p) => p.split(/\s*[=:]\s*/));
  if (pairs.every((p) => p.length === 2)) {
    for (const [k, v] of pairs) {
      if (/색|컬러|colou?r/i.test(k)) out.color = v.trim();
      else if (/사이즈|size/i.test(k)) out.size = v.trim();
    }
    return out;
  }
  const parts = option.split(/\s*\/\s*/).filter(Boolean);
  if (parts.length === 2) [out.color, out.size] = parts;
  else if (parts.length === 1 && /^(XXS|XS|S|M|L|XL|XXL|XXXL|F|FREE|\d{2,3})$/i.test(parts[0])) out.size = parts[0];
  return out;
}

export function itemVars(item: FillItem | null, customer: string | null): Partial<Vars> {
  const vars: Partial<Vars> = {};
  if (customer?.trim()) vars.customer = customer.trim();
  if (!item) return vars;
  const opt = parseOption(item.option);
  let product = item.name.trim();
  vars.product = product;
  // 상품명 끝의 "(TEAL)" 은 컬러다. 옵션에 컬러가 없으면 여기서 가져온다
  const tail = product.match(/^(.*\S)\s*\(([^()]+)\)$/);
  if (tail) {
    product = tail[1];
    opt.color ??= tail[2].trim();
  }
  vars.productBase = product;
  if (opt.color) vars.color = opt.color;
  if (opt.size) vars.size = opt.size;
  if (item.option) vars.option = item.option;
  vars.orderId = item.orderId;
  vars.quantity = String(item.quantity);
  return vars;
}

// 글 안에서 자동으로 채운 값의 위치 [start, end)
export type Range = { start: number; end: number };

// 아는 빈칸만 값으로 바꾸고, 채운 위치를 돌려준다 (입력창에서 태그처럼 칠함).
// keep: 이미 채워 둔 위치 — 이번에 바뀐 글자 수만큼 밀어서 함께 돌려준다
export function fillBlanks(text: string, vars: Partial<Vars>, keep: Range[] = []) {
  const kinds = [...text.matchAll(BLANK_G)].map((m) => ALIASES[m[1].replace(/\s/g, "")]);
  // "{상품명} ({컬러}/{사이즈})" 처럼 컬러 칸이 따로 있으면 상품명에서 컬러를 빼야 두 번 나오지 않는다
  const product = kinds.includes("color") && vars.color ? vars.productBase : vars.product;
  const edits: { at: number; delta: number }[] = [];
  const added: Range[] = [];
  let delta = 0;
  const out = text.replace(BLANK_G, (whole, key: string, at: number) => {
    const kind = ALIASES[key.replace(/\s/g, "")];
    const value = kind && (kind === "product" ? product : vars[kind]);
    if (!value) return whole;
    added.push({ start: at + delta, end: at + delta + value.length });
    delta += value.length - whole.length;
    edits.push({ at, delta: value.length - whole.length });
    return value;
  });
  const shift = (pos: number) => pos + edits.filter((e) => e.at < pos).reduce((n, e) => n + e.delta, 0);
  const kept = keep.map((r) => ({ start: shift(r.start), end: shift(r.end) }));
  return { text: out, ranges: [...kept, ...added].sort((a, b) => a.start - b.start) };
}

// 상담원이 글을 고치면: 바뀐 곳보다 앞의 태그는 그대로, 뒤의 태그는 밀고, 고친 태그는 지운다
export function moveRanges(ranges: Range[], before: string, after: string): Range[] {
  if (!ranges.length) return ranges;
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const changedEnd = before.length - tail;
  const delta = after.length - before.length;
  return ranges.flatMap((r) =>
    r.end <= head ? [r] : r.start >= changedEnd ? [{ start: r.start + delta, end: r.end + delta }] : [],
  );
}
