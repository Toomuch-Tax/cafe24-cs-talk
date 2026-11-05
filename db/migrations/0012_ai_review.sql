-- AI 응대 확인
-- 고객이 AI 답을 받지 못하고 떠난 문답을 인박스 'AI 응대 > 확인 필요'로 모은다. 새 테이블 없이 ai_answers 에 상태만 추가.
-- conversation_id: 고객용 문답(customer_answer)에서는 '이어진 문의'. 고객이 그 문답에서 문의를 남겼거나 상담원이 답변해 문의로 만든 경우.

alter table ai_answers add column category text;          -- AI 가 고른 문의 유형 (문의로 만들 때 그대로 씀)
alter table ai_answers add column page_url text;          -- 질문한 쇼핑몰 페이지
alter table ai_answers add column feedback_at timestamptz;
alter table ai_answers add column review text check (review in ('dismissed', 'replied'));
alter table ai_answers add column reviewed_at timestamptz;
alter table ai_answers add column reviewed_by uuid references agents(id) on delete set null;

-- 확인 필요 목록·건수 조회용 (고객 문답 중 아직 처리 안 된 것)
create index ai_answers_review_idx on ai_answers (created_at desc)
  where kind = 'customer_answer' and review is null and conversation_id is null;
create index ai_answers_contact_idx on ai_answers (contact_id, created_at desc) where kind = 'customer_answer';
