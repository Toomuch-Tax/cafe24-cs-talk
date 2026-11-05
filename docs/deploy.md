# 배포하기 (Vercel + Supabase)

가장 손이 덜 가는 조합입니다. 둘 다 무료 요금제로 시작할 수 있고, 정식 운영 전에는 Supabase 를 유료(Pro)로 바꿔 일별 백업을 켜는 것을 권합니다.
다른 곳(Docker, 일반 서버)에서도 Node 22 + Postgres 만 있으면 `npm run build && npm start` 로 돌아갑니다. 이 경우 10분마다 `/api/cron/jobs` 를 `Authorization: Bearer <CRON_SECRET>` 헤더로 호출하는 예약 작업을 따로 만들어 주세요.

## 1. 저장소 준비

이 저장소를 내 GitHub 로 **Fork** 하거나 내려받아 새 저장소로 올립니다.

## 2. Vercel 프로젝트

1. <https://vercel.com/new> → 내 저장소 **Import**
2. Framework 는 Next.js 로 자동 인식됩니다. 아직 **Deploy 는 누르지 말고** 3단계로.
3. 서울 근처 사용자라면 `vercel.ts` 의 `regions: ["icn1"]` 를 그대로 두세요 (DB 도 서울에 만들 것).

## 3. Supabase (DB + 첨부 저장소)

1. Vercel 프로젝트 → **Storage → Create → Supabase** (Marketplace 연동). 지역은 Seoul(ap-northeast-2).
   연동하면 `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 등이 자동으로 환경변수에 들어갑니다.
2. 첨부 저장소(비공개 버킷 `attachments`)는 첫 업로드 때 앱이 알아서 만듭니다.

직접 Supabase 프로젝트를 만들었다면 위 값들을 Vercel 환경변수에 직접 넣으세요 (`DATABASE_URL` 은 Transaction pooler 6543 주소).

## 4. 환경변수

Vercel 프로젝트 → Settings → Environment Variables. `.env.example` 의 항목 중:

| 꼭 | 값 |
|---|---|
| `SESSION_SECRET`, `WIDGET_TOKEN_SECRET`, `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY` | 각각 `openssl rand -hex 32` (또는 로컬 `.env.local` 에 setup 이 만든 것과 **다른** 새 값) |
| `APP_ORIGIN` | 배포 주소, 예: `https://cs.myshop.com` |
| `NEXT_PUBLIC_BRAND_NAME` | 브랜드 이름 |
| `NEXT_PUBLIC_SHOP_URL` | 쇼핑몰 주소 |
| `WIDGET_ALLOWED_ORIGINS`, `NEXT_PUBLIC_WIDGET_ALLOWED_ORIGINS` | 쇼핑몰 주소들 (콤마 구분) |

Cafe24 값은 [cafe24-app.md](cafe24-app.md), 나머지(슬랙·구글 로그인·메일)는 필요할 때 넣습니다.
AI 응답은 Vercel 에서는 AI Gateway 가 자동으로 연결됩니다. Vercel 대시보드 → AI Gateway 에서 결제 수단·한도를 확인하세요.

## 5. 첫 배포 + DB 준비

1. **Deploy**
2. 내 컴퓨터에서 운영 DB 에 테이블과 예시 정책을 넣습니다:
   ```bash
   npx vercel@latest link
   npx vercel@latest env pull .env.production.local --environment production --yes
   npm run setup -- .env.production.local
   ```
   운영 DB 에는 개발용 계정을 만들지 않으므로, 안내대로 관리자 계정을 만듭니다:
   ```bash
   AGENT_PASSWORD='<비밀번호>' node --env-file=.env.production.local scripts/create-agent.mjs you@myshop.com 이름 admin
   ```
   `.env.production.local` 에는 운영 비밀값이 들어 있으니 커밋하지 말고(이미 .gitignore 됨) 끝나면 지워도 됩니다.
3. `<APP_ORIGIN>/login` 에서 로그인 → **설정 → 운영 상태**에서 DB·예약 작업·Cafe24·슬랙 상태 확인

## 6. 내 도메인 (선택)

Vercel 프로젝트 → Settings → Domains 에서 `cs.myshop.com` 추가 → DNS 에 안내된 레코드 추가.
주소를 바꾸면 `APP_ORIGIN`, Cafe24 Redirect URI, 구글 OAuth 리디렉션 URI 를 **먼저** 새 주소로 추가한 뒤 바꾸고, 위젯은 설정에서 다시 설치합니다.

## 업데이트

새 버전을 받은 뒤(`git pull upstream main` 등) 운영 DB 에 마이그레이션을 적용하고 배포합니다:

```bash
node --env-file=.env.production.local scripts/migrate.mjs
npx vercel@latest deploy --prod     # 또는 GitHub push 로 자동 배포
```

`src/app/globals.css` 를 바꾼 배포는 `--force` 로 빌드 캐시를 무시하세요 (옛 CSS 가 남는 경우가 있었습니다).
