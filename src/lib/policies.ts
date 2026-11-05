import { audit } from "./audit";
import type { Agent } from "./auth";
import { sql } from "./db";
import { HttpError } from "./http";

// AI 응답 정책 (주제별 문서 + 버전 히스토리)
// 저장할 때마다 새 버전이 쌓이고, 되돌리기도 "예전 내용으로 새 버전"을 만들어 히스토리가 지워지지 않는다.

export type PolicyKind = "always" | "topic" | "product";
// 상품별 정책이 붙는 상품. 이름·썸네일은 추가할 때 받아 둔 표시용이고, AI 에 붙일지는 no 로만 판단한다
export type PolicyProduct = { no: number; name: string; image?: string | null };
export type AiMode = "auto" | "draft" | "off";
export const AI_MODE_LABEL: Record<AiMode, string> = { auto: "자동 응답", draft: "초안만", off: "사용 안 함" };
export const KIND_LABEL: Record<PolicyKind, string> = { always: "항상 적용", topic: "주제별", product: "상품별" };

export type TopicSummary = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: PolicyKind;
  ai_mode: AiMode;
  categories: string[];
  products: PolicyProduct[];
  sort_order: number;
  archived: boolean;
  version: number | null;
  version_id: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export async function listTopics(includeArchived = false) {
  return sql<TopicSummary[]>`
    select t.id, t.slug, t.title, t.description, t.kind, t.ai_mode, t.categories, t.products, t.sort_order, t.archived,
           v.version, v.id as version_id, v.created_at as updated_at, a.name as updated_by
    from policy_topics t
    left join policy_versions v on v.id = t.current_version_id
    left join agents a on a.id = v.created_by
    where ${includeArchived ? sql`true` : sql`not t.archived`}
    order by t.kind = 'always' desc, t.kind = 'product', t.sort_order, t.title`;
}

export async function getTopic(id: string) {
  const [topic] = await sql<(TopicSummary & { content: string | null })[]>`
    select t.id, t.slug, t.title, t.description, t.kind, t.ai_mode, t.categories, t.products, t.sort_order, t.archived,
           v.version, v.id as version_id, v.created_at as updated_at, a.name as updated_by, v.content
    from policy_topics t
    left join policy_versions v on v.id = t.current_version_id
    left join agents a on a.id = v.created_by
    where t.id = ${id}`;
  if (!topic) throw new HttpError(404, "not_found");
  const versions = await sql<
    { id: string; version: number; change_note: string | null; created_at: string; created_by: string | null; length: number }[]
  >`
    select v.id, v.version, v.change_note, v.created_at, a.name as created_by, length(v.content)::int as length
    from policy_versions v left join agents a on a.id = v.created_by
    where v.topic_id = ${id} order by v.version desc`;
  return { topic, versions };
}

export async function getVersion(topicId: string, versionId: string) {
  const [v] = await sql<{ id: string; version: number; content: string; change_note: string | null; created_at: string }[]>`
    select id, version, content, change_note, created_at from policy_versions
    where id = ${versionId} and topic_id = ${topicId}`;
  if (!v) throw new HttpError(404, "not_found");
  return v;
}

type TopicMeta = {
  title: string;
  description?: string | null;
  kind: PolicyKind;
  ai_mode: AiMode;
  categories: string[];
  products?: PolicyProduct[];
  sort_order?: number;
};

export async function createTopic(input: TopicMeta & { slug: string; content: string }, agentId: string | null) {
  return sql.begin(async (tx) => {
    const [exists] = await tx`select 1 from policy_topics where slug = ${input.slug}`;
    if (exists) throw new HttpError(409, "slug_taken");
    const [t] = await tx<{ id: string }[]>`
      insert into policy_topics (slug, title, description, kind, ai_mode, categories, products, sort_order)
      values (${input.slug}, ${input.title}, ${input.description ?? null}, ${input.kind}, ${input.ai_mode},
              ${input.categories}, ${tx.json(input.products ?? [])}, ${input.sort_order ?? 0})
      returning id`;
    const [v] = await tx<{ id: string }[]>`
      insert into policy_versions (topic_id, version, content, change_note, created_by)
      values (${t.id}, 1, ${input.content}, '처음 작성', ${agentId}) returning id`;
    await tx`update policy_topics set current_version_id = ${v.id} where id = ${t.id}`;
    return t.id;
  });
}

