import { after } from "next/server";
import { CATEGORY_LABEL } from "@/components/inbox/labels";
import { mediaLabel } from "./attachments";
import { sql } from "./db";
import { escapeSlack, oneLine, quoteBody, waitText } from "./slack-format";
import { type Triage, triage } from "./triage";

// 슬랙 운영 알림 (Incoming Webhook). SLACK_WEBHOOK_URL 이 없으면 아무것도 보내지 않는다.
// - 업무 알림(신규 문의·추가 문의·답변 지연·일일 요약): notification_jobs 대기열 → 실패 시 cron 이 재시도, dedupe_key 로 중복 방지
// - 장애 알림(500 오류): DB 가 죽어 있어도 나가야 하므로 대기열을 거치지 않고 바로 보낸다
// 문의 내용은 대응 여부를 판단할 만큼만 보낸다 (연락처·이메일·계좌·주소는 가리고 자름, 고객 이름·회원 아이디는 안 보냄).

export class SlackNotConfigured extends Error {}

export const slackConfigured = () => Boolean(process.env.SLACK_WEBHOOK_URL);
export const appOrigin = () => process.env.APP_ORIGIN ?? "http://localhost:3000";
export const categoryLabel = (c: string | null | undefined) => (c ? (CATEGORY_LABEL[c] ?? c) : "기타");

export async function postSlack(text: string) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new SlackNotConfigured("SLACK_WEBHOOK_URL is not set");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`slack ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
}

export async function enqueueSlack(dedupeKey: string, text: string, conversationId?: string | null) {
  if (!slackConfigured()) return null;
  const [job] = await sql<{ id: string }[]>`
    insert into notification_jobs (kind, dedupe_key, conversation_id, payload)
    values ('slack', ${dedupeKey}, ${conversationId ?? null}, ${sql.json({ text })})
    on conflict (dedupe_key) do nothing
    returning id`;
  return job?.id ?? null;
}

// 요청 처리 중에 부른다: 응답을 먼저 돌려주고 뒤에서 발송 (실패하면 cron 이 재시도)
export async function notifySlack(dedupeKey: string, text: string, conversationId?: string | null) {
  try {
    const jobId = await enqueueSlack(dedupeKey, text, conversationId);
    if (jobId) {
      const { processJobs } = await import("./jobs");
      after(() => processJobs({ jobId }).catch((err) => console.error("slack job", err)));
    }
  } catch (err) {
    // 알림 실패가 고객 요청을 실패시키면 안 된다
    console.error("notifySlack", err);
  }
}

export const inboxLink = (conversationId: string) => `${appOrigin()}/inbox?c=${conversationId}`;

// 같은 문의 알림 몰림 방지: 상담원이 답하기 전에는 문의 하나당 COOLDOWN 동안 한 번만 보낸다.
// - 그사이 고객이 더 남기면 바로 보내지 않고, 쿨다운이 끝날 때 "그사이 추가 메시지"로 한 번 묶어 보낸다 (slack_held 작업)
//   그때까지 상담원이 답했거나 문의가 종료됐으면 보내지 않는다
// - 예외: 일반으로 알린 문의가 긴급으로 바뀌면 바로 한 번 더 보낸다
// - 상담원이 답하면 초기화 (답변에 대한 고객 반응은 바로 알린다)
const CONVERSATION_ALERT_COOLDOWN_MIN = 30;

async function notifyConversation(
  dedupeKey: string,
  text: string,
  conversationId: string,
  level: Triage["level"],
) {
  if (!slackConfigured()) return;
  try {
    const jobId = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`slack-conv:${conversationId}`}))`; // 동시에 들어온 메시지끼리 겹치지 않게
      // 묶음 알림(slack_held)은 created_at 을 발송 예정 시각으로 넣어 두므로, 발송 뒤 30분도 같은 창으로 잡힌다
      const recent = await tx<{ id: string; kind: string; level: string | null; created_at: Date }[]>`
        select j.id, j.kind, j.payload->>'level' as level, j.created_at
        from notification_jobs j join conversations c on c.id = j.conversation_id
        where j.conversation_id = ${conversationId} and j.kind in ('slack', 'slack_held')
          and j.dedupe_key ~ '^slack:(new|followup|nudge|held):'
          and j.created_at > now() - make_interval(mins => ${CONVERSATION_ALERT_COOLDOWN_MIN})
          and j.created_at > coalesce(c.last_agent_reply_at, '-infinity'::timestamptz)
        order by j.created_at desc`;
      if (recent.length > 0 && (level !== "urgent" || recent.some((r) => r.level !== "normal"))) {
        // 이미 잡힌 묶음 알림이 있으면 그걸 쓰고(발송 시점에 내용을 모은다), 없으면 창이 끝나는 시각에 하나 잡는다
        if (!recent.some((r) => r.kind === "slack_held" && r.created_at.getTime() > Date.now())) {
          const sendAt = new Date(recent[0].created_at.getTime() + CONVERSATION_ALERT_COOLDOWN_MIN * 60_000);
          await tx`
            insert into notification_jobs (kind, dedupe_key, conversation_id, payload, run_at, created_at)
            values ('slack_held', ${`slack:held:${recent[0].id}`}, ${conversationId}, ${tx.json({ level })}, ${sendAt}, ${sendAt})
            on conflict (dedupe_key) do nothing`;
        }
        return null;
      }
      const [job] = await tx<{ id: string }[]>`
        insert into notification_jobs (kind, dedupe_key, conversation_id, payload)
        values ('slack', ${dedupeKey}, ${conversationId}, ${tx.json({ text, level })})
        on conflict (dedupe_key) do nothing
        returning id`;
      return job?.id ?? null;
    });
    if (jobId) {
      const { processJobs } = await import("./jobs");
      after(() => processJobs({ jobId }).catch((err) => console.error("slack job", err)));
    }
  } catch (err) {
    console.error("notifyConversation", err); // 알림 실패가 고객 요청을 실패시키면 안 된다
  }
}

