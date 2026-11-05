// 쇼핑몰마다 다른 값(브랜드 이름·쇼핑몰 주소·테스트 스킨 번호)을 한곳에서 읽는다.
// NEXT_PUBLIC_* 는 빌드할 때 화면 코드에도 들어가므로 서버·브라우저 어디서나 쓸 수 있다.
// 값을 바꾸면 다시 빌드(배포)해야 화면에 반영된다.

const env = (v: string | undefined) => v?.trim() || undefined;

/** 고객에게 보이는 브랜드 이름 (한국어 답변용). 예: "우리상점" */
export const BRAND_NAME = env(process.env.NEXT_PUBLIC_BRAND_NAME) ?? "우리 쇼핑몰";

/** 영어 답변에 쓰는 브랜드 이름. 비우면 BRAND_NAME 그대로 */
export const BRAND_NAME_EN = env(process.env.NEXT_PUBLIC_BRAND_NAME_EN) ?? BRAND_NAME;

/** 고객 화면·메일의 기본 답변 주체 이름 (설정 → 고객 노출 정보에서 바꿀 수 있다) */
export const SUPPORT_NAME = `${BRAND_NAME} 고객센터`;

/** 운영 콘솔 탭 제목 등에 쓰는 서비스 이름 */
export const APP_NAME = env(process.env.NEXT_PUBLIC_APP_NAME) ?? "CS-Talk";

/** 쇼핑몰 주소 (끝에 / 없이). 예: https://myshop.com 또는 https://<몰아이디>.cafe24.com */
export const SHOP_URL = (env(process.env.NEXT_PUBLIC_SHOP_URL) ?? "https://example.cafe24.com").replace(/\/+$/, "");

/** 쇼핑몰 주소의 호스트만 (예: myshop.com) — 화면 안내 문구용 */
export const SHOP_HOST = (() => {
  try {
    return new URL(SHOP_URL).host;
  } catch {
    return SHOP_URL;
  }
})();

/**
 * 테스트 위젯을 붙일 Cafe24 스킨 번호. 이 스킨은 <쇼핑몰>/skin-skin<번호>/ 로 미리보기할 수 있고,
 * 그 화면에서만 테스트 위젯과 미공개 기능이 보인다. (Cafe24 관리자 → 디자인 → 디자인 보관함에서 번호 확인)
 */
export const TEST_SKIN_NO = Number(env(process.env.NEXT_PUBLIC_CAFE24_TEST_SKIN_NO) ?? env(process.env.CAFE24_TEST_SKIN_NO) ?? 2);
