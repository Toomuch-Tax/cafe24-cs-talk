-- 운영 체계: 슬랙 알림(notification_jobs kind='slack'), 답변 지연 경고, cron 동작 기록
-- 새 테이블 없음. 상태는 settings / conversation_events 에 남긴다.

insert into settings (key, value) values
  ('sla_alert_hours', '4')   -- 답변 필요 상태로 이 시간 넘게 기다리면 슬랙 경고 (영업시간에만 발송)
on conflict (key) do nothing;

-- 정리 작업이 기간 조건으로 지우므로 인덱스를 둔다
create index if not exists rate_limits_window_idx on rate_limits (window_start);
create index if not exists notification_jobs_updated_idx on notification_jobs (updated_at) where status in ('sent', 'skipped');
