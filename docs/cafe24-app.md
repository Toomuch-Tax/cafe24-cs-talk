# Cafe24 앱 만들기

CS-Talk 은 쇼핑몰 하나에 붙는 **내 전용 Cafe24 앱**으로 동작합니다. 앱 스토어에 올릴 필요는 없습니다.
아래 순서는 Cafe24 개발자센터 화면 기준이며, 화면 이름은 Cafe24 사정에 따라 조금 다를 수 있습니다.

## 1. 앱 만들기

1. <https://developers.cafe24.com> 접속 → 로그인(쇼핑몰 운영자 계정이 아닌 **개발자 계정**, 없으면 가입)
2. 상단 **Apps** (앱 관리) → **앱 만들기**
3. 앱 이름: 아무거나 (예: `우리상점 CS`) · 앱 유형: 일반 앱

## 2. 앱 정보 입력

| 항목 | 값 |
|---|---|
| App URL | `<APP_ORIGIN>/settings` (예: `https://cs.myshop.com/settings`) |
| Redirect URI | `<APP_ORIGIN>/api/cafe24/callback` |
| 로컬에서도 연결해 보려면 Redirect URI 추가 | `http://localhost:3000/api/cafe24/callback` |

`APP_ORIGIN` 은 이 서비스를 배포한 주소입니다 ([deploy.md](deploy.md)).

## 3. 권한(Scope)

**권한 관리**에서 아래를 켭니다. 하나라도 빠지면 콘솔 설정 → Cafe24 연동에 "빠진 권한"이 표시됩니다.

| 권한 | 쓰는 곳 |
|---|---|
| 주문 (읽기) `mall.read_order` | 주문·배송 조회 |
| 회원 (읽기) `mall.read_customer` | 문의한 회원 정보 |
| 상품 (읽기) `mall.read_product` | AI 가 사이즈·재고 질문에 답할 때 |
| 디자인 (읽기) `mall.read_design` | 테스트 스킨 번호 찾기 |
| 앱 (읽기+쓰기) `mall.read_application` `mall.write_application` | 위젯 ScriptTag 자동 설치 |

## 4. 키 복사 → 환경변수

앱 상세의 **개발 정보**(또는 앱 정보)에서:

| Cafe24 | 환경변수 |
|---|---|
| 쇼핑몰 아이디 (`<몰아이디>.cafe24.com` 의 앞부분) | `CAFE24_MALL_ID` |
| Client ID | `CAFE24_CLIENT_ID` |
| Client Secret Key | `CAFE24_CLIENT_SECRET` |
| Service Key | `CAFE24_SERVICE_KEY` (로그인한 회원을 위조 없이 확인하는 데 씀) |

Vercel 이면 프로젝트 → Settings → Environment Variables 에 넣고 **다시 배포**합니다. 로컬이면 `.env.local` 에 넣고 `npm run dev` 를 다시 시작합니다.

## 5. 연결하고 위젯 설치

1. 콘솔 **설정 → Cafe24 연동 → Cafe24 연결**
2. Cafe24 로그인(쇼핑몰 **관리자** 계정) → 권한 승인 → 콘솔로 돌아오면 "연결됨"
3. **테스트 스킨 정하기** — Cafe24 관리자 → 디자인 → 디자인 보관함에서 테스트용으로 복사한 스킨의 번호(`skinNN`)를
   `NEXT_PUBLIC_CAFE24_TEST_SKIN_NO` 에 넣고 다시 배포
4. **테스트 (skinNN) → 설치** → "테스트 쇼핑몰 바로가기"로 열어서 위젯 확인
   (테스트 위젯은 `<쇼핑몰>/skin-skinNN/` 미리보기 화면에서만 보이고, 미공개 기능이 켜져 있습니다)
5. 괜찮으면 **전체 공개 → 설치**. 일반 쇼핑몰 주소에서 위젯이 보입니다.

연결은 Cafe24 Refresh Token(14일)으로 유지되며, 예약 작업이 만료 전에 자동으로 갱신합니다.
갱신이 실패하면 슬랙으로 재연결을 요청합니다.

## 자주 막히는 곳

- **redirect_uri 오류** — 개발자센터의 Redirect URI 와 `APP_ORIGIN` 이 글자 하나까지 같아야 합니다 (끝의 `/`, http/https).
- **위젯이 안 보임** — `WIDGET_ALLOWED_ORIGINS` / `NEXT_PUBLIC_WIDGET_ALLOWED_ORIGINS` 에 쇼핑몰 주소(`https://myshop.com`, `https://www.myshop.com`, `https://<몰아이디>.cafe24.com` 중 실제로 쓰는 것 모두)를 넣었는지 확인하세요.
- **test_skin_not_found** — `NEXT_PUBLIC_CAFE24_TEST_SKIN_NO` 번호의 스킨이 디자인 보관함에 있는지 확인하세요.
