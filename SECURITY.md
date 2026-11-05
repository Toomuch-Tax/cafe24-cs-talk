# 보안 문제 알리기

고객 개인정보·주문 정보를 다루는 서비스라 보안 문제는 **공개 이슈로 올리지 말아 주세요.**
저장소의 **Security → Report a vulnerability** (비공개 신고)로 알려 주시면 확인 후 답변드립니다.

신고에 있으면 좋은 것: 영향받는 경로(예: `/api/widget/...`), 재현 순서, 예상 피해 범위.

## 설치해서 쓰는 분께

- `SESSION_SECRET` · `WIDGET_TOKEN_SECRET` · `CRON_SECRET` · `TOKEN_ENCRYPTION_KEY` 는 설치마다 새로 만드세요 (`npm run setup` 이 로컬용으로 만들어 줍니다. 운영용은 따로).
- `.env*` 파일과 DB 백업 덤프는 커밋하거나 공유 폴더에 두지 마세요.
- Supabase 를 쓴다면 새 테이블에 RLS 를 켜 두세요 (`db/migrations/0002_lock_down_public_api.sql`).