// 문의 알림: 첫 줄(휴대폰 푸시 미리보기에 보이는 줄)에 긴급도·종류·유형, 그 아래 문의 내용 인용, 마지막 줄에 주문·회원·사진·링크.
// 긴급/일반 판정은 서버에서 문의 내용으로 한다 (src/lib/triage.ts). 본문은 slack-format 에서 연락처·주소 등을 가리고 자른다.
// 고객 이름·회원 아이디는 보내지 않는다.
type ConvMeta = { category: string | null; order_ref: string | null; member: boolean };

async function convMeta(conversationId: string) {
  const [row] = await sql<ConvMeta[]>`
    select c.category, c.order_ref, (ct.verified_member_id is not null) as member
    from conversations c join contacts ct on ct.id = c.contact_id where c.id = ${conversationId}`;
  return row;
}

// "사진 2장 · 동영상 1개" (없으면 빈 문자열)
async function mediaCount(messageIds: string[]) {
  if (messageIds.length === 0) return "";
  const [{ photos, videos }] = await sql<{ photos: number; videos: number }[]>`
    select (count(*) filter (where content_type not like 'video/%'))::int as photos,
      (count(*) filter (where content_type like 'video/%'))::int as videos
    from uploads where message_id in ${sql(messageIds)}`;
  return mediaLabel(photos, videos);
}

function headline(t: Triage, kind: string, category: string | null) {
  const level = t.level === "urgent" ? ":red_circle: *긴급" : ":large_yellow_circle: *일반";
  const tags = [categoryLabel(category), t.type === "일반 문의" ? "" : t.type, ...t.signals].filter(Boolean);
  return `${level} · ${kind}* · ${tags.join(" · ")}`;
}

