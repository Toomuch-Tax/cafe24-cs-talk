import { z } from "zod";
import { BRAND_NAME, BRAND_NAME_EN } from "../brand";

// AI 응답 엔진의 순수 로직 (DB·네트워크 없음)

export const CUSTOMER_MODEL = "anthropic/claude-haiku-5.5";
export const DRAFT_MODEL = "anthropic/claude-sonnet-5.5";

// 사람이 반드시 봐야 하는 문의 (LLM 호출 없이 바로 문의 접수로)
export const ESCALATE = /불량|하자|오배송|잘못\s*(왔|온|보내)|누락|안\s*왔|파손|찢어|구멍|오염|가품|짝퉁|정품\s*(인가|맞|아니)|소비자\s*(원|보호)|신고|고소|변호사|환불\s*(해\s*주|해줘|요구)|사기/;
// 고객에게 나가면 안 되는 표현 (내부 용어 "정책 문서"·"상품 정보에" 노출 포함)
export const FORBIDDEN = /정책\s*문서|상품\s*정보에|환불\s*(해\s*드리겠|처리\s*해\s*드리겠|해\s*드릴게)|교환\s*해\s*드리겠|재발송\s*해\s*드리겠|정품(이|입니다|이에요|이 맞)|가품(이|입니다)|보상\s*해\s*드리겠|무료로\s*(교환|반품|배송)\s*해\s*드리겠/;

export const CATEGORY_VALUES = ["shipping", "return", "exchange", "defect", "restock", "size", "etc"] as const;

export type PromptPolicy = { slug: string; kind: "always" | "topic" | "product"; title: string; description: string | null; content: string };

// "[확인 필요]" 가 붙은 줄은 아직 사실 확인 전이므로 AI 에 넘기지 않는다
export const usable = (content: string) =>
  content
    .split("\n")
    .filter((l) => !l.includes("[확인 필요]"))
    .join("\n")
    .trim();

export function policyBlock(policies: PromptPolicy[]) {
  const always = policies.filter((p) => p.kind === "always");
  const topics = policies.filter((p) => p.kind === "topic");
  // 상품별 정책은 고객이 보고 있는 상품에 맞는 것만 넘어온다 (activePolicies). 없으면 섹션도 넣지 않아 기존 프롬프트와 같다.
  const products = policies.filter((p) => p.kind === "product");
  const topicLine = (p: PromptPolicy) => `### [${p.slug}] ${p.title}${p.description ? ` — ${p.description}` : ""}\n${usable(p.content)}`;
  return [
    "## 항상 지킬 규칙",
    ...always.map((p) => `### ${p.title}\n${usable(p.content)}`),
    "## 주제별 정책 (topic id 는 [] 안의 값)",
    ...topics.map(topicLine),
    ...(products.length
      ? ["## 이 상품 전용 안내 (고객이 보고 있는 상품에만 해당. 주제별 정책과 다르면 이 안내가 우선. topic id 는 [] 안의 값)", ...products.map(topicLine)]
      : []),
  ].join("\n\n");
}

export const AnswerSchema = z.object({
  decision: z.enum(["answer", "handoff"]).describe("정책 문서만으로 정확히 답할 수 있으면 answer, 아니면 handoff"),
  topics_used: z.array(z.string()).describe("답변 근거로 쓴 주제 id(slug) 목록. 근거가 없으면 빈 배열"),
  answer: z.string().describe("고객에게 보낼 답변 (한국어). handoff 면 빈 문자열"),
  handoff_reason: z.string().describe("handoff 인 경우 이유 (내부용, 짧게)"),
  category: z.enum(CATEGORY_VALUES).describe("문의 유형"),
});

// 고객센터 운영 시간 (설정 → 영업 시간). 운영 시간 밖이면 문의 남기기 안내에 "다음 영업일" 을 붙이게 한다
export type HoursContext = { text: string; open: boolean };
const hoursLine = (h: HoursContext | null | undefined) =>
  !h
    ? ""
    : h.open
      ? `\n고객센터 운영 시간: ${h.text}. 지금은 운영 시간이야.`
      : `\n고객센터 운영 시간: ${h.text}. 지금은 운영 시간이 아니야 → 문의 남기기를 안내할 때는 "다음 영업일에 순서대로 답변드립니다"를 함께 말해.`;

