-- AI 응답 정책: 주제별 문서 + 버전 히스토리 + AI 응답 기록

-- 주제 (예: 배송 일정, 반품 정책, 말투, 금지·이관 규칙)
create table policy_topics (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  title              text not null,
  description        text,
  -- always: 모든 응답에 항상 포함 (말투, 금지 규칙) / topic: 질문과 관련 있을 때만 포함
  kind               text not null default 'topic' check (kind in ('always', 'topic')),
  -- auto: 고객에게 AI 가 바로 답함 / draft: 상담원 초안에만 사용 / off: 사용 안 함
  ai_mode            text not null default 'draft' check (ai_mode in ('auto', 'draft', 'off')),
  categories         text[] not null default '{}',   -- 연결된 문의 유형 (shipping, return ...)
  sort_order         int not null default 0,
  current_version_id uuid,
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 버전: 저장할 때마다 새 버전. 되돌리기도 "이전 내용으로 새 버전"을 만든다 (히스토리가 지워지지 않음)
create table policy_versions (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references policy_topics(id) on delete cascade,
  version     int not null,
  content     text not null,
  change_note text,
  created_by  uuid references agents(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (topic_id, version)
);
alter table policy_topics add constraint policy_topics_current_version_fk
  foreign key (current_version_id) references policy_versions(id) on delete set null;

-- AI 응답 기록: 어떤 질문에 어떤 정책 버전으로 답했는지 추적 (정책 개선·비용 관리용)
create table ai_answers (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('customer_answer', 'agent_draft', 'test')),
  contact_id      uuid references contacts(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  agent_id        uuid references agents(id) on delete set null,
  question        text not null,
  answer          text,
  decision        text not null check (decision in ('answered', 'handoff', 'blocked', 'error')),
  reason          text,
  topic_ids       uuid[] not null default '{}',
  version_ids     uuid[] not null default '{}',
  model           text,
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  cost_usd        numeric(12, 8) not null default 0,
  latency_ms      int,
  feedback        text check (feedback in ('helpful', 'not_helpful')),
  created_at      timestamptz not null default now()
);
create index ai_answers_created_idx on ai_answers (created_at desc);

insert into settings (key, value) values
  ('ai_enabled', 'true'),
  ('ai_monthly_budget_usd', '10')
on conflict (key) do nothing;

alter table policy_topics enable row level security;
alter table policy_versions enable row level security;
alter table ai_answers enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on policy_topics, policy_versions, ai_answers from anon, authenticated;
  end if;
end $$;
