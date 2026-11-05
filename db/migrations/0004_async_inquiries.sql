-- 실시간 채팅 → 셀프서비스 + 비동기 문의 접수 방식으로 전환
-- status 의미: open = 답변 필요, waiting_customer = 답변 완료(고객 확인 대기), resolved = 종료

alter table contacts add column email text;

alter table conversations add column submitted_at timestamptz;      -- 고객이 "문의 남기기"로 접수한 시각 (null 이면 인박스에 안 보임)
alter table conversations add column order_ref text;                -- 고객이 적은 주문번호
alter table conversations add column last_agent_reply_at timestamptz;
create index conversations_submitted_idx on conversations (submitted_at) where submitted_at is not null;

-- 기존 대화는 모두 접수된 문의로 본다
update conversations set submitted_at = created_at where submitted_at is null;

-- 셀프서비스(주문 조회 등) 사용 기록: 자동화로 해결된 비율(KPI) 측정용. 개인정보는 남기지 않는다.
create table self_service_events (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete set null,
  kind       text not null,   -- order_status_member, order_status_guest, inquiry_started ...
  result     text not null,   -- found, not_found, error
  created_at timestamptz not null default now()
);
create index self_service_events_created_idx on self_service_events (created_at);

insert into settings (key, value) values
  ('reply_sla', '"영업일 기준 24시간 이내"'),
  ('auto_close_days', '7')
on conflict (key) do nothing;

alter table self_service_events enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on self_service_events from anon, authenticated;
  end if;
end $$;