export const SYSTEM = (policies: string, product: string | null, hours?: HoursContext | null) => `너는 ${BRAND_NAME} 자사몰(Cafe24)의 고객 문의 응답 도우미야.
브랜드를 부를 때 한국어 답변에서는 "${BRAND_NAME}", 영어 답변에서는 "${BRAND_NAME_EN}"라고 써. 임의로 줄여 부르지 마.
아래 "정책 문서"와 "상품 정보"에 적힌 내용만 근거로 답해. 문서에 없는 사실(날짜, 금액, 재고, 일정)은 절대 지어내지 마.
정확히 답할 근거가 없거나, 개인 주문의 확인·처리(취소 처리, 반품 접수, 환불 확정, 재발송 등)가 필요하면 decision 을 handoff 로 해.
주문 상태·송장 확인 질문이면 handoff 하지 말고, 위젯의 "주문·배송 조회" 버튼으로 바로 확인할 수 있다고 안내해 (근거 주제가 없으면 handoff).
판단 규칙:
- 일반 기준은 있는데 고객이 묻는 세부(금액, 날짜, 연락처 등)가 문서에 없으면: 아는 기준까지만 답하고, 모르는 부분은 "정확한 ○○은 '문의 남기기'로 남겨 주시면 담당자가 확인 후 안내드립니다"처럼 분명히 말해. 질문을 피해 다른 이야기로 채우지 마. 일반 기준조차 없으면 handoff 해.
- 이미 신청한 교환·반품·환불이 늦어지거나 처리 여부를 확인해 달라는 경우(수거가 안 옴, 환불이 안 됨, 교환 상품이 안 옴), 특정 날짜까지 보내 달라는 요청, 택배사 변경 같은 처리 요청은 handoff 해. 일반 배송 일정으로 답하지 마. 단, "수거는 언제 오나요"처럼 일반 절차를 묻는 것은 answer 해.
- "언제 받을 수 있나요" 같은 문의는 출고 기준과 소요 기간으로 answer 하되, 도착일을 약속하지 마.
- 고객이 "상담원 연결"을 함께 말해도, 문서로 답할 수 있는 일반 질문(재입고 알림, 반품 방법, 출고 기준 등)이면 answer 해.
- 방법·기간으로 안내할 수 있는 질문(반품·취소 방법, 환불 소요 기간)은 개인 주문 이야기가 섞여 있어도 answer 해. 처리를 약속하지만 않으면 돼.
- 상품 정보에 옵션별 재고가 있으면 묻지 않은 옵션 중 구매 가능한 것도 함께 알려줘.
답변은 3~6문장, "~습니다"체(해요체 아님), 정책 문서의 말투 규칙을 따라. 인사 다음 첫 문장에 결론("네, 가능합니다." / "아쉽게도 어렵습니다.")을 먼저 써. "네,"는 가능하거나 맞다는 답일 때만 붙여. 마지막 줄은 "감사합니다."로 끝내.
정책 문서에 금액·기간이 적혀 있으면 "확인이 어렵다"고 피하지 말고 그 숫자로 바로 안내해.
답변 형식 (위젯 말풍선에서 읽기 쉽게):
- 인사 문장 다음에는 빈 줄을 하나 넣고 본문을 시작해. (이어지는 대화라 인사를 하지 않으면 바로 본문)
- 본문은 내용별로 1~2문장씩 문단을 나누고, 문단 사이에 빈 줄을 넣어. 여러 내용을 한 문단에 이어 쓰지 마.
- 신청 방법·순서처럼 단계가 있으면 "1. ", "2. " 번호를 붙여 한 줄에 하나씩 써.
- 기간·금액·조건이 여러 개면 "- " 로 시작하는 짧은 줄로 나눠도 돼. 굵게(**) 같은 마크다운 기호는 쓰지 마.
고객에게 "정책 문서", "문서", "상품 정보", "근거" 같은 내부 용어를 쓰지 마. 상품 이야기는 "상품 상세페이지"라고 해.
모르는 부분은 "현재 바로 안내드리기 어렵습니다"라고 표현해.${hoursLine(hours)}

# 정책 문서
${policies}

# 상품 정보 (고객이 보고 있던 상품)
${product ?? "없음"}`;

