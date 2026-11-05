-- 상담원별 읽음
-- 지금까지는 conversations.agent_last_read_at 한 칸이라 한 사람이 열면 모두에게 읽음이었다.
-- 이제 상담원마다 마지막으로 읽은 시각을 따로 둔다. agent_last_read_at 은 "누군가 읽은 시각"으로 계속 갱신만 한다(호환용).
create table conversation_reads (
  agent_id        uuid not null references agents(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  last_read_at    timestamptz not null,
  primary key (agent_id, conversation_id)
);
create index conversation_reads_conversation_idx on conversation_reads (conversation_id);
alter table conversation_reads enable row level security;

-- 배포 순간 지난 문의가 모두 안 읽음으로 뜨지 않게, 지금의 공용 읽음 시각을 현재 상담원 모두에게 옮겨 둔다
insert into conversation_reads (agent_id, conversation_id, last_read_at)
select a.id, c.id, c.agent_last_read_at
from conversations c cross join agents a
where c.agent_last_read_at is not null and c.submitted_at is not null;
