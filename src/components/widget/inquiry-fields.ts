// 문의 유형별로 처음부터 받아두는 정보. 답변하는 쪽이 되묻지 않아도 되게 하는 것이 목적이다.
// 값은 DB 컬럼을 늘리지 않고 문의 본문 맨 위에 "라벨: 값" 줄로 합쳐서 저장한다 (인박스·AI 초안이 그대로 읽는다).

export type InquiryField = {
  key: string;
  label: string;
  // 대화형 폼에서 물을 문장 (없으면 label 로 만든다). label 은 본문 "라벨: 값" 줄에 쓰인다.
  ask?: string;
  required?: boolean;
  // choice: 칩 선택 / text: 한 줄 입력
  kind: "choice" | "text";
  options?: string[];
  placeholder?: string;
  // 미리 채워진 값(보고 있던 상품 등)이 있을 때만 보여주고, 없으면 묻지 않는다
  prefillOnly?: boolean;
};

export type InquiryCategory = {
  value: string;
  label: string;
  // 주문번호 칸을 보여줄지 (conversations.order_ref 로 따로 저장)
  needsOrder: boolean;
  fields: InquiryField[];
  // 자유 입력 칸 안내. 유형 필수 정보를 다 받았다면 추가 내용은 선택이다.
  hint: string;
  // 자유 입력 질문 아래 작은 안내 / 입력칸 예시
  hintSub?: string;
  freePlaceholder?: string;
};

export const INQUIRY_CATEGORIES: InquiryCategory[] = [
  {
    value: "shipping",
    label: "배송",
    needsOrder: true,
    fields: [
      {
        key: "topic",
        label: "어떤 내용인가요?",
        kind: "choice",
        required: true,
        options: ["배송 일정", "배송 지연", "받지 못함(배송완료 표시)", "배송지 변경", "기타"],
      },
    ],
    hint: "궁금한 내용을 자세히 남겨주세요.",
  },
  {
    value: "return",
    label: "반품·환불",
    needsOrder: true,
    fields: [
      { key: "item", label: "반품할 상품", kind: "text", required: true, placeholder: "상품명 · 색상 · 사이즈" },
      {
        key: "reason",
        label: "반품 사유",
        kind: "choice",
        required: true,
        options: ["단순 변심", "사이즈가 안 맞음", "상품 불량·오배송", "기타"],
      },
      { key: "received", label: "상품 수령", ask: "상품을 받으셨나요?", kind: "choice", options: ["받았어요", "아직 못 받았어요"] },
    ],
    hint: "추가로 알려주실 내용이 있으면 남겨주세요.",
  },
  {
    value: "exchange",
    label: "교환",
    needsOrder: true,
    fields: [
      { key: "item", label: "교환할 상품", kind: "text", required: true, placeholder: "상품명 · 색상 · 사이즈" },
      { key: "want", label: "원하는 옵션", kind: "text", required: true, placeholder: "예) 블랙 M" },
      {
        key: "reason",
        label: "교환 사유",
        kind: "choice",
        options: ["사이즈가 안 맞음", "색상·디자인 변경", "상품 불량·오배송", "기타"],
      },
    ],
    hint: "추가로 알려주실 내용이 있으면 남겨주세요.",
  },
  {
    value: "defect",
    label: "불량·오배송",
    needsOrder: true,
    fields: [
      { key: "item", label: "해당 상품", kind: "text", required: true, placeholder: "상품명 · 색상 · 사이즈" },
      {
        key: "symptom",
        label: "증상",
        kind: "choice",
        required: true,
        options: ["오염·얼룩", "봉제·올 풀림·찢어짐", "사이즈·색상이 다름", "다른 상품이 도착", "구성품 누락", "기타"],
      },
    ],
    hint: "언제부터, 어떤 모습인지 자세히 남겨주세요.",
  },
  {
    value: "restock",
    label: "재입고",
    needsOrder: false,
    fields: [
      { key: "item", label: "상품명", kind: "text", required: true },
      { key: "color", label: "색상", kind: "text", required: true },
      { key: "size", label: "사이즈", kind: "text", required: true },
    ],
    hint: "추가로 알려주실 내용이 있으면 남겨주세요.",
  },
  {
    value: "size",
    label: "사이즈·상품",
    needsOrder: false,
    // 칸을 나눠 받으면 "작지만 오버핏을 원해요" 같은 취향을 담을 수 없어 한 번에 문장으로 받는다.
    // 상품 페이지에서 열었을 때만 상품명을 함께 남긴다.
    fields: [{ key: "item", label: "상품명", kind: "text", prefillOnly: true }],
    hint: "어떤 점이 궁금하신가요? 편하게 적어주세요.",
    hintSub: "사이즈 추천은 키·체중, 평소 입는 사이즈, 원하는 핏(딱 맞게·여유 있게)을 함께 알려주시면 더 정확해요.",
    freePlaceholder: "예) 키 160cm, 평소 M 입어요. 작은 편이지만 오버핏으로 넉넉하게 입고 싶은데 어떤 사이즈가 좋을까요?",
  },
  { value: "etc", label: "기타", needsOrder: false, fields: [], hint: "문의 내용을 남겨주세요." },
];

export const categoryOf = (value: string) => INQUIRY_CATEGORIES.find((c) => c.value === value) ?? INQUIRY_CATEGORIES.at(-1)!;

// 필수 칸이 모두 찼는지. 자유 입력은 필수 칸이 없는 유형(기타)에서만 꼭 필요하다.
export function inquiryReady(cat: InquiryCategory, answers: Record<string, string>, free: string) {
  const requiredDone = cat.fields.every((f) => !f.required || (answers[f.key] ?? "").trim());
  if (cat.fields.some((f) => f.required)) return requiredDone;
  return free.trim().length >= 2;
}

const NO_MORE = /^(아니[요오]?|아뇨|없[어습][요니다]*|없음|괜찮아요|no|x)[\s.!~?ㅠㅜ]*$/i;

// 문의 본문으로 합친다: "라벨: 값" 줄들 + 빈 줄 + 자유 입력
export function composeInquiryBody(cat: InquiryCategory, answers: Record<string, string>, free: string) {
  const lines = cat.fields
    .map((f) => [f.label.replace(/\?$/, ""), (answers[f.key] ?? "").trim()] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  // "더 알려주실 내용이 있나요?"에 건너뛰기 대신 "아니요!"라고 적으면 질문 없이 답만 남아 담당자가 헷갈린다
  const extra = NO_MORE.test(free.trim()) ? "" : free.trim();
  return [lines.join("\n"), extra].filter(Boolean).join("\n\n");
}