// AI 대화 이어가기: 같은 대화의 앞선 문답을 맥락으로 붙인다 (최근 몇 개만, 길면 자른다).
// 앞선 답변도 근거가 아니라 "그럼", "그거" 가 무엇을 가리키는지 알기 위한 것이다. 이전 대화가 없으면 예전과 똑같은 프롬프트.
export type ChatTurn = { q: string; a: string | null };
export const HISTORY_TURNS = 4;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function customerPrompt(question: string, history: ChatTurn[] = []) {
  const recent = history.slice(-HISTORY_TURNS);
  if (!recent.length) return `고객 질문: ${question}`;
  // 이어지는 대화에서는 인사를 반복하지 않는다
  const lines = recent.map((t) => `고객: ${clip(t.q, 300)}\n답변: ${t.a ? clip(t.a, 600) : "(답하지 않고 문의 남기기로 안내함)"}`);
  return `# 이전 대화 (같은 고객과 방금 나눈 대화)
아래 대화는 지금 질문이 무엇을 가리키는지 파악하는 데만 써. 사실 근거는 여전히 정책 문서와 상품 정보뿐이야.
이미 안내한 내용을 그대로 반복하지 말고 이번에 새로 물은 부분에 답해. 앞에서 넘긴 질문이라도 이번 질문을 문서로 답할 수 있으면 answer 해.
이번 답변은 대화 중간이야: "안녕하세요" 같은 인사 없이 "네, 고객님." 한마디 뒤 결론부터 바로 써.

${lines.join("\n\n")}

고객 질문: ${question}`;
}

// 부분 답변에서 모르는 이유를 "정책 문서에 안내된 내용이 없어서"처럼 내부 용어로 붙이는 경우가 있다.
// 그대로 두면 FORBIDDEN 에 걸려 아는 부분까지 버려지므로 이유 구절만 지운다 ("○○은 지금 바로 안내드리기 어려워요"가 남는다).
// 사이에 다른 말이 낀 "상품 정보에 ○○가 없어" 는 고객용 표현 "상품 상세페이지에" 로 바꾼다.
// 프롬프트로 막으면 AI 가 지나치게 조심해져 답할 질문도 넘긴다
const INTERNAL_REASON =
  /(?:현재\s*)?(?:제가\s*)?(?:안내\s*|안내드릴\s*수\s*있는\s*)?(?:정책\s*)?(?:문서|상품\s*정보|정책\s*내용)(?:에|이)?\s*(?:는\s*)?(?:(?:관련|안내된|나와\s*있는|적힌|[가-힣]+)\s+)?(?:(?:안내|내용|정보|방법|시각|시간|기준|조건|일정|위치)[이가]\s*)?(?:(?:나와|안내되어|안내돼|적혀|명시되어)\s*있지\s*않아서?|없어서?|없으므로|없기\s*때문에)\s*,?\s*/g;

// 이유 구절 규칙이 놓친 표현("정책 문서상 확인이 어려워요", "정책 문서에 포함되어 있지 않아요" 등)은 그 문장만 통째로 지운다.
// 표현마다 규칙을 늘리지 않고, 나머지 아는 부분은 그대로 내보낸다. 다 지워져 빈 답이 되면 엔진이 문의로 넘긴다.
// "정책" 없이 "현재 문서에 발급 경로가 안내되어 있지 않아" 처럼 쓰는 경우도 있다.
const INTERNAL_TERM = /정책\s*(?:문서|자료)|문서\s*(?:에|상|로는)/;
const SENTENCE = /[^.!?。]+(?:[.!?。]+(?:\s*:\))?|$)/g;
const dropInternalSentences = (text: string) =>
  text
    .split("\n")
    .map((line) => (INTERNAL_TERM.test(line) ? (line.match(SENTENCE) ?? [line]).filter((s) => !INTERNAL_TERM.test(s)).map((s) => s.trim()).join(" ") : line))
    .join("\n");

// 모델이 형식 지시를 놓쳐도 말풍선이 한 덩어리로 보이지 않게: 마크다운 굵게 기호와 내부 이유 구절을 지우고,
// 줄바꿈이 하나도 없으면 인사 문장 뒤와 문장 2개마다 문단을 나눈다.
export function tidyAnswer(answer: string) {
  const cleaned = answer.replace(/\*\*(.+?)\*\*/g, "$1").replace(INTERNAL_REASON, "").replace(/상품\s*정보에/g, "상품 상세페이지에");
  const text = dropInternalSentences(cleaned).replace(/\n{3,}/g, "\n\n").trim();
  if (text.includes("\n")) return text;
  const sentences = text.match(SENTENCE)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  if (sentences.length < 3) return text;
  const greeting = /안녕하세요|^Hello/i.test(sentences[0]) ? [sentences.shift()!] : [];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) paragraphs.push(sentences.slice(i, i + 2).join(" "));
  return [...greeting, ...paragraphs].join("\n\n");
}
