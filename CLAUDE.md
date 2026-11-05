# CS-Talk — 작업 안내 (AI 코딩 도구·기여자용)

@AGENTS.md

- 고객용 위젯(`src/app/widget`, `public/widget.js`)과 운영 콘솔(`src/app/(console)`)이 한 Next.js 앱에 있다. 구조는 README 의 "구조" 표.
- 쇼핑몰마다 다른 값은 `src/lib/brand.ts`(환경변수)에서만 읽는다. 브랜드 이름·쇼핑몰 주소를 코드에 직접 쓰지 않는다.
- 위젯을 열기 전에는 API·DB 호출이 없어야 한다 (방문자 수에 비례해 비용이 늘지 않게).
- 고객용 API 에 상담원 정보(`agents`)를 붙이지 않는다. 고객에게 보이는 답변 주체는 설정의 고객 노출 이름·로고 하나.
- 브라우저가 준 `member_id` 는 힌트일 뿐 권한 근거가 아니다. 주문 정보는 Cafe24 서명 토큰으로 확인된 회원·주문번호 확인을 거친 건만.
- AI 는 정책 문서(`policy_topics`)와 상품 정보만 근거로 답한다. 환불·정품 판정 약속 금지는 프롬프트 + 서버 검사(`FORBIDDEN`) 둘 다로.
- 새 테이블은 RLS 를 켠다. 마이그레이션은 `db/migrations/NNNN_*.sql` 로 번호 순서대로 추가만 한다.
- 새 고객 화면 기능은 `src/lib/features.ts` 에 `test` 로 넣고 테스트 스킨에서 확인한 뒤 `live`.
- 비밀값을 코드·문서·커밋에 쓰지 않는다. `.env.local` 은 커밋 금지.
- 변경 후 `npm run check`.
