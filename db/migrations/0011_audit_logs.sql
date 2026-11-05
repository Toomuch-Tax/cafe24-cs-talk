-- 운영 콘솔 변경 이력 + 로그인 기록 (설정 → 변경 이력, 관리자 전용)
-- - 누가 했는지는 이름·이메일을 그때 값으로 같이 남긴다 (FK 없음 → 계정을 지워도 기록이 그대로 남고, 기록이 바뀌지 않음)
-- - 기록은 고치거나 지울 수 없다. 보관 기간이 지난 행만 정리 크론이 지운다 (변경 1년, 로그인 90일)
-- - 비밀번호·토큰 값은 남기지 않는다. changes 에는 화면에 보여줄 문구(바뀌기 전·후)만 담는다.

create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  actor_name  text,
  actor_email text,
  area        text not null check (area in ('widget', 'users', 'security', 'settings', 'ai')),
  action      text not null,                     -- users.role, widget.install ... (검색·집계용)
  title       text not null,                     -- 목록 한 줄 ("박지수 님 역할 변경")
  changes     jsonb not null default '[]'::jsonb, -- [{ label, before?, after }]
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on audit_logs (created_at desc);

create table login_events (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid,
  agent_name text,
  email      text,
  method     text not null check (method in ('google', 'password')),
  ok         boolean not null,
  reason     text,          -- 실패 사유: wrong_password, unknown_account, no_password, disabled, pending, domain, password_disabled
  ip         text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index login_events_created_idx on login_events (created_at desc);
create index login_events_agent_idx on login_events (agent_id, created_at desc) where ok;

alter table audit_logs enable row level security;
alter table login_events enable row level security;

create function audit_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% 기록은 고칠 수 없습니다', tg_table_name;
  end if;
  if old.created_at > now() - (tg_argv[0])::interval then
    raise exception '% 기록은 보관 기간(%)이 지나기 전에는 지울 수 없습니다', tg_table_name, tg_argv[0];
  end if;
  return old;
end $$;

create trigger audit_logs_immutable before update or delete on audit_logs
  for each row execute function audit_immutable('365 days');
create trigger login_events_immutable before update or delete on login_events
  for each row execute function audit_immutable('90 days');
