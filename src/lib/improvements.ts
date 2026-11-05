import { sql } from "./db";
import { sanitize } from "./errors";

// 개선 후보 만들기 + 배포 후 효과 확인 (cron, LLM 호출 없음). 테이블은 0016_ops_insights.sql.
// - 후보: 최근 7일의 반복 오류 / AI 가 답하지 못한 질문 유형 / 실패한 주문조회를 발생 빈도순으로 모은다.
// - 효과 확인: '배포됨'으로 표시된 후보를 배포 전·후 같은 기간의 실패율(실패 ÷ 시도)로 비교한다.
//   시도 수가 양쪽 모두 MIN_ATTEMPTS 이상일 때만 판정하고, 모자라면 기간을 7일씩 늘려 기다린다(최대 28일).
//   "최근에 안 났다"만으로는 확인됨으로 바꾸지 않는다.
// 후보를 고치는 쪽(선점·시도 기록)은 improvement_attempts 테이블에 남긴다.

export const MIN_ATTEMPTS = 20; // 초기 운영 기준 — 데이터가 쌓이면 조정
const WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 28;
const CRON_RUNS_PER_DAY = 144; // 10분마다
const DAY_MS = 86_400_000;

// 운영에서는 live, 로컬에서는 dev 데이터로 후보를 만든다 (테스트 위젯 데이터는 섞지 않는다)
const dataEnv = () => (process.env.NODE_ENV === "production" ? "live" : "dev");

// AI 가 답하지 않은 이유를 묶는 단위. 의도된 넘김(불량·가품 키워드)과 AI 꺼짐·예산 초과는 개선 후보가 아니다
const AI_SKIP_REASONS = ["escalation_keyword", "ai_disabled", "ai_not_configured", "budget_exceeded"];
const AI_REASON_GROUP = `case
  when reason like 'draft_only:%' then 'draft_only'
  when reason in ('no_grounding', 'forbidden_phrase') then reason
  else 'model_handoff' end`;
const AI_REASON_LABEL: Record<string, string> = {
  draft_only: "초안 전용 주제라 바로 답하지 않음",
  no_grounding: "근거로 쓸 정책을 찾지 못함",
  forbidden_phrase: "금지 표현이 들어가 막힘",
  model_handoff: "AI 가 정책만으로 답할 수 없다고 판단",
};
const CATEGORY_LABEL: Record<string, string> = {
  shipping: "배송",
  exchange: "교환",
  return: "반품·환불",
  size: "사이즈",
  restock: "재입고",
  defect: "불량",
  order: "주문",
  etc: "기타",
};

type Area = "order" | "ai" | "widget" | "inbox" | "cron" | "other";

