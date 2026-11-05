import { appOrigin, categoryLabel, enqueueSlack, inboxLink, slackConfigured } from "./alerts";
import { cleanupAudit } from "./audit";
import { connectionStatus, getAccessToken } from "./cafe24/client";
import { sql } from "./db";
import { emailEnabled } from "./email";
import { improvementDigest } from "./improvements";
import { oneLine } from "./slack-format";
import { getSetting, isWithinBusinessHours, setSetting, type BusinessHours } from "./settings";

// cron(10분)이 돌리는 운영 작업과 상태 점검. 하루 100건 이하 규모라 전부 단순 쿼리로 충분하다.

const MAX_ATTEMPTS = 5; // jobs.ts 와 같은 값
const CRON_STALE_MINUTES = 30;
const CAFE24_REFRESH_AHEAD_DAYS = 7;
const SLA_LIST_MAX = 5;
const SLA_DEADLINE_HOURS = 24; // 고객에게 안내하는 "영업일 기준 24시간 이내"

const kstDate = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d);
// "2026-10-30" → "10/30(금)"
const dayLabel = (ymd: string) =>
  `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`))})`;
// 월초엔 몇 센트라 $0.00 으로 보이지 않게 $1 미만은 셋째 자리까지
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const hoursText = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}분` : h < 48 ? `${Math.floor(h)}시간` : `${Math.floor(h / 24)}일`);

async function inBusinessHours() {
  const hours = await getSetting<BusinessHours>("business_hours");
  return hours ? isWithinBusinessHours(hours) : false;
}

// 답변 필요 상태로 오래 기다리는 문의 경고. 문의마다 고객의 마지막 메시지 기준으로 한 번만 알린다.
// 밤·주말에는 보내지 않고, 다음 영업 시작 후 첫 cron 에서 모아서 보낸다.
export async function checkSla() {
  if (!slackConfigured() || !(await inBusinessHours())) return 0;
  const threshold = Number(await getSetting<number>("sla_alert_hours")) || 4;
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; waited: number; category: string | null; preview: string | null }[]>`
      select c.id, extract(epoch from now() - c.last_customer_message_at) / 3600 as waited,
        c.category, c.last_message_preview as preview
      from conversations c
      where c.status = 'open' and c.submitted_at is not null
        and c.last_customer_message_at < now() - make_interval(hours => ${threshold})
        and not exists (
          select 1 from conversation_events e
          where e.conversation_id = c.id and e.type = 'sla_alerted' and e.created_at >= c.last_customer_message_at)
      order by c.last_customer_message_at
      for update of c skip locked`;
    if (rows.length === 0) return 0;
    for (const r of rows) {
      await tx`insert into conversation_events (conversation_id, type, data)
        values (${r.id}, 'sla_alerted', ${tx.json({ hours: Math.floor(Number(r.waited)) })})`;
    }
    const late = rows.filter((r) => Number(r.waited) >= SLA_DEADLINE_HOURS).length;
    const text =
      `:hourglass_flowing_sand: 답변을 ${threshold}시간 넘게 기다리는 문의 ${rows.length}건` +
      (late ? ` (그중 ${SLA_DEADLINE_HOURS}시간 초과 ${late}건)` : "") +
      // 오래 기다린 순으로 5건까지: 대기 시간 · 카테고리 · 한 줄 미리보기 · 링크
      "\n" +
      rows
        .slice(0, SLA_LIST_MAX)
        .map((r) => `• *${hoursText(Number(r.waited))}* · ${categoryLabel(r.category)} · ${oneLine(r.preview ?? "", 50)} <${inboxLink(r.id)}|보기>`)
        .join("\n") +
      (rows.length > SLA_LIST_MAX ? `\n외 ${rows.length - SLA_LIST_MAX}건 · ` : "\n") +
      `<${appOrigin()}/inbox|인박스 열기>`;
    await tx`insert into notification_jobs (kind, dedupe_key, payload)
      values ('slack', ${`slack:sla:${rows.map((r) => r.id.slice(0, 8)).join(",")}:${Date.now()}`}, ${tx.json({ text })})`;
    return rows.length;
  });
}

