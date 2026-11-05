import { z } from "zod";
import { verifyMemberJwt } from "@/lib/cafe24/member-jwt";
import { attachmentsAvailable } from "@/lib/attachments";
import { emailEnabled } from "@/lib/email";
import { isFeatureOn } from "@/lib/features";
import { sql } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getPublicProfile } from "@/lib/profile";
import { businessHoursNow, getSetting } from "@/lib/settings";
import { signVisitorToken, verifyVisitorToken } from "@/lib/widget-token";

const Body = z.object({
  token: z.string().max(2000).nullish(),
  pageUrl: z.string().max(2000).nullish(),
  memberIdHint: z.string().max(100).nullish(),
  // CAFE24API.getEncryptedMemberId 결과 (로그인한 회원만)
  memberToken: z.string().max(4000).nullish(),
  // 테스트 스킨에 설치된 widget.js 가 보낸다. 미공개 기능 노출용이라 서명만 하고 별도 검증은 하지 않는다.
  env: z.enum(["live", "test"]).nullish(),
});

type Contact = { id: string; verified_member_id: string | null };

// 고객이 채팅창을 처음 열 때만 호출된다 (버튼 노출만으로는 DB 기록 없음).
export const POST = handle(async (request: Request) => {
  await rateLimit(`session:${clientIp(request)}`, 30, 60);
  const body = await parseBody(request, Body);
  const pageUrl = body.pageUrl && /^https?:\/\//i.test(body.pageUrl) ? body.pageUrl : null;
  const env = body.env ?? "live";
  const member = body.memberToken ? verifyMemberJwt(body.memberToken) : null;

  let contact: Contact | null = null;
  const contactId = await verifyVisitorToken(body.token);
  if (contactId) {
    [contact] = await sql<Contact[]>`select id, verified_member_id from contacts where id = ${contactId}`;
  }

  if (member) {
    // 같은 브라우저를 다른 회원이 쓰면 대화를 섞지 않고 새 고객으로 분리한다
    if (contact?.verified_member_id && contact.verified_member_id !== member.memberId) contact = null;

    // 이 회원의 고객 기록이 이미 있으면(다른 기기, 또는 로그아웃 동안 비회원으로 분리됐다가 다시 로그인) 그쪽으로 이어 붙인다.
    // 비회원 기록에 대화가 있어도 회원 기록을 우선한다 (공용 PC 의 다른 사람이 남긴 문의를 이 회원으로 인증하지 않게).
    if (!contact?.verified_member_id) {
      const [existing] = await sql<Contact[]>`
        select id, verified_member_id from contacts where verified_member_id = ${member.memberId}
        order by last_seen_at desc nulls last limit 1`;
      if (existing) contact = existing;
    }
  } else if (contact?.verified_member_id) {
    // 회원 토큰 없이 열렸는데(로그아웃·공용 PC) 회원 인증된 기록이면 이어 쓰지 않는다.
    // 그 회원의 대화·주문이 보이지 않게 새 비회원 고객으로 분리하고, 다시 로그인하면 위에서 회원 기록으로 돌아간다.
    contact = null;
  }

  if (!contact) {
    [contact] = await sql<Contact[]>`insert into contacts default values returning id, verified_member_id`;
  }

  await sql`
    update contacts set last_seen_at = now(), last_page_url = ${pageUrl},
      cafe24_member_id_hint = coalesce(${body.memberIdHint ?? null}, cafe24_member_id_hint)
    where id = ${contact.id}`;

  if (member) {
    await sql`update contacts set verified_member_id = ${member.memberId}, member_verified_at = now()
      where id = ${contact.id}`;
    await sql`
      insert into contact_verifications (contact_id, method, member_id, expires_at)
      values (${contact.id}, 'cafe24_member_jwt', ${member.memberId}, ${member.expiresAt})`;
  }

  return json({
    token: await signVisitorToken(contact.id, env, member?.memberId ?? null),
    // 고객센터 운영 시간 안내 (설정 → 영업 시간)
    hours: await businessHoursNow(),
    sla: (await getSetting<string>("reply_sla")) ?? "영업일 기준 24시간 이내",
    greeting: (await getSetting<string>("greeting")) ?? "무엇을 도와드릴까요?",
    // 답변 주체 이름·로고 (상담원·AI 답변 공통)
    profile: await getPublicProfile(),
    env,
    member: Boolean(member),
    // 이메일은 비회원에게만 받는다 (회원은 위젯 배지·내 문의로 확인)
    emailEnabled: emailEnabled() && isFeatureOn("replyEmail", env) && !member,
    // 사진 첨부는 저장소가 연결돼 있을 때만 (미공개 기능 여부는 위젯이 env 로 따로 확인)
    attachments: attachmentsAvailable(),
  });
});
