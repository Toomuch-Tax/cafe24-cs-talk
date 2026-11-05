-- Supabase 는 public 스키마를 PostgREST(anon/authenticated 키)로 노출한다.
-- 이 앱은 서버(API Route)에서만 DB 에 접속하므로 공개 API 경로는 전부 막는다.
-- 테이블 소유자(서버 접속 계정)는 RLS 를 우회하므로 앱 동작에는 영향 없음.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke all on all sequences in schema public from anon, authenticated;
    revoke all on all functions in schema public from anon, authenticated;
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
    alter default privileges in schema public revoke all on functions from anon, authenticated;
  end if;
end $$;
