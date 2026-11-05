-- AI 대화 이어가기 + 담당자 참여
-- 위젯에서 AI 와 여러 번 주고받은 대화를 한 묶음(ai_chats)으로 둔다. 각 문답은 지금처럼 ai_answers 한 줄 (chat_id 로 묶음).
-- 인박스 'AI 응대'는 문답이 아니라 대화 단위로 보여준다 (src/lib/ai-review.ts).
--  - last_seen_at: 위젯이 이 대화를 열어 두고 화면에 보일 때만 몇 초마다 갱신 → 1분 안이면 '대화 중'. 예전 단발 화면은 갱신하지 않음(null)
--  - conversation_id: 담당자가 참여(또는 답변 남기기)해 문의로 바뀐 경우. 그 뒤로 AI 는 이 대화에서 답하지 않는다
--  - review: 확인함(dismissed)/답변 남김(replied). 예전 ai_answers.review 를 대화 단위로 옮긴 것 (문답 쪽에도 같이 적어 둔다)

create table ai_chats (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  page_url        text,
  created_at      timestamptz not null default now(),
  last_turn_at    timestamptz not null default now(),
  last_seen_at    timestamptz,
  conversation_id uuid references conversations(id) on delete set null,
  joined_by       uuid references agents(id) on delete set null,
  joined_at       timestamptz,
  review          text check (review in ('dismissed', 'replied')),
  reviewed_at     timestamptz,
  reviewed_by     uuid references agents(id) on delete set null
);
create index ai_chats_activity_idx on ai_chats (last_turn_at desc);
create index ai_chats_contact_idx on ai_chats (contact_id, last_turn_at desc);
create index ai_chats_conversation_idx on ai_chats (conversation_id) where conversation_id is not null;

-- 비용 집계(ai_answers.cost_usd)는 고객이 지워져도 남아야 하므로 대화가 지워지면 연결만 끊는다
alter table ai_answers add column chat_id uuid references ai_chats(id) on delete set null;
create index ai_answers_chat_idx on ai_answers (chat_id, created_at) where chat_id is not null;

-- 지금까지의 고객 문답은 한 문답 = 한 대화. 대화 id 를 문답 id 와 같게 둬서 슬랙 링크(/ai?a=<id>)·알림 키가 그대로 맞는다
insert into ai_chats (id, contact_id, page_url, created_at, last_turn_at, review, reviewed_at, reviewed_by)
  select id, contact_id, page_url, created_at, created_at, review, reviewed_at, reviewed_by
  from ai_answers where kind = 'customer_answer' and contact_id is not null;
update ai_answers set chat_id = id where kind = 'customer_answer' and contact_id is not null;

alter table ai_chats enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on ai_chats from anon, authenticated;
  end if;
end $$;
