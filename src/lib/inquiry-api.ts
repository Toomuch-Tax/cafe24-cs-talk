import { z } from "zod";
import { MAX_PER_MESSAGE } from "./attachments";
import { CATEGORIES } from "./chat";
import { PHONE } from "./phone";

// 업로드(/api/widget/attachments)에서 받은 id. 본인 업로드인지는 저장할 때 확인한다.
const AttachmentIds = z.array(z.string().uuid()).max(MAX_PER_MESSAGE).default([]);

// 위젯·이메일 링크 공용 입력 형식
export const NewInquiry = z.object({
  clientMessageId: z.string().min(8).max(64),
  body: z.string().trim().min(2).max(3000),
  category: z.enum(CATEGORIES),
  orderRef: z.string().trim().max(40).nullish(),
  // 이메일 답변이 꺼져 있으면 받지 않는다 (쓰지 않는 개인정보 수집 방지)
  email: z.string().trim().email().max(200).nullish(),
  // 비회원 연락처 (guestContact 기능이 켜졌고, 주문 관련 유형에서 주문번호가 없을 때만 받는다)
  name: z.string().trim().min(1).max(50).nullish(),
  phone: z.string().trim().regex(PHONE).nullish(),
  pageUrl: z.string().max(2000).nullish(),
  attachments: AttachmentIds,
  // "AI에게 물어보기"에서 넘어온 문의면 그 문답 id (인박스 AI 응대와 연결)
  aiAnswerId: z.string().uuid().nullish(),
});

// 사진만 보내는 것도 허용 (내용 또는 사진 중 하나는 있어야 함)
export const Reply = z
  .object({
    clientMessageId: z.string().min(8).max(64),
    body: z.string().trim().max(3000),
    attachments: AttachmentIds,
  })
  .refine((r) => r.body.length > 0 || r.attachments.length > 0);

export const safePageUrl = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);