function footer(conversationId: string, meta: ConvMeta | undefined, media: string, extra: string[] = []) {
  const parts = [
    meta?.order_ref ? `주문 ${escapeSlack(meta.order_ref)}` : "주문번호 없음",
    meta?.member ? "회원" : "비회원",
    media,
    ...extra,
    `<${inboxLink(conversationId)}|인박스에서 답변하기 →>`,
  ];
  return parts.filter(Boolean).join(" · ");
}

export async function notifyNewInquiry(conv: { id: string; messageId: string; category: string | null; body: string }) {
  try {
    const [meta, photos] = await Promise.all([convMeta(conv.id), mediaCount([conv.messageId])]);
    const t = triage(conv.body, conv.category);
    await notifyConversation(
      `slack:new:${conv.id}`,
      [headline(t, "새 문의", conv.category), quoteBody(conv.body), footer(conv.id, meta, photos)].join("\n"),
      conv.id,
      t.level,
    );
  } catch (err) {
    console.error("notifyNewInquiry", err);
  }
}

// 답변 후(또는 종료 후)에 고객이 다시 씀. 직전 답변을 한 줄 붙여서 무엇에 대한 반응인지 바로 보이게 한다.
export async function notifyFollowUp(conv: { id: string; messageId: string; reopened: boolean; body: string }) {
  try {
    const [meta, photos, [lastReply]] = await Promise.all([
      convMeta(conv.id),
      mediaCount([conv.messageId]),
      sql<{ body: string }[]>`
        select body from messages where conversation_id = ${conv.id} and sender_type = 'agent' and not internal
        order by seq desc limit 1`,
    ]);
    const t = triage(conv.body, meta?.category);
    const lines = [
      headline(t, conv.reopened ? "종료된 문의 다시 열림" : "추가 문의", meta?.category ?? null),
      quoteBody(conv.body),
    ];
    if (lastReply) lines.push(`_직전 답변: ${oneLine(lastReply.body, 80)}_`);
    lines.push(footer(conv.id, meta, photos));
    await notifyConversation(`slack:followup:${conv.messageId}`, lines.join("\n"), conv.id, t.level);
  } catch (err) {
    console.error("notifyFollowUp", err);
  }
}

// 상담원 답변 전에 고객이 같은 문의에 또 남김. 첫 메시지 후 NUDGE_AFTER_MIN 이 지났으면 재촉(항상 긴급),
// 그 전이면 말을 이어 쓰는 중으로 보고 내용대로 판정한다 (몰림 방지는 notifyConversation).
// 답변 전에 남긴 메시지(최근 3개)를 시각과 함께 보여준다.
const NUDGE_AFTER_MIN = 10;

export async function notifyNudge(conv: { id: string; messageId: string }) {
  try {
    const [meta, pending] = await Promise.all([
      convMeta(conv.id),
      sql<{ id: string; body: string; created_at: string }[]>`
        select m.id, m.body, m.created_at from messages m join conversations c on c.id = m.conversation_id
        where m.conversation_id = ${conv.id} and m.sender_type = 'customer'
          and m.created_at > coalesce(c.last_agent_reply_at, '-infinity'::timestamptz)
        order by m.seq`,
    ]);
    if (pending.length === 0) return;
    const photos = await mediaCount(pending.map((m) => m.id));
    const t = triage(pending.map((m) => m.body).join("\n"), meta?.category);
    const waited = (Date.now() - new Date(pending[0].created_at).getTime()) / 3_600_000;
    const nudge = waited * 60 >= NUDGE_AFTER_MIN;
    if (nudge) t.level = "urgent"; // 재촉은 제목에 이미 있으니 신호에는 다시 붙이지 않는다
    const shown = pending.slice(-3);
    const quote = [
      ...(pending.length > shown.length ? [`> _…앞선 메시지 ${pending.length - shown.length}개_`] : []),
      ...shown.map((m) => `> \`${kstTime(m.created_at)}\` ${oneLine(m.body, 120)}`),
    ].join("\n");
    await notifyConversation(
      `slack:nudge:${conv.messageId}`,
      [
        headline(t, nudge ? "재촉" : "추가 메시지", meta?.category ?? null),
        quote,
        footer(conv.id, meta, photos, [`답변 전 메시지 ${pending.length}개`, `${waitText(waited)}째 대기`]),
      ].join("\n"),
      conv.id,
      t.level,
    );
  } catch (err) {
    console.error("notifyNudge", err);
  }
}

