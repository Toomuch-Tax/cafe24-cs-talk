// 처음 설치를 한 번에: npm run setup
//  1. .env.local 이 없으면 .env.example 을 복사하고, 비어 있는 비밀키를 무작위 값으로 채운다
//  2. DB 에 접속해 본다 (데이터베이스가 없으면 만든다)
//  3. 마이그레이션 → 예시 정책·빠른 답변 → (로컬 DB 면) 개발용 관리자 계정
// 여러 번 실행해도 안전하다: 이미 있는 값·테이블·정책은 건드리지 않는다.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { dbUrl, isLocalDb } from "./db-url.mjs";

// ── 0. Node 버전 (가장 먼저: 낮은 버전에서는 아래 코드가 엉뚱한 오류를 낸다)
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`Node.js 22 이상이 필요해요 (지금 ${process.versions.node}). https://nodejs.org 에서 LTS 를 설치하세요.`);
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(root, process.argv[2] ?? ".env.local");
const step = (n, msg) => console.log(`\n\x1b[1m[${n}/4] ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`  \x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};

// ── 1. 환경변수 파일
step(1, "환경변수 파일");
if (!existsSync(ENV_FILE)) {
  copyFileSync(path.join(root, ".env.example"), ENV_FILE);
  ok(`${path.basename(ENV_FILE)} 를 만들었어요 (.env.example 복사)`);
}
const SECRETS = ["SESSION_SECRET", "WIDGET_TOKEN_SECRET", "CRON_SECRET", "TOKEN_ENCRYPTION_KEY"];
let text = readFileSync(ENV_FILE, "utf8");
const filled = [];
for (const key of SECRETS) {
  const re = new RegExp(`^${key}=\\s*$`, "m");
  if (re.test(text)) {
    text = text.replace(re, `${key}=${randomBytes(32).toString("hex")}`);
    filled.push(key);
  } else if (!new RegExp(`^${key}=`, "m").test(text)) {
    text += `${text.endsWith("\n") ? "" : "\n"}${key}=${randomBytes(32).toString("hex")}\n`;
    filled.push(key);
  }
}
if (filled.length) {
  writeFileSync(ENV_FILE, text);
  ok(`비밀키를 채웠어요: ${filled.join(", ")}`);
} else ok("비밀키는 이미 채워져 있어요");

// 이 프로세스에도 값을 읽어 둔다 (이미 셸에 있는 값이 우선)
process.loadEnvFile?.(ENV_FILE);

// ── 2. DB 접속
step(2, "데이터베이스");
const url = dbUrl();
if (!url) fail("DATABASE_URL 이 비어 있어요. .env.local 에 넣어 주세요.");
const ssl = isLocalDb(url) ? false : "require";
const tryConnect = async (u) => {
  const sql = postgres(u, { max: 1, ssl, onnotice: () => {}, connect_timeout: 5 });
  try {
    await sql`select 1`;
    return null;
  } catch (err) {
    return err;
  } finally {
    await sql.end({ timeout: 1 });
  }
};
let err = await tryConnect(url);
if (err?.code === "3D000") {
  // 데이터베이스가 없다 → 같은 서버의 postgres DB 로 붙어서 만든다
  const u = new URL(url);
  const name = u.pathname.slice(1);
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1, ssl, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name.replace(/"/g, '""')}"`);
    ok(`데이터베이스 ${name} 를 만들었어요`);
  } finally {
    await admin.end({ timeout: 1 });
  }
  err = await tryConnect(url);
}
if (err) {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  console.error(`  접속 실패 (${host}): ${err.code ?? ""} ${err.message}`);
  fail(
    isLocalDb(url)
      ? "로컬 Postgres 가 꺼져 있는 것 같아요. Docker 를 켜고 `docker compose up -d` 한 뒤 다시 `npm run setup` 하세요."
      : "DATABASE_URL 의 주소·비밀번호를 확인하세요.",
  );
}
ok(`접속 OK (${new URL(url).host})`);

// ── 3. 스키마·예시 데이터
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [`--env-file=${ENV_FILE}`, path.join(root, "scripts", script), ...args], {
    stdio: "inherit",
    cwd: root,
  });
  if (r.status !== 0) fail(`${script} 실패`);
};
step(3, "테이블·예시 정책·빠른 답변");
run("migrate.mjs");
run("seed-policies.mjs");
run("seed-quick-replies.mjs", "--apply");

// ── 4. 개발용 관리자 계정
step(4, "운영 콘솔 로그인 계정");
if (isLocalDb(url)) {
  run("dev-account.mjs", ENV_FILE);
  ok(`로그인 정보는 ${path.basename(ENV_FILE)} 의 DEV_LOGIN_EMAIL / DEV_LOGIN_PASSWORD 에 있어요`);
} else {
  console.log("  운영 DB 라서 개발용 계정은 만들지 않았어요. 관리자 계정은 이렇게 만드세요:");
  console.log(`  AGENT_PASSWORD='<비밀번호>' node --env-file=${path.basename(ENV_FILE)} scripts/create-agent.mjs you@example.com 이름 admin`);
}

console.log(`
\x1b[1m준비 끝!\x1b[0m
  npm run dev
  · 운영 콘솔   http://localhost:3000/inbox
  · 위젯 체험   http://localhost:3000/demo-shop.html  (가짜 쇼핑몰 화면에 위젯이 떠요)
다음 단계: README.md 의 "내 쇼핑몰에 붙이기"
`);
