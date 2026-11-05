import { categoryOf } from "@/components/widget/inquiry-fields";
import { linkAiAnswer } from "@/lib/ai-review";
import { fillMemberContact } from "@/lib/cafe24/customers";
import { createInquiry, listInquiries } from "@/lib/chat";
import { emailEnabled } from "@/lib/email";
import { isFeatureOn } from "@/lib/features";
import { sql } from "@/lib/db";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { NewInquiry, safePageUrl } from "@/lib/inquiry-api";
import { normalizeOrderId } from "@/lib/order-id";
import { formatPhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rate-limit";
import { getSetting } from "@/lib/settings";
import { requireVisitor, requireVisitorSession } from "@/lib/widget-token";

export const GET = handle(async (request: Request) => {
  const contactId = await requireVisitor(request);
  await rateLimit(`inq_list:${contactId}`, 60, 60);
  const [contact] = await sql<{ email: string | null }[]>`select email from contacts where id = ${contactId}`;
  // AI 에게 물은 뒤 답을 못 받은 고객은 상담원이 나중에 답할 수 있으니, 쇼핑몰 페이지에서 새 답변 배지를 계속 확인하게 한다
  const [ai] = await sql<{ pending: boolean }[]>`
    select exists (select 1 from ai_answers where contact_id = ${contactId} and kind = 'customer_answer'
      and conversation_id is null and review is null and created_at > now() - interval '14 days'
      and (decision <> 'answered' or feedback = 'not_helpful')) as pending`;
  return json({ inquiries: await listInquiries(contactId), email: contact?.email ?? null, watch: Boolean(ai?.pending) });
});

export const POST = handle(async (request: Request) => {
  const { contactId, env, memberId: sessionMemberId } = await requireVisitorSession(request);
  await rateLimit(`inq_new:${contactId}`, 10, 3600);
  const parsed = await parseBody(request, NewInquiry);
  // 주문번호 칸에 "모르는데" 같은 글이 오면 주문번호가 없는 것으로 본다 (인박스 주문 칸에 엉뚱한 값이 남지 않게)
  const body = { ...parsed, orderRef: normalizeOrderId(parsed.orderRef) };
  const [row] = await sql<{ verified_member_id: string | null; name: string | null; phone: string | null }[]>`
    select verified_member_id, name, phone from contacts where id = ${contactId}`;
  // 회원 분기는 이번 세션에서 회원 JWT 로 확인된 경우만 (로그아웃 상태면 비회원 규칙)
  const memberId = sessionMemberId && row?.verified_member_id === sessionMemberId ? sessionMemberId : null;
  const contact = row && { ...row, verified_member_id: memberId };
  // 비회원 답변 메일 주소는 선택 입력. 메일 기능이 꺼져 있거나 회원이면 받지 않는다 (쓰지 않는 개인정보 수집 방지)
  const acceptsEmail = emailEnabled() && isFeatureOn("replyEmail", env) && !contact?.verified_member_id;
  const email = acceptsEmail ? (body.email ?? null) : null;
  // 비회원은 주문을 찾아야 하는 유형에서 주문번호가 없을 때만 이름·휴대폰 필수 (회원은 쇼핑몰 정보로 확인되니 받지 않는다)
  const needsContact =
    isFeatureOn("guestContact", env) && !contact?.verified_member_id && categoryOf(body.category).needsOrder && !body.orderRef;
  const name = needsContact ? body.name : null;
  const phone = needsContact && body.phone ? formatPhone(body.phone) : null;
  if (needsContact && (!name || !phone)) throw new HttpError(400, "invalid_body");
  const result = await createInquiry(contactId, { ...body, email, name, phone, pageUrl: safePageUrl(body.pageUrl) });
  if (body.aiAnswerId && !result.duplicate) await linkAiAnswer(body.aiAnswerId, contactId, result.conversationId);
  // 회원은 묻지 않은 대신 쇼핑몰 회원 정보로 상담원 화면의 이름·휴대폰을 채운다 (실패해도 접수는 그대로)
  if (contact?.verified_member_id && !result.duplicate && (!contact.name || !contact.phone))
    await fillMemberContact(contactId, contact.verified_member_id);
  return json({
    conversationId: result.conversationId,
    message: result.message,
    sla: (await getSetting<string>("reply_sla")) ?? "영업일 기준 24시간 이내",
  });
});
