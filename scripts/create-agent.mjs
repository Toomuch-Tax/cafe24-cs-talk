// 상담원 계정 생성/비밀번호 재설정.
// 사용: node --env-file=.env.local scripts/create-agent.mjs <email> <name> [admin|agent]
//   비밀번호는 AGENT_PASSWORD 환경변수로 넘긴다 (쉘 히스토리에 남지 않게).
import { randomBytes, scryptSync } from "node:crypto";
import postgres from "postgres";
import { isLocalDb } from "./db-url.mjs";

const [email, name, role = "agent"] = process.argv.slice(2);
const password = process.env.AGENT_PASSWORD;
if (!email || !name || !password) {
  console.error("usage: AGENT_PASSWORD=... node scripts/create-agent.mjs <email> <name> [admin|agent]");
  process.exit(1);
}

// src/lib/password.ts 와 같은 형식: scrypt$<salt>$<hash>
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
const passwordHash = `scrypt$${salt}$${hash}`;

const url = (process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL)?.split("?")[0];
const sql = postgres(url, { max: 1, ssl: isLocalDb(url) ? false : "require" });
try {
  await sql`
    insert into agents (email, name, role, password_hash)
    values (${email.toLowerCase()}, ${name}, ${role}, ${passwordHash})
    on conflict (email) do update set name = excluded.name, role = excluded.role,
      password_hash = excluded.password_hash, active = true`;
  console.log(`agent ready: ${email} (${role})`);
} finally {
  await sql.end();
}
