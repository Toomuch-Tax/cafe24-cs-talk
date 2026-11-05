import postgres from "postgres";

// 서버 전용. dev 핫리로드 때 커넥션이 쌓이지 않도록 global 에 보관한다.
const globalForDb = globalThis as unknown as { __sql?: postgres.Sql };

// 로컬은 DATABASE_URL, Vercel 에서는 Supabase 연동이 넣어주는 POSTGRES_URL(풀러) 사용
// sslmode·supa 같은 쿼리 파라미터는 postgres.js 가 접속 파라미터로 넘겨버리므로 떼고, SSL 은 옵션으로 지정한다
const url = (process.env.DATABASE_URL ?? process.env.POSTGRES_URL)?.split("?")[0];
const pooled = Boolean(url?.includes(":6543"));

// 내 컴퓨터·도커의 DB 는 SSL 없이, 그 밖(Supabase 등)은 SSL. DATABASE_SSL=false 로 끌 수 있다
function isLocalDb(u: string | undefined) {
  if (process.env.DATABASE_SSL === "false") return true;
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]", "db", "postgres"].includes(new URL(u ?? "").hostname);
  } catch {
    return false;
  }
}

export const sql =
  globalForDb.__sql ??
  postgres(url!, {
    max: 5,
    idle_timeout: 20,
    // Supabase 트랜잭션 풀러(6543)는 prepared statement 를 지원하지 않는다
    prepare: !pooled,
    ssl: isLocalDb(url) ? false : "require",
    onnotice: () => {},
    // 잠금 대기·느린 쿼리가 요청을 무한정 붙잡지 않도록
    connection: { lock_timeout: 5000, statement_timeout: 15000 },
  });

if (process.env.NODE_ENV !== "production") globalForDb.__sql = sql;
