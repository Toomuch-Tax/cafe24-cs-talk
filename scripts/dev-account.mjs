// 로컬 개발용 관리자 계정을 만들고 로그인 정보를 env 파일에 적는다.
// 사용: node --env-file=.env.local scripts/dev-account.mjs [.env.local]
//   - 로컬 DB(localhost)에서만 돈다. 운영 DB 에는 만들지 않는다.
//   - DEV_LOGIN_EMAIL / DEV_LOGIN_PASSWORD 가 env 파일에 있으면 그 값으로 계정을 맞추고, 없으면 새로 만들어 파일 끝에 적는다.
//   - 로그인 화면의 "이메일·비밀번호로 로그인"에 이 값을 넣는다. 비밀번호는 터미널에 출력하지 않는다.
import { randomBytes, scryptSync } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import postgres from "postgres";

const envFile = process.argv[2] ?? ".env.local";
const url = (process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL)?.split("?")[0];
if (!url) {
  console.error("DATABASE_URL 이 없어요. node --env-file=.env.local 로 실행하세요.");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`로컬 DB 가 아니에요 (${host}). 개발용 계정은 로컬 DB 에만 만듭니다.`);
  process.exit(1);
}

const email = (process.env.DEV_LOGIN_EMAIL ?? "dev@example.com").toLowerCase();
const password = process.env.DEV_LOGIN_PASSWORD ?? randomBytes(12).toString("base64url");
const fresh = !process.env.DEV_LOGIN_PASSWORD;

// src/lib/password.ts 와 같은 형식: scrypt$<salt>$<hash>
const salt = randomBytes(16).toString("hex");
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;

const sql = postgres(url, { max: 1, ssl: false });
try {
  await sql`
    insert into agents (email, name, role, password_hash, status)
    values (${email}, '개발자', 'admin', ${passwordHash}, 'active')
    on conflict (email) do update set role = 'admin', password_hash = excluded.password_hash, status = 'active'`;
} finally {
  await sql.end();
}

if (fresh) {
  const text = readFileSync(envFile, "utf8");
  const lines = [
    "",
    "# 로컬 개발용 관리자 계정 (scripts/dev-account.mjs 가 만듦, 로컬 DB 에만 있음)",
    ...(process.env.DEV_LOGIN_EMAIL ? [] : [`DEV_LOGIN_EMAIL=${email}`]),
    `DEV_LOGIN_PASSWORD=${password}`,
  ];
  appendFileSync(envFile, (text && !text.endsWith("\n") ? "\n" : "") + lines.join("\n") + "\n");
  console.log(`개발용 계정을 만들고 ${envFile} 에 적었어요: ${email}`);
} else {
  console.log(`개발용 계정을 ${envFile} 의 값으로 맞췄어요: ${email}`);
}
