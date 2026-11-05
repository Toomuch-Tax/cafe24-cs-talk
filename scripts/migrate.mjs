// db/migrations/*.sql 을 순서대로 한 번씩 적용한다.
// 사용: node --env-file=.env.local scripts/migrate.mjs
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { isLocalDb } from "./db-url.mjs";

// 마이그레이션은 트랜잭션 풀러가 아닌 직접 연결을 쓴다
const url = (process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL)?.split("?")[0];
if (!url) throw new Error("DATABASE_URL or POSTGRES_URL_NON_POOLING is not set");

const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: isLocalDb(url) ? false : "require" });
const dir = path.join(import.meta.dirname, "..", "db", "migrations");

try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  console.log("migrations up to date");
} finally {
  await sql.end();
}
