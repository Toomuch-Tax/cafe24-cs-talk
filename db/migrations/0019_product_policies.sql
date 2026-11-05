-- 상품별 응대 정책: 지정한 상품 페이지에서 받은 질문에만 붙는 정책 주제
-- (예: 특정 상품의 소재·세탁·핏 안내, 예약 판매 출고일, 이 상품만의 교환 조건)
alter table policy_topics drop constraint if exists policy_topics_kind_check;
alter table policy_topics add constraint policy_topics_kind_check check (kind in ('always', 'topic', 'product'));

-- [{ "no": 123, "name": "상품명" }] — 이름은 추가할 때의 표시용, 매칭은 no 로만 한다
alter table policy_topics add column if not exists products jsonb not null default '[]';
