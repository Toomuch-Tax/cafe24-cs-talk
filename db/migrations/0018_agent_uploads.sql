-- 상담원 답변·내부 메모 사진 첨부
-- 상담원이 올린 사진도 uploads 에 두고(contact_id = 그 문의의 고객), 누가 올렸는지 agent_id 로 구분한다.
-- 고객은 agent_id 가 비어 있는 자기 업로드만, 상담원은 자기가 그 고객 문의에 올린 업로드만 메시지에 붙일 수 있다.
alter table uploads add column agent_id uuid references agents(id) on delete set null;
