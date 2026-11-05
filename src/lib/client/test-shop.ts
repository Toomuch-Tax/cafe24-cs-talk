// 테스트 위젯은 Cafe24 테스트 스킨에만 설치된다 (src/app/api/cafe24/scripttag/route.ts).
// 이 스킨은 몰 주소 뒤에 /skin-skin<번호>/ 를 붙여 미리보기로 열 수 있고, 그 화면에서만 테스트 위젯이 보인다.
import { SHOP_URL, TEST_SKIN_NO } from "@/lib/brand";

export { TEST_SKIN_NO };
export const testShopUrl = (skinNo: number = TEST_SKIN_NO) => `${SHOP_URL}/skin-skin${skinNo}/`;
