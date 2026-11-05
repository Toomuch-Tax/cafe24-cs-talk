// 스크립트 공용: 접속 주소와 SSL 사용 여부.
// 마이그레이션·계정 생성은 트랜잭션 풀러가 아닌 직접 연결(POSTGRES_URL_NON_POOLING)을 우선 쓴다.
export const dbUrl = () => (process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL)?.split("?")[0];

// 내 컴퓨터·도커의 DB 는 SSL 없이, 그 밖(Supabase 등)은 SSL 로 접속한다. DATABASE_SSL=false 로 강제로 끌 수 있다.
export const isLocalDb = (url) => {
  if (process.env.DATABASE_SSL === "false") return true;
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]", "db", "postgres"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};