export async function updateTopicMeta(id: string, meta: Partial<TopicMeta> & { archived?: boolean }) {
  const [t] = await sql`select id from policy_topics where id = ${id}`;
  if (!t) throw new HttpError(404, "not_found");
  await sql`
    update policy_topics set
      title = coalesce(${meta.title ?? null}, title),
      description = ${meta.description === undefined ? sql`description` : meta.description},
      kind = coalesce(${meta.kind ?? null}, kind),
      ai_mode = coalesce(${meta.ai_mode ?? null}, ai_mode),
      categories = coalesce(${meta.categories ?? null}, categories),
      products = ${meta.products === undefined ? sql`products` : sql.json(meta.products)},
      sort_order = coalesce(${meta.sort_order ?? null}, sort_order),
      archived = coalesce(${meta.archived ?? null}, archived),
      updated_at = now()
    where id = ${id}`;
}

// baseVersion: 편집을 시작할 때 보고 있던 버전. 그 사이 다른 사람이 저장했으면 덮어쓰지 않고 409.
export async function saveVersion(
  topicId: string,
  input: { content: string; changeNote: string | null; baseVersion: number | null },
  agentId: string,
) {
  return sql.begin(async (tx) => {
    const [cur] = await tx<{ version: number | null; content: string | null }[]>`
      select v.version, v.content from policy_topics t
      left join policy_versions v on v.id = t.current_version_id
      where t.id = ${topicId} for update of t`;
    if (!cur) throw new HttpError(404, "not_found");
    if (input.baseVersion !== null && cur.version !== null && cur.version !== input.baseVersion) {
      throw new HttpError(409, `version_conflict:${cur.version}`);
    }
    if (cur.content === input.content) return { version: cur.version, unchanged: true };
    const next = (cur.version ?? 0) + 1;
    const [v] = await tx<{ id: string }[]>`
      insert into policy_versions (topic_id, version, content, change_note, created_by)
      values (${topicId}, ${next}, ${input.content}, ${input.changeNote}, ${agentId}) returning id`;
    await tx`update policy_topics set current_version_id = ${v.id}, updated_at = now() where id = ${topicId}`;
    return { version: next, unchanged: false };
  });
}

export async function restoreVersion(topicId: string, versionId: string, agentId: string) {
  const old = await getVersion(topicId, versionId);
  return saveVersion(topicId, { content: old.content, changeNote: `v${old.version} 내용으로 되돌림`, baseVersion: null }, agentId);
}

// 문구 자체는 정책 버전 히스토리에 있으니 변경 이력에는 "버전 N 저장" 한 줄만 남긴다
export async function auditPolicyVersion(agent: Agent, topicId: string, version: number | null, note: string | null) {
  const { topic } = await getTopic(topicId);
  await audit(agent, {
    area: "ai",
    action: "policy.version",
    title: `정책 '${topic.title}' 버전 ${version} 저장`,
    changes: [{ label: "메모", after: note || "없음" }],
  });
}

// AI 에 넘길 정책: 사용 중인 주제의 현재 버전.
// 상품별 정책은 고객이 그 상품 페이지에서 물었을 때(productNo 일치)만 붙는다 — 상품이 늘어도 프롬프트가 커지지 않게.
export type ActivePolicy = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: PolicyKind;
  ai_mode: AiMode;
  categories: string[];
  products: PolicyProduct[];
  version_id: string;
  version: number;
  content: string;
};

export async function activePolicies(productNo?: number | null) {
  return sql<ActivePolicy[]>`
    select t.id, t.slug, t.title, t.description, t.kind, t.ai_mode, t.categories, t.products,
           v.id as version_id, v.version, v.content
    from policy_topics t join policy_versions v on v.id = t.current_version_id
    where not t.archived and t.ai_mode <> 'off'
      and (t.kind <> 'product' or ${productNo ? sql`t.products @> ${sql.json([{ no: productNo }])}` : sql`false`})
    order by t.kind = 'always' desc, t.kind = 'product', t.sort_order, t.title`;
}
