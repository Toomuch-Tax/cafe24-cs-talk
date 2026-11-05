-- CS-Talk 초기 스키마
-- 모든 테이블은 서버(API Route)에서만 접근한다. 브라우저는 DB에 직접 붙지 않는다.

create extension if not exists pgcrypto;

-- 상담원 ------------------------------------------------------------------
create table agents (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  password_hash text not null,
  role          text not null default 'agent' check (role in ('admin', 'agent')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- 방문자/고객 --------------------------------------------------------------
-- cafe24_member_id_hint 는 브라우저가 알려준 값이라 권한 근거로 쓰지 않는다.
create table contacts (
  id                    uuid primary key default gen_random_uuid(),
  cafe24_member_id_hint text,
  name                  text,
  phone                 text,
  locale                text not null default 'ko-KR',
  timezone              text not null default 'Asia/Seoul',
  last_page_url         text,
  last_seen_at          timestamptz,
  created_at            timestamptz not null default now()
);

-- 대화 ---------------------------------------------------------------------
create table conversations (
  id                    uuid primary key default gen_random_uuid(),
  contact_id            uuid not null references contacts(id) on delete cascade,
  status                text not null default 'open'
                        check (status in ('open', 'waiting_customer', 'resolved')),
  handling_mode         text not null default 'human' check (handling_mode in ('ai', 'human')),
  assigned_agent_id     uuid references agents(id) on delete set null,
  priority              text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  category              text check (category in ('shipping', 'exchange', 'return', 'size', 'defect', 'etc')),
  customer_last_read_at timestamptz,
  agent_last_read_at    timestamptz,
  typing_agent_id       uuid references agents(id) on delete set null,
  typing_at             timestamptz,
  last_message_at       timestamptz not null default now(),
  last_message_preview  text,
  last_customer_message_at timestamptz,
  first_agent_reply_at  timestamptz,
  page_url              text,
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz
);
create index conversations_contact_idx on conversations (contact_id, created_at desc);
create index conversations_inbox_idx on conversations (status, last_message_at desc);

-- 메시지 -------------------------------------------------------------------
-- seq: polling 커서. client_message_id: 재시도 시 중복 저장 방지.
create table messages (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity unique,
  conversation_id   uuid not null references conversations(id) on delete cascade,
  sender_type       text not null check (sender_type in ('customer', 'agent', 'ai', 'system')),
  agent_id          uuid references agents(id) on delete set null,
  body              text not null default '',
  attachments       jsonb not null default '[]'::jsonb,
  internal          boolean not null default false, -- 내부 메모: 고객에게 절대 노출하지 않음
  ai_kind           text check (ai_kind in ('auto_sent', 'draft')),
  client_message_id text,
  created_at        timestamptz not null default now(),
  unique (conversation_id, client_message_id)
);
create index messages_conversation_seq_idx on messages (conversation_id, seq);

-- 대화 이력 (배정·상태·이관) -----------------------------------------------
create table conversation_events (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  agent_id        uuid references agents(id) on delete set null,
  type            text not null,
  data            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index conversation_events_conv_idx on conversation_events (conversation_id, created_at);

-- 고객 본인 인증 (Phase 2) -------------------------------------------------
create table contact_verifications (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  method      text not null check (method in ('cafe24_oauth', 'order_otp')),
  member_id   text,
  order_id    text,
  verified_at timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index contact_verifications_contact_idx on contact_verifications (contact_id, expires_at desc);

-- 알림 작업 (Phase 4) ------------------------------------------------------
create table notification_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,               -- slack_new, slack_handoff, alimtalk_reply ...
  dedupe_key    text not null unique,
  conversation_id uuid references conversations(id) on delete cascade,
  payload       jsonb not null default '{}'::jsonb,
  run_at        timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts      int not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index notification_jobs_pending_idx on notification_jobs (status, run_at);

-- AI 사용량 (Phase 3) ------------------------------------------------------
create table ai_usage_logs (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete set null,
  model           text not null,
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  tool_calls      int not null default 0,
  cost_usd        numeric(10, 6),
  outcome         text, -- resolved / handoff / draft
  created_at      timestamptz not null default now()
);

-- 지식 데이터 --------------------------------------------------------------
create table faq_articles (
  id         uuid primary key default gen_random_uuid(),
  category   text,
  question   text not null,
  answer     text not null,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

create table quick_replies (
  id         uuid primary key default gen_random_uuid(),
  shortcut   text not null unique,  -- 예: 배송, 교환
  title      text not null,
  body       text not null,
  updated_at timestamptz not null default now()
);

create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Cafe24 토큰 (Phase 2) — 값은 애플리케이션에서 암호화해 저장 --------------
create table cafe24_tokens (
  mall_id                  text primary key,
  access_token_enc         text not null,
  refresh_token_enc        text not null,
  access_expires_at        timestamptz not null,
  refresh_expires_at       timestamptz not null,
  refreshing_until         timestamptz, -- 갱신 잠금
  updated_at               timestamptz not null default now()
);

-- 간단한 rate limit 카운터 (인스턴스 간 공유) -------------------------------
create table rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (bucket, window_start)
);

insert into settings (key, value) values
  ('business_hours', '{"timezone":"Asia/Seoul","days":[1,2,3,4,5],"start":"10:00","end":"18:00","lunch":{"start":"12:00","end":"13:00"}}'),
  ('greeting', '"안녕하세요, 고객센터입니다. 무엇을 도와드릴까요?"'),
  ('away_message', '"지금은 상담 운영시간이 아니에요. 남겨주신 문의는 운영시간(평일 10:00–18:00)에 순서대로 답변드릴게요."');

insert into quick_replies (shortcut, title, body) values
  ('배송', '배송 기간 안내', '결제 완료 후 영업일 기준 1–3일 내 출고되며, 출고 후 1–2일 내 받아보실 수 있어요.'),
  ('교환', '교환 접수 안내', '상품 수령 후 7일 이내 마이페이지 > 주문내역에서 교환 신청이 가능해요. 사이즈 교환은 재고가 있는 경우에만 가능합니다.'),
  ('반품', '반품 접수 안내', '상품 수령 후 7일 이내 마이페이지 > 주문내역에서 반품 신청이 가능해요. 단순 변심의 경우 왕복 배송비가 부과됩니다.'),
  ('재입고', '재입고 안내', '해당 상품은 재입고 일정을 확인 중이에요. 상품 페이지의 재입고 알림을 신청해주시면 입고 시 바로 안내드릴게요.');
