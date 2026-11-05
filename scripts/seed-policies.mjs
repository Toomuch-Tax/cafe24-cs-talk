// 초기 AI 응답 정책 예시 (scripts/policy-seed-data.mjs).
// 이미 있는 주제(slug)는 건드리지 않는다. 모두 "초안 전용(draft)"으로 시작 → 관리자가 검토 후 "자동 응답"으로 전환.
// "[확인 필요]" 가 붙은 줄은 AI 에 전달되지 않는다. 사실 확인 후 표시를 지우면 반영된다.
// 사용: node --env-file=.env.local scripts/seed-policies.mjs
import postgres from "postgres";
import { isLocalDb } from "./db-url.mjs";
import { T } from "./policy-seed-data.mjs";

const url = (process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL).split("?")[0];
const sql = postgres(url, { max: 1, ssl: isLocalDb(url) ? false : "require" });

try {
  let added = 0;
  for (const [i, t] of T.entries()) {
    const [exists] = await sql`select 1 from policy_topics where slug = ${t.slug}`;
    if (exists) continue;
    await sql.begin(async (tx) => {
      const [topic] = await tx`
        insert into policy_topics (slug, title, description, kind, ai_mode, categories, sort_order)
        values (${t.slug}, ${t.title}, ${t.description}, ${t.kind ?? "topic"}, 'draft', ${t.categories}, ${i * 10})
        returning id`;
      const [v] = await tx`
        insert into policy_versions (topic_id, version, content, change_note)
        values (${topic.id}, 1, ${t.content}, '초안: 설치 예시') returning id`;
      await tx`update policy_topics set current_version_id = ${v.id} where id = ${topic.id}`;
    });
    added++;
  }
  console.log(`policies seeded: ${added} new, ${T.length - added} already existed`);
} finally {
  await sql.end();
}