// Cafe24 Refresh Token 은 14일 동안 안 쓰면 만료된다 (연휴·한가한 기간에 연결이 조용히 끊기는 것을 막는다).
// 만료 7일 전부터 미리 갱신하고, 실패하면 하루 한 번 슬랙으로 재연결을 요청한다.
export async function cafe24Keepalive() {
  if (!process.env.CAFE24_MALL_ID || !process.env.CAFE24_CLIENT_ID) return "not_configured";
  const status = await connectionStatus();
  if (!("refreshExpiresAt" in status) || !status.refreshExpiresAt) return "not_connected";
  const daysLeft = (new Date(status.refreshExpiresAt).getTime() - Date.now()) / 86_400_000;
  if (daysLeft > CAFE24_REFRESH_AHEAD_DAYS) return "ok";
  try {
    await getAccessToken(true);
    return "refreshed";
  } catch (err) {
    await enqueueSlack(
      `slack:cafe24:${kstDate()}`,
      `:link: Cafe24 연결 갱신 실패 — 주문 조회가 멈출 수 있어요. 설정 > Cafe24 에서 다시 연결해주세요.\n` +
        `\`${String(err).slice(0, 150)}\`\n<${appOrigin()}/settings|설정 열기>`,
    );
    return "failed";
  }
}

const CAFE24_STATE_TEXT: Record<string, string> = {
  expiring: "연결 곧 만료",
  expired: "연결 만료",
  not_connected: "연결 안 됨",
  error: "상태 확인 실패",
};

// 영업일 첫 cron 에서 하루 한 번: 밀린 문의·어제 처리량·장애 신호 요약
export async function sendDailyDigest() {
  if (!slackConfigured() || !(await inBusinessHours())) return false;
  const key = `slack:digest:${kstDate()}`;
  const [sent] = await sql`select 1 from notification_jobs where dedupe_key = ${key}`;
  if (sent) return false;

  const h = await healthReport();
  // 지난 요약 날짜 0시 ~ 오늘 0시(KST). 주말·휴일엔 요약이 안 나가므로 월요일엔 금~일이 합쳐진다 (최대 7일)
  const [y] = await sql<{ received: number; replied: number; from_d: string; to_d: string }[]>`
    with t as (select (now() at time zone 'Asia/Seoul')::date as today),
    r as (
      select t.today, greatest(coalesce(
        (select max(substr(dedupe_key, 14))::date from notification_jobs
           where dedupe_key like 'slack:digest:%' and dedupe_key < ${key}),
        t.today - 1), t.today - 7) as from_d
      from t),
    day as (
      select r.*, r.from_d::timestamp at time zone 'Asia/Seoul' as s, r.today::timestamp at time zone 'Asia/Seoul' as e from r)
    select day.from_d::text as from_d, (day.today - 1)::text as to_d,
      (select count(*)::int from conversations where submitted_at >= day.s and submitted_at < day.e) as received,
      (select count(*)::int from messages where sender_type = 'agent' and not internal
         and created_at >= day.s and created_at < day.e) as replied
    from day`;

  const lines = [
    `:sunrise: ${kstDate()} CS 요약`,
    `• 답변 필요 ${h.inbox.open}건${h.inbox.oldestWaitHours !== null ? ` (가장 오래 ${hoursText(h.inbox.oldestWaitHours)})` : ""}`,
    `• ${y.from_d === y.to_d ? "어제" : `${dayLabel(y.from_d)}~${dayLabel(y.to_d)}`} 접수 ${y.received}건 · 답변 ${y.replied}건`,
  ];
  if (h.jobs.dead > 0) lines.push(`• :warning: 최종 실패한 알림·메일 ${h.jobs.dead}건 (최근 7일)`);
  if (h.cafe24.state !== "ok" && h.cafe24.state !== "not_configured")
    lines.push(`• :warning: Cafe24 ${CAFE24_STATE_TEXT[h.cafe24.state]} — 설정에서 다시 연결해주세요`);
  if (h.aiCostUsdThisMonth > 0) lines.push(`• 이번 달 AI 비용 ${usd(h.aiCostUsdThisMonth)}`);
  // 운영 개선: 어제 오류, 상위 개선 후보 (질문 원문은 넣지 않는다 — 제목은 유형·위치만)
  const [e] = await sql<{ fresh: number; hits: number }[]>`
    select count(distinct g.id) filter (where g.first_at >= now() - interval '1 day')::int as fresh,
      coalesce(sum(d.count), 0)::int as hits
    from error_daily d join error_groups g on g.id = d.group_id
    where g.env = 'live' and d.day = (now() at time zone 'Asia/Seoul')::date - 1`;
  if (e.hits > 0) lines.push(`• 어제 오류 ${e.hits}회${e.fresh ? ` (새 오류 ${e.fresh}종)` : ""}`);
  const imp = await improvementDigest();
  if (imp.top.length || imp.fix_ready || imp.regressed) {
    lines.push(
      `• 개선 후보${imp.fix_ready ? ` · 수정 준비됨 ${imp.fix_ready}건` : ""}${imp.verified ? ` · 효과 확인 ${imp.verified}건` : ""}${imp.regressed ? ` · 재발 ${imp.regressed}건` : ""}`,
      ...imp.top.map((t) => `   ${t.status === "regressed" ? "↻ " : ""}${oneLine(t.title, 70)} (7일 ${t.count_7d}건)`),
    );
  }
  lines.push(`<${appOrigin()}/inbox|인박스 열기> · <${appOrigin()}/settings?tab=improve|운영 개선>`);
  await enqueueSlack(key, lines.join("\n"));
  return true;
}

