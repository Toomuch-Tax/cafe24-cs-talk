-- 동영상 첨부: 동영상은 서버를 거치지 않고(Vercel 요청 크기 4.5MB 제한) 서명 업로드 URL 로 저장소에 바로 올린다.
-- 업로드 URL 을 줄 때 행을 먼저 만들고(ready = false), 저장소에 실제 파일이 올라온 걸 확인한 뒤에만 ready 로 바꾼다.
-- 메시지에는 ready 인 업로드만 붙는다. 끝내 확인되지 않은 행은 기존 크론(하루 지난 미연결 업로드 정리)이 지운다.
alter table uploads add column ready boolean not null default true;
