-- 운영 개선 루프: 오류 기록 + 핵심 행동 기록 + 개선 후보·시도 이력 (설정 → 운영 개선, 관리자 전용)
-- - 오류는 같은 종류를 한 행(error_groups)에 모으고, 기간별 비교를 위해 날짜별 횟수(error_daily)를 따로 센다
-- - 행동 기록(usage_events)은 몇 가지 이벤트만, props 는 enum·bool 만 담는다 (자유 입력·경로·연락처 없음)
-- - 개선 후보(improvement_candidates)는 cron 이 만들고, 고치는 쪽이 선점·기록한다
-- 보관: ops.ts cleanup() 이 정리한다 (행동 180일, 오류 처리 후·무재발 90일, 끝난 후보 180일)

create table error_groups (
  id           uuid primary key default gen_random_uuid(),
  env          text not null check (env in ('live', 'test', 'dev')),
  fingerprint  text not null,
  source       text not null check (source in ('server', 'external', 'render', 'cron', 'client_widget', 'client_console')),
  where_       text not null,                 -- 라우트 템플릿(/api/inbox/conversations/[id]) 또는 화면·작업 이름
  area         text not null default 'other' check (area in ('order', 'ai', 'widget', 'inbox', 'cron', 'other')),
  code         text,
  status       int,
  message      text not null,                 -- 정제 후 500자
  stack        text,                          -- 정제 후 2000자
  count        int not null default 1,
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  first_release text,
  last_release text,
  resolved_at  timestamptz,
  resolved_by  uuid
);
-- 미해결은 종류당 한 행. 처리 완료 뒤 다시 나면 새 행(재발)으로 쌓인다
create unique index error_groups_open_idx on error_groups (env, fingerprint) where resolved_at is null;
create index error_groups_last_idx on error_groups (last_at desc);

create table error_daily (
  group_id uuid not null references error_groups(id) on delete cascade,
  day      date not null,                     -- KST 날짜
  count    int not null default 0,
  primary key (group_id, day)
);

create table usage_events (
  id              bigserial primary key,
  event_id        uuid not null unique,       -- 재전송 중복 방지
  occurred_at     timestamptz not null,
  created_at      timestamptz not null default now(),
  actor           text not null check (actor in ('customer', 'agent')),
  name            text not null,
  contact_id      uuid,
  agent_id        uuid,
  conversation_id uuid,
  env             text not null default 'live' check (env in ('live', 'test', 'dev')),
  props           jsonb not null default '{}'::jsonb
);
create index usage_events_name_idx on usage_events (name, occurred_at desc);
create index usage_events_contact_idx on usage_events (contact_id, occurred_at desc);

create table improvement_candidates (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('error', 'ai_unanswered', 'order_lookup')),
  key             text not null unique,       -- error:<group id> / ai:<category>:<reason> / order:<who>:<code>
  title           text not null,
  area            text not null default 'other',
  count_7d        int not null default 0,     -- 최근 7일 실패·미답변·오류 수
  attempts_7d     int,                        -- 같은 기간 해당 작업의 시도 수(분모), 없으면 null
  evidence        jsonb not null default '{}'::jsonb,
  status          text not null default 'open' check (status in
                    ('open', 'in_progress', 'fix_ready', 'needs_decision', 'deployed', 'verified', 'regressed', 'dismissed')),
  run_id          text,
  claimed_at      timestamptz,
  fail_count      int not null default 0,
  last_failure    text,
  next_attempt_at timestamptz,
  branch          text,
  deployed_at     timestamptz,
  fix_release     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index improvement_candidates_status_idx on improvement_candidates (status, count_7d desc);

create table improvement_attempts (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references improvement_candidates(id) on delete cascade,
  run_id         text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  outcome        text check (outcome in ('fix_ready', 'needs_decision', 'failed', 'skipped')),
  hypothesis     text,                        -- 원인이라고 판단한 것 (재시도면 새 근거 포함)
  change_summary text,
  branch         text,
  commit         text,
  checks         jsonb,                       -- npm run check · QA · 재현 결과
  review         jsonb,                       -- Codex 검토 결과
  post_deploy    jsonb,                       -- 배포 후 효과 확인 결과
  failure_reason text
);
create index improvement_attempts_candidate_idx on improvement_attempts (candidate_id, started_at desc);

alter table error_groups enable row level security;
alter table error_daily enable row level security;
alter table usage_events enable row level security;
alter table improvement_candidates enable row level security;
alter table improvement_attempts enable row level security;
