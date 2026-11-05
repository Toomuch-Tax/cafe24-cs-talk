-- Phase 2: Cafe24 연동

-- 서버가 Cafe24 서명(JWT)으로 확인한 회원 ID. cafe24_member_id_hint(브라우저가 준 값)와 구분한다.
alter table contacts add column verified_member_id text;
alter table contacts add column member_verified_at timestamptz;
create index contacts_verified_member_idx on contacts (verified_member_id);

alter table contact_verifications drop constraint contact_verifications_method_check;
alter table contact_verifications add constraint contact_verifications_method_check
  check (method in ('cafe24_member_jwt', 'cafe24_oauth', 'order_otp'));

-- 관리자 OAuth CSRF 방지용 state (10분 유효, 1회용)
create table cafe24_oauth_states (
  state      text primary key,
  agent_id   uuid not null references agents(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table cafe24_tokens add column scopes text[] not null default '{}';
alter table cafe24_tokens add column connected_by uuid references agents(id) on delete set null;

-- 새 테이블도 공개 API 차단 (0002 와 같은 원칙)
alter table cafe24_oauth_states enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on cafe24_oauth_states from anon, authenticated;
  end if;
end $$;