// 오류가 나는 작업의 시도 수 (실패율의 분모). 분모를 셀 수 없는 영역은 null
async function attemptsFor(area: string, from: Date, to: Date): Promise<number | null> {
  const env = dataEnv();
  if (area === "order") {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from usage_events
      where name = 'order_lookup' and env = ${env} and occurred_at >= ${from} and occurred_at < ${to}`;
    return r.n;
  }
  if (area === "ai") {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from ai_answers
      where kind = 'customer_answer' and created_at >= ${from} and created_at < ${to}`;
    return r.n;
  }
  if (area === "widget" || area === "inbox") {
    const name = area === "widget" ? "widget_open" : "reply_sent";
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from usage_events
      where name = ${name} and env = ${env} and occurred_at >= ${from} and occurred_at < ${to}`;
    return r.n;
  }
  if (area === "cron") return Math.round(((to.getTime() - from.getTime()) / DAY_MS) * CRON_RUNS_PER_DAY);
  return null;
}

// ── 후보 만들기 ──────────────────────────────────────────────────────────

type CandidateRow = {
  kind: "error" | "ai_unanswered" | "order_lookup";
  key: string;
  title: string;
  area: Area;
  count7d: number;
  attempts7d: number | null;
  evidence: Record<string, unknown>;
};

async function errorCandidates(from: Date, to: Date): Promise<CandidateRow[]> {
  const rows = await sql<
    {
      id: string;
      fingerprint: string;
      where_: string;
      source: string;
      area: Area;
      code: string | null;
      status: number | null;
      message: string;
      count: number;
      first_at: Date;
      last_at: Date;
      last_release: string | null;
      c7: number;
    }[]
  >`
    select g.id, g.fingerprint, g.where_, g.source, g.area, g.code, g.status, g.message, g.count, g.first_at, g.last_at,
      g.last_release, sum(d.count)::int as c7
    from error_groups g join error_daily d on d.group_id = g.id
    where g.env = ${dataEnv()} and g.resolved_at is null
      and d.day >= (${from}::timestamptz at time zone 'Asia/Seoul')::date
    group by g.id`;
  const out: CandidateRow[] = [];
  for (const r of rows) {
    out.push({
      kind: "error",
      key: `error:${r.fingerprint}`,
      title: `${r.where_} — ${r.message.slice(0, 80)}`,
      area: r.area,
      count7d: r.c7,
      attempts7d: await attemptsFor(r.area, from, to),
      evidence: {
        groupId: r.id,
        fingerprint: r.fingerprint,
        where: r.where_,
        source: r.source,
        code: r.code,
        status: r.status,
        message: r.message,
        total: r.count,
        firstAt: r.first_at,
        lastAt: r.last_at,
        release: r.last_release,
      },
    });
  }
  return out;
}

async function aiCandidates(from: Date, to: Date): Promise<CandidateRow[]> {
  const rows = await sql<
    { category: string; reason_group: string; n: number; total: number; questions: string[]; reasons: string[]; topics: string[] | null }[]
  >`
    with base as (
      select coalesce(category, 'etc') as category, ${sql.unsafe(AI_REASON_GROUP)} as reason_group, question, reason,
        topic_ids, decision, created_at
      from ai_answers
      where kind = 'customer_answer' and created_at >= ${from} and created_at < ${to}
    ), totals as (select category, count(*)::int as total from base group by category)
    select b.category, b.reason_group, count(*)::int as n, t.total,
      (array_agg(b.question order by b.created_at desc))[1:5] as questions,
      (array_agg(b.reason order by b.created_at desc))[1:5] as reasons,
      (select array_agg(distinct p.slug) from policy_topics p
         where p.id in (select unnest(x.topic_ids) from base x
           where x.category = b.category and ${sql.unsafe(AI_REASON_GROUP.replace(/reason/g, "x.reason"))} = b.reason_group)) as topics
    from base b join totals t using (category)
    where b.decision in ('handoff', 'blocked') and coalesce(b.reason, '') <> all(${AI_SKIP_REASONS})
    group by b.category, b.reason_group, t.total`;
  return rows.map((r) => ({
    kind: "ai_unanswered" as const,
    key: `ai:${r.category}:${r.reason_group}`,
    title: `AI 미답변 · ${CATEGORY_LABEL[r.category] ?? r.category} · ${AI_REASON_LABEL[r.reason_group] ?? r.reason_group}`,
    area: "ai" as const,
    count7d: r.n,
    attempts7d: r.total,
    evidence: {
      category: r.category,
      reasonGroup: r.reason_group,
      // 고객 질문은 연락처·이메일·긴 숫자를 가리고 잘라서만 남긴다
      questions: r.questions.map((q) => sanitize(q ?? "", 200)),
      reasons: r.reasons.filter(Boolean).map((x) => sanitize(x, 200)),
      topics: r.topics ?? [], // 그 질문들에서 AI 가 참고한 정책 주제
    },
  }));
}

async function orderCandidates(from: Date, to: Date): Promise<CandidateRow[]> {
  const rows = await sql<{ who: string; code: string; n: number; total: number }[]>`
    with base as (
      select props->>'who' as who, props->>'result' as result, coalesce(props->>'code', props->>'result') as code
      from usage_events
      where name = 'order_lookup' and env = ${dataEnv()} and occurred_at >= ${from} and occurred_at < ${to}
    ), totals as (select who, count(*)::int as total from base group by who)
    select b.who, b.code, count(*)::int as n, t.total
    from base b join totals t using (who)
    where b.result <> 'found'
    group by b.who, b.code, t.total`;
  return rows.map((r) => ({
    kind: "order_lookup" as const,
    key: `order:${r.who}:${r.code}`,
    title: `주문조회 실패 · ${r.who === "member" ? "회원" : "비회원"} · ${r.code === "not_found" ? "주문 없음" : r.code}`,
    area: "order" as const,
    count7d: r.n,
    attempts7d: r.total,
    evidence: { who: r.who, code: r.code, failureRate: r.total ? Math.round((r.n / r.total) * 1000) / 10 : null },
  }));
}

export async function refreshCandidates(now = new Date()) {
  const from = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const rows = [
    ...(await errorCandidates(from, now)),
    ...(await aiCandidates(from, now)),
    ...(await orderCandidates(from, now)),
  ];
  await sql.begin(async (tx) => {
    // 이번 7일에 다시 안 나타난 후보는 횟수만 0 으로 (상태·이력은 그대로)
    const keys = rows.map((r) => r.key);
    if (keys.length) await tx`update improvement_candidates set count_7d = 0, updated_at = now() where count_7d > 0 and key <> all(${keys})`;
    else await tx`update improvement_candidates set count_7d = 0, updated_at = now() where count_7d > 0`;
    for (const r of rows) {
      await tx`
        insert into improvement_candidates (kind, key, title, area, count_7d, attempts_7d, evidence)
        values (${r.kind}, ${r.key}, ${r.title}, ${r.area}, ${r.count7d}, ${r.attempts7d}, ${tx.json(r.evidence as never)})
        on conflict (key) do update set title = excluded.title, area = excluded.area, count_7d = excluded.count_7d,
          attempts_7d = excluded.attempts_7d, evidence = excluded.evidence, updated_at = now()`;
    }
  });
  return rows.length;
}

// ── 배포 후 효과 확인 ────────────────────────────────────────────────────

type Deployed = {
  id: string;
  kind: CandidateRow["kind"];
  key: string;
  area: Area;
  evidence: Record<string, string>;
  deployed_at: Date;
  fix_release: string | null;
};

const kstDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d);

// 기간 [from, to) 의 실패 수와 실패가 있었던 날 수. 오류는 날짜 단위(error_daily)로 센다
async function failuresFor(c: Deployed, from: Date, to: Date): Promise<{ failures: number; days: number }> {
  if (c.kind === "error") {
    const [r] = await sql<{ failures: number; days: number }[]>`
      select coalesce(sum(d.count), 0)::int as failures, count(distinct d.day)::int as days
      from error_daily d join error_groups g on g.id = d.group_id
      where g.env = ${dataEnv()} and g.fingerprint = ${c.evidence.fingerprint}
        and d.day >= ${kstDay(from)}::date and d.day < ${kstDay(to)}::date`;
    return r;
  }
  if (c.kind === "ai_unanswered") {
    const [r] = await sql<{ failures: number; days: number }[]>`
      select count(*)::int as failures, count(distinct (created_at at time zone 'Asia/Seoul')::date)::int as days
      from ai_answers
      where kind = 'customer_answer' and decision in ('handoff', 'blocked') and coalesce(category, 'etc') = ${c.evidence.category}
        and ${sql.unsafe(AI_REASON_GROUP)} = ${c.evidence.reasonGroup} and created_at >= ${from} and created_at < ${to}`;
    return r;
  }
  const [r] = await sql<{ failures: number; days: number }[]>`
    select count(*)::int as failures, count(distinct (occurred_at at time zone 'Asia/Seoul')::date)::int as days
    from usage_events
    where name = 'order_lookup' and env = ${dataEnv()} and props->>'who' = ${c.evidence.who}
      and props->>'result' <> 'found' and coalesce(props->>'code', props->>'result') = ${c.evidence.code}
      and occurred_at >= ${from} and occurred_at < ${to}`;
  return r;
}

async function attemptsForCandidate(c: Deployed, from: Date, to: Date) {
  if (c.kind === "ai_unanswered") {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from ai_answers
      where kind = 'customer_answer' and coalesce(category, 'etc') = ${c.evidence.category}
        and created_at >= ${from} and created_at < ${to}`;
    return r.n;
  }
  if (c.kind === "order_lookup") {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from usage_events
      where name = 'order_lookup' and env = ${dataEnv()} and props->>'who' = ${c.evidence.who}
        and occurred_at >= ${from} and occurred_at < ${to}`;
    return r.n;
  }
  return attemptsFor(c.area, from, to);
}

export type Verdict = {
  status: "verified" | "regressed" | "deployed";
  windowDays: number;
  before: { failures: number; attempts: number | null; days: number; rate: number | null };
  after: { failures: number; attempts: number | null; days: number; rate: number | null };
  rule: "rate" | "days" | "wait";
  note: string;
};

// 판정 규칙만 따로 둔다 (테스트하기 쉽게)
export function judge(
  before: Verdict["before"],
  after: Verdict["after"],
  windowDays: number,
): Pick<Verdict, "status" | "rule" | "note"> {
  const enough = before.attempts !== null && after.attempts !== null && before.attempts >= MIN_ATTEMPTS && after.attempts >= MIN_ATTEMPTS;
  if (enough) {
    const rb = before.failures / before.attempts!;
    const ra = after.failures / after.attempts!;
    if (ra <= rb / 2) return { status: "verified", rule: "rate", note: `실패율 ${pct(rb)} → ${pct(ra)}` };
    if (after.failures > 0) return { status: "regressed", rule: "rate", note: `배포 후에도 실패율 ${pct(ra)} (배포 전 ${pct(rb)})` };
    return { status: "deployed", rule: "wait", note: "판정 보류" };
  }
  if (windowDays < MAX_WINDOW_DAYS) return { status: "deployed", rule: "wait", note: `시도 수 부족 — ${windowDays + WINDOW_DAYS}일로 늘려 다시 확인` };
  // 28일이 지나도 시도 수가 모자라면: 배포 전 자주(기간의 3/7 이상) 나던 것이 배포 후 하루도 안 났을 때만 확인됨
  const minDays = Math.ceil((windowDays * 3) / 7);
  if (before.days >= minDays && after.days === 0) return { status: "verified", rule: "days", note: `배포 전 ${before.days}일 발생 → 배포 후 0일` };
  if (after.days > 0 && after.days >= Math.max(1, before.days / 2))
    return { status: "regressed", rule: "days", note: `배포 후 ${after.days}일 발생 (배포 전 ${before.days}일)` };
  return { status: "deployed", rule: "wait", note: "데이터가 적어 판정할 수 없음 — 확인 필요" };
}
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;

export async function checkDeployed(now = new Date()) {
  const rows = await sql<Deployed[]>`
    select id, kind, key, area, evidence, deployed_at, fix_release from improvement_candidates
    where status = 'deployed' and deployed_at <= ${new Date(now.getTime() - WINDOW_DAYS * DAY_MS)}`;
  const results: { key: string; status: Verdict["status"] }[] = [];
  for (const c of rows) {
    const elapsed = Math.floor((now.getTime() - c.deployed_at.getTime()) / DAY_MS);
    const windowDays = Math.min(MAX_WINDOW_DAYS, Math.floor(elapsed / WINDOW_DAYS) * WINDOW_DAYS);
    // 배포 당일은 배포 전·후가 섞이므로 날짜 단위로 셀 때는 양쪽에서 뺀다
    const deployDayStart = new Date(`${kstDay(c.deployed_at)}T00:00:00+09:00`);
    const deployDayEnd = new Date(deployDayStart.getTime() + DAY_MS);
    const exact = c.kind !== "error";
    const bTo = exact ? c.deployed_at : deployDayStart;
    const aFrom = exact ? c.deployed_at : deployDayEnd;
    const bFrom = new Date(bTo.getTime() - windowDays * DAY_MS);
    const aTo = new Date(aFrom.getTime() + windowDays * DAY_MS);
    const [fb, fa, ab, aa] = await Promise.all([
      failuresFor(c, bFrom, bTo),
      failuresFor(c, aFrom, aTo),
      attemptsForCandidate(c, bFrom, bTo),
      attemptsForCandidate(c, aFrom, aTo),
    ]);
    const before = { ...fb, attempts: ab, rate: ab ? fb.failures / ab : null };
    const after = { ...fa, attempts: aa, rate: aa ? fa.failures / aa : null };
    const v = judge(before, after, windowDays);
    const verdict: Verdict = { ...v, windowDays, before, after };
    await sql.begin(async (tx) => {
      if (v.status !== "deployed") {
        await tx`update improvement_candidates set status = ${v.status}, updated_at = now(),
          next_attempt_at = null, fail_count = 0 where id = ${c.id}`;
      }
      const [last] = await tx<{ id: string }[]>`
        select id from improvement_attempts where candidate_id = ${c.id} order by started_at desc limit 1`;
      if (last) await tx`update improvement_attempts set post_deploy = ${tx.json(verdict as never)} where id = ${last.id}`;
      else
        await tx`insert into improvement_attempts (candidate_id, run_id, post_deploy)
          values (${c.id}, 'cron', ${tx.json(verdict as never)})`;
    });
    results.push({ key: c.key, status: v.status });
  }
  return results;
}

export async function refreshImprovements() {
  const candidates = await refreshCandidates();
  const checked = await checkDeployed();
  return { candidates, checked: checked.length, changed: checked.filter((c) => c.status !== "deployed").length };
}

// 일일 요약용: 상위 후보와 상태별 개수
export async function improvementDigest() {
  const top = await sql<{ title: string; count_7d: number; status: string }[]>`
    select title, count_7d, status from improvement_candidates
    where status in ('open', 'regressed', 'needs_decision') and count_7d > 0
    order by (status = 'regressed') desc, count_7d desc limit 3`;
  const [c] = await sql<{ fix_ready: number; verified: number; regressed: number }[]>`
    select count(*) filter (where status = 'fix_ready')::int as fix_ready,
      count(*) filter (where status = 'verified' and updated_at > now() - interval '7 days')::int as verified,
      count(*) filter (where status = 'regressed')::int as regressed
    from improvement_candidates`;
  return { top, ...c };
}
