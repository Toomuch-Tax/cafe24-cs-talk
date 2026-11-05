-- 구글(Google Workspace) 로그인 + 사용자 관리
-- - 구글로만 들어오는 사용자는 비밀번호가 없다 → password_hash 를 비워둘 수 있게
-- - status: pending(관리자 승인 대기) / active / disabled. 기존 active 컬럼은 예전 코드가 아직 읽으므로 남기고,
--   트리거로 status 와 항상 맞춘다 (어느 쪽을 바꿔도 다른 쪽이 따라감).
alter table agents alter column password_hash drop not null;
alter table agents add column google_sub text unique;
alter table agents add column avatar_url text;
alter table agents add column status text not null default 'active' check (status in ('pending', 'active', 'disabled'));
alter table agents add column last_login_at timestamptz;
alter table agents add column invited_by uuid references agents(id) on delete set null;

update agents set status = case when active then 'active' else 'disabled' end;

create function agents_sync_status() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.active := new.status = 'active';
  elsif new.status is distinct from old.status then
    new.active := new.status = 'active';
  elsif new.active is distinct from old.active then
    new.status := case when new.active then 'active' else 'disabled' end;
  end if;
  return new;
end $$;

create trigger agents_sync_status before insert or update on agents
  for each row execute function agents_sync_status();
