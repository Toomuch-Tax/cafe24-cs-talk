-- 상담원 프로필 사진 (인박스 안에서만 보임 — 고객에게는 보내지 않는다)
-- - avatar_mode: emoji(기본, 처음 만들 때 랜덤) / image(직접 올린 사진) / google(구글 프로필 사진)
-- - 기존 avatar_url 컬럼은 계속 "구글 프로필 사진" 원본 주소로 쓴다 (로그인할 때마다 갱신됨)
-- - 올린 사진은 브라우저에서 160px 로 줄여 올리는 작은 이미지라 agents 에 바로 둔다 (avatar_v = 내용 해시, 캐시 무효화용)
-- 이모지 목록은 src/lib/agent-avatar.ts 의 AGENT_EMOJIS 앞부분과 같게 유지한다.
create function random_agent_emoji() returns text language sql volatile as $$
  select (array[
    '🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵',
    '🐰','🐱','🐶','🐹','🦉','🐧','🐳','🐬','🦄','🐝',
    '🐢','🦔','🦦','🦥','🐙','🦋','🌻','🌵','🍀','🍄',
    '🍊','🍋','🍑','🍒','🥑','🍩','🧁','⭐','🌈','🔥'
  ])[1 + floor(random() * 40)::int]
$$;

alter table agents add column avatar_emoji text not null default random_agent_emoji();
alter table agents add column avatar_mode text not null default 'emoji' check (avatar_mode in ('emoji', 'image', 'google'));
alter table agents add column avatar_image bytea;
alter table agents add column avatar_image_type text check (avatar_image_type in ('image/png', 'image/jpeg', 'image/webp'));
alter table agents add column avatar_v text;

-- 기존 사용자도 한 명씩 다른 이모지를 받는다 (컬럼 기본값은 한 번만 계산될 수 있어 다시 뽑음)
update agents set avatar_emoji = random_agent_emoji();
