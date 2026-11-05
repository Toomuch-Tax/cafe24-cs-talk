-- 고객 사진 첨부 (문의 남기기·내 문의 이어쓰기)
-- 파일 자체는 비공개 저장소(Supabase Storage 비공개 버킷)에 두고, 여기에는 누가 올렸고 어느 메시지에 붙었는지만 기록한다.
-- 업로드 직후에는 message_id 가 비어 있고, 문의를 보낼 때 그 고객의 업로드만 메시지에 연결된다.
-- 연결되지 않은 채 하루가 지난 업로드는 크론이 파일과 함께 지운다.
create table uploads (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references contacts(id) on delete cascade,
  storage_key  text not null unique,
  content_type text not null,
  size_bytes   int not null check (size_bytes > 0),
  message_id   uuid references messages(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index uploads_contact_idx on uploads (contact_id, created_at desc);
create index uploads_orphan_idx on uploads (created_at) where message_id is null;

-- 공개 REST(anon) 로는 읽을 수 없게 (0002 와 같은 원칙)
alter table uploads enable row level security;
