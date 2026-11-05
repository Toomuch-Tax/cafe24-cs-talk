import { sql } from "../db";
import { captureError } from "../errors";
import { formatPhone, PHONE } from "../phone";
import { latestBuyer } from "./orders";

// 서명으로 확인된 회원의 이름·휴대폰을 상담원 화면 연락처 칸에 채운다 — 최근 주문의 주문자 정보로.
// 회원 개인정보 API(/customersprivacy)는 개인정보(Privacy) 권한이 필요한데 개발자센터에서 고를 수 없어
// 403 insufficient_scope 만 쌓였으므로 부르지 않는다 (2026-10-25). 주문 이력이 없는 회원은 상담원이 직접 적는다.
// 비어 있는 칸만 채운다 (상담원이 고친 값은 덮어쓰지 않음). 채웠으면 true.
export async function fillMemberContact(contactId: string, memberId: string) {
  try {
    const found = await latestBuyer(memberId);
    if (!found) return false;
    const name = found.name?.trim().slice(0, 50) || null;
    const phone = found.phone && PHONE.test(found.phone.replace(/\s/g, "")) ? formatPhone(found.phone) : null;
    if (!name && !phone) return false;
    const rows = await sql`update contacts set name = coalesce(name, ${name}), phone = coalesce(phone, ${phone})
      where id = ${contactId} and verified_member_id = ${memberId}
        and ((name is null and ${name}::text is not null) or (phone is null and ${phone}::text is not null))
      returning id`;
    return rows.length > 0;
  } catch (err) {
    captureError({ source: "external", where: "cafe24 fillMemberContact", area: "order", err });
    return false;
  }
}
