// 빠른 답변(매크로) 예시를 넣는다. 인박스 답변 창에서 "/단축어"로 불러 쓴다.
// 건마다 바꿀 부분은 {상품명} 처럼 중괄호 — 답변 창에서 Tab 으로 빈칸을 옮겨 다니며 채운다.
// 같은 단축어가 이미 있으면 건너뛴다 (화면에서 고친 내용을 덮어쓰지 않음). 내 쇼핑몰 기준으로 설정 → 빠른 답변에서 고쳐 쓴다.
// 사용: node --env-file=.env.local scripts/seed-quick-replies.mjs            ← 추가될 것만 출력
//       node --env-file=.env.local scripts/seed-quick-replies.mjs --apply    ← 저장
import postgres from "postgres";
import { isLocalDb } from "./db-url.mjs";

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "우리 쇼핑몰";
const GREET = `안녕하세요 고객님, ${BRAND}입니다.`;

export const MACROS = [
  {
    shortcut: "반품접수",
    title: "반품 접수 완료",
    body: `네, 고객님 확인 감사합니다.
요청 주신 반품 접수를 완료했습니다.

■ 접수 내역
{상품명} ({컬러}/{사이즈})

■ 진행 안내
상품을 봉투에 포장해 문 앞에 내어 두시면, 택배 기사님이 1~3일 이내 방문해 수거해 가십니다.
상품이 도착해 검수가 끝나면 최초 결제 수단으로 환불됩니다.

감사합니다.`,
  },
  {
    shortcut: "교환접수",
    title: "교환 접수 완료",
    body: `네, 고객님 확인 감사합니다.
요청 주신 교환 접수를 완료했습니다.

■ 접수 내역
{상품명} ({기존 옵션}) → ({교환 옵션})

기존 상품이 도착해 검수가 끝나면 교환 상품이 출고됩니다.

감사합니다.`,
  },
  {
    shortcut: "출고안내",
    title: "출고 완료 안내",
    body: `${GREET}

주문하신 상품은 {출고일}에 출고되었습니다.
위젯의 "주문·배송 조회"에서 배송 상태를 확인하실 수 있습니다.

감사합니다.`,
  },
  {
    shortcut: "재입고확인",
    title: "재입고 여부 확인 중",
    body: `${GREET}

문의 주신 상품은 현재 재입고 여부를 확인하고 있습니다.
상품 페이지에서 재입고 알림을 신청해 주시면 입고 시 바로 알림을 받아 보실 수 있습니다.

감사합니다.`,
  },
  {
    shortcut: "재입고없음",
    title: "재입고 예정 없음",
    body: `${GREET}

문의 주신 상품은 추가 재입고 예정이 없습니다.
현재 남아 있는 {남은 사이즈} 사이즈 재고가 소진되면 판매가 종료되는 점 안내드립니다.

감사합니다.`,
  },
  {
    shortcut: "출고후취소",
    title: "출고 이후 취소 요청",
    body: `${GREET}

주문하신 상품은 이미 출고되어 주문 취소가 어려운 상태입니다.
상품을 받으신 뒤 마이페이지에서 반품을 신청해 주시면 안내에 따라 진행됩니다.

원하시는 방향으로 도와드리지 못해 죄송합니다.
감사합니다.`,
  },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const apply = process.argv.includes("--apply");
  const url = (process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL).split("?")[0];
  const sql = postgres(url, { max: 1, ssl: isLocalDb(url) ? false : "require" });
  try {
    console.log(`DB: ${new URL(url).host}${apply ? "" : "  (미리보기 — 저장하려면 --apply)"}`);
    const existing = new Set((await sql`select shortcut from quick_replies`).map((r) => r.shortcut));
    for (const m of MACROS) {
      if (existing.has(m.shortcut)) {
        console.log(`= /${m.shortcut}: 이미 있음 (건너뜀)`);
        continue;
      }
      console.log(`+ /${m.shortcut} · ${m.title}`);
      if (apply) await sql`insert into quick_replies (shortcut, title, body) values (${m.shortcut}, ${m.title}, ${m.body})`;
    }
  } finally {
    await sql.end();
  }
}