// 쿨다운 동안 모아 둔 메시지를 한 번에 알린다 (jobs.ts 가 slack_held 작업을 처리할 때 부름). 보낼 게 없으면 null.
export async function heldAlertText(jobId: string, conversationId: string) {
  const [conv] = await sql<
    { status: string; last_agent_reply_at: Date | null; since: Date | null; first_pending: Date | null }[]
  >`
    select c.status, c.last_agent_reply_at,
      (select min(m.created_at) from messages m where m.conversation_id = c.id and m.sender_type = 'customer'
         and m.created_at > coalesce(c.last_agent_reply_at, '-infinity'::timestamptz)) as first_pending,
      (select max(j.created_at) from notification_jobs j
       where j.conversation_id = c.id and j.id <> ${jobId} and j.created_at <= now()
         and j.dedupe_key ~ '^slack:(new|followup|nudge|held):') as since
    from conversations c where c.id = ${conversationId}`;
  if (!conv || conv.status !== "open" || !conv.since) return null;
  if (conv.last_agent_reply_at && conv.last_agent_reply_at > conv.since) return null; // 그사이 상담원이 답함
  const held = await sql<{ id: string; body: string; created_at: string }[]>`
    select id, body, created_at from messages
    where conversation_id = ${conversationId} and sender_type = 'customer' and created_at > ${conv.since}
    order by seq`;
  if (held.length === 0) return null;
  const [meta, photos] = await Promise.all([convMeta(conversationId), mediaCount(held.map((m) => m.id))]);
  const t = triage(held.map((m) => m.body).join("\n"), meta?.category);
  // 첫 메시지 후 한참 지나서 또 쓴 게 있으면 재촉
  const firstAt = (conv.first_pending ?? conv.since).getTime();
  if (held.some((m) => new Date(m.created_at).getTime() - firstAt >= NUDGE_AFTER_MIN * 60_000)) {
    t.level = "urgent";
    t.signals = ["재촉", ...t.signals];
  }
  const shown = held.slice(-3);
  return [
    headline(t, `그사이 추가 메시지 ${held.length}개`, meta?.category ?? null),
    ...(held.length > shown.length ? [`> _…앞선 메시지 ${held.length - shown.length}개_`] : []),
    ...shown.map((m) => `> \`${kstTime(m.created_at)}\` ${oneLine(m.body, 120)}`),
    footer(conversationId, meta, photos, ["아직 답변 전"]),
  ].join("\n");
}

const kstTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );

// 처리되지 않은 서버 오류. 같은 인스턴스에서 같은 종류는 10분에 한 번만 보낸다 (장애 시 폭주 방지).
const lastErrorAlert = new Map<string, number>();
const ERROR_ALERT_INTERVAL_MS = 10 * 60 * 1000;

export function reportError(where: string, err: unknown) {
  if (!slackConfigured() || process.env.NODE_ENV !== "production") return;
  const message = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 200);
  const key = `${where}:${message.slice(0, 60)}`;
  const now = Date.now();
  if (now - (lastErrorAlert.get(key) ?? 0) < ERROR_ALERT_INTERVAL_MS) return;
  lastErrorAlert.set(key, now);
  const send = () => postSlack(`:rotating_light: 서버 오류 · \`${where}\`\n\`\`\`${message}\`\`\``).catch(() => {});
  try {
    after(send);
  } catch {
    void send(); // 요청 밖에서 불린 경우
  }
}