// 계속 쌓이기만 하는 운영용 데이터 정리 (고객 상담 기록은 지우지 않는다)
export async function cleanup() {
  const a = await sql`delete from rate_limits where window_start < now() - interval '2 days'`;
  const b = await sql`delete from cafe24_oauth_states where created_at < now() - interval '1 day'`;
  const c = await sql`delete from notification_jobs where status in ('sent', 'skipped') and updated_at < now() - interval '90 days'`;
  // 운영 개선 기록: 행동 180일, 오류는 처리 후 또는 재발 없이 90일, 끝난 후보 180일 (0016_ops_insights.sql)
  const u = await sql`delete from usage_events where occurred_at < now() - interval '180 days'`;
  const e = await sql`delete from error_groups where coalesce(resolved_at, last_at) < now() - interval '90 days'`;
  const i = await sql`delete from improvement_candidates
    where status in ('verified', 'dismissed') and updated_at < now() - interval '180 days'`;
  return {
    rateLimits: a.count,
    oauthStates: b.count,
    jobs: c.count,
    usage: u.count,
    errors: e.count,
    improvements: i.count,
    ...(await cleanupAudit()),
  };
}

export async function recordHeartbeat(summary: Record<string, unknown>) {
  await setSetting("ops_heartbeat", { at: new Date().toISOString(), ...summary });
}

// 공개 헬스체크용 가벼운 점검 (쿼리 1번)
export async function cronStale() {
  const heartbeat = await getSetting<{ at: string }>("ops_heartbeat");
  return !heartbeat || Date.now() - Date.parse(heartbeat.at) > CRON_STALE_MINUTES * 60_000;
}

export type HealthReport = Awaited<ReturnType<typeof healthReport>>;

// 상태 점검: /api/health(외부 모니터링), 설정 화면 "운영 상태", 일일 요약에서 같이 쓴다
export async function healthReport() {
  const started = Date.now();
  await sql`select 1`;
  const dbMs = Date.now() - started;

  const [counts] = await sql<{ open: number; oldest: number | null; pending: number; dead: number; ai: string | null }[]>`
    select
      (select count(*)::int from conversations where status = 'open' and submitted_at is not null) as open,
      (select extract(epoch from now() - min(last_customer_message_at)) / 3600 from conversations
         where status = 'open' and submitted_at is not null) as oldest,
      (select count(*)::int from notification_jobs where status in ('pending', 'failed') and attempts < ${MAX_ATTEMPTS}) as pending,
      (select count(*)::int from notification_jobs where status = 'failed' and attempts >= ${MAX_ATTEMPTS}
         and updated_at > now() - interval '7 days') as dead,
      (select sum(cost_usd)::text from ai_answers where created_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as ai`;

  const heartbeat = await getSetting<{ at: string }>("ops_heartbeat");
  const cronAgeMin = heartbeat ? (Date.now() - Date.parse(heartbeat.at)) / 60_000 : null;

  let cafe24: { state: "ok" | "expiring" | "expired" | "not_connected" | "not_configured" | "error"; refreshExpiresAt?: string } = {
    state: "not_configured",
  };
  if (process.env.CAFE24_MALL_ID && process.env.CAFE24_CLIENT_ID) {
    try {
      const s = await connectionStatus();
      if (!("refreshExpiresAt" in s) || !s.refreshExpiresAt) cafe24 = { state: "not_connected" };
      else {
        const daysLeft = (new Date(s.refreshExpiresAt).getTime() - Date.now()) / 86_400_000;
        cafe24 = {
          state: daysLeft <= 0 ? "expired" : daysLeft < 3 ? "expiring" : "ok",
          refreshExpiresAt: new Date(s.refreshExpiresAt).toISOString(),
        };
      }
    } catch {
      cafe24 = { state: "error" };
    }
  }

  return {
    db: { ok: true, ms: dbMs },
    cron: { lastRunAt: heartbeat?.at ?? null, stale: cronAgeMin === null || cronAgeMin > CRON_STALE_MINUTES },
    inbox: { open: counts.open, oldestWaitHours: counts.oldest === null ? null : Number(counts.oldest) },
    jobs: { pending: counts.pending, dead: counts.dead },
    cafe24,
    integrations: { slack: slackConfigured(), email: emailEnabled() },
    aiCostUsdThisMonth: Number(counts.ai ?? 0),
  };
}
