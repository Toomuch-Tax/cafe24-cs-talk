import { enqueueSlack, heldAlertText, inboxLink, postSlack, SlackNotConfigured } from "./alerts";
import { mediaLabel } from "./attachments";
import { sql } from "./db";
import { EmailNotConfigured, replyEmail, sendEmail } from "./email";
import { getPublicProfile } from "./profile";
import { getSetting } from "./settings";
import { signThreadToken } from "./thread-token";

// 알림 작업 큐 (notification_jobs). dedupe_key 로 같은 답변 메일이 두 번 나가지 않게 한다.
const MAX_ATTEMPTS = 5;

// 비회원 답변 메일: 답변 후 이 시간이 지나도 고객이 문의를 열어보지 않았을 때만 보낸다 (설정 reply_email_delay_min)
const DEFAULT_EMAIL_DELAY_MIN = 60;

export async function enqueueReplyEmail(conversationId: string, messageId: string) {
  const delay = Number(await getSetting<number>("reply_email_delay_min"));
  const minutes = Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_EMAIL_DELAY_MIN;
  const [job] = await sql<{ id: string }[]>`
    insert into notification_jobs (kind, dedupe_key, conversation_id, payload, run_at)
    values ('email_reply', ${`email_reply:${messageId}`}, ${conversationId}, ${sql.json({ messageId })},
      now() + make_interval(mins => ${minutes}))
    on conflict (dedupe_key) do nothing
    returning id`;
  return job?.id ?? null;
}

type Job = {
  id: string;
  kind: string;
  conversation_id: string;
  payload: { messageId?: string; text?: string };
  attempts: number;
};

// 상담원이 답변을 여러 번에 나눠 보내도 메일은 한 통: 더 뒤에 쓴 답변이 있으면 그 답변의 작업에 맡기고 건너뛴다.
// 보낼 때는 고객이 아직 읽지 않은 답변을 모두 순서대로 담는다. 대기 시간(60분)은 마지막 답변 기준이 된다.
async function runEmailJob(job: Job) {
  if (!job.payload.messageId) return { status: "skipped" as const, error: "message_missing" };
  const [row] = await sql<
    { email: string | null; contact_id: string; member_id: string | null; seq: string | null; replied_at: Date | null;
      category: string | null; last_read: Date | null; newer: boolean }[]
  >`
    select ct.email, ct.id as contact_id, ct.verified_member_id as member_id, c.category,
      c.customer_last_read_at as last_read, m.seq, m.created_at as replied_at,
      exists (select 1 from messages n where n.conversation_id = c.id and n.seq > m.seq
        and n.sender_type = 'agent' and not n.internal) as newer
    from conversations c join contacts ct on ct.id = c.contact_id
    left join messages m on m.id = ${job.payload.messageId}
    where c.id = ${job.conversation_id}`;
  if (!row?.seq || !row.replied_at) return { status: "skipped" as const, error: "message_missing" };
  // 회원은 위젯 배지·내 문의로 확인하므로 메일을 보내지 않는다. 고객이 이미 열어봤어도 보내지 않는다.
  if (row.member_id) return { status: "skipped" as const, error: "member" };
  if (row.last_read && row.last_read >= row.replied_at) return { status: "skipped" as const, error: "already_read" };
  if (!row.email) return { status: "skipped" as const, error: "no_email" };
  if (row.newer) return { status: "skipped" as const, error: "superseded" };

  // 고객이 마지막으로 읽은 뒤의 답변 전부 (이 답변까지)
  const replies = await sql<{ body: string; photos: number; videos: number }[]>`
    select body,
      (select count(*) from jsonb_array_elements(attachments) a where a->>'type' not like 'video/%')::int as photos,
      (select count(*) from jsonb_array_elements(attachments) a where a->>'type' like 'video/%')::int as videos
    from messages
    where conversation_id = ${job.conversation_id} and sender_type = 'agent' and not internal
      and seq <= ${row.seq} and created_at > coalesce(${row.last_read}::timestamptz, 'epoch')
    order by seq`;
  const [question] = await sql<{ body: string }[]>`
    select body from messages where conversation_id = ${job.conversation_id} and sender_type = 'customer'
      and seq < ${row.seq}
    order by seq desc limit 1`;
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const link = `${origin}/t/${await signThreadToken(job.conversation_id, row.contact_id)}`;
  const { name: sender, avatarUrl } = await getPublicProfile();
  const mail = replyEmail({
    // 사진·동영상은 메일에 싣지 않고(비공개 저장소) 대화 링크에서 보도록 안내만 한다
    replies: replies.map((r) => {
      const media = mediaLabel(r.photos, r.videos);
      return [r.body, media ? `(${media} — 아래 ‘대화 이어가기’에서 볼 수 있어요)` : ""].filter(Boolean).join("\n\n");
    }),
    link,
    question: question?.body ?? null,
    sender,
    category: row.category,
    repliedAt: row.replied_at,
    origin,
    avatarUrl,
  });
  await sendEmail({ to: row.email, fromName: sender, ...mail });
  return { status: "sent" as const, error: null };
}

// 지정한 작업(또는 대기 중인 작업들)을 처리한다. 동시에 여러 곳에서 불려도 skip locked 로 한 번씩만 처리.
export async function processJobs(opts: { jobId?: string; limit?: number } = {}) {
  const results: { id: string; status: string }[] = [];
  const limit = opts.limit ?? 20;
  for (let i = 0; i < limit; i++) {
    const job = await sql.begin(async (tx) => {
      const [j] = await tx<Job[]>`
        select id, kind, conversation_id, payload, attempts from notification_jobs
        where status in ('pending', 'failed') and attempts < ${MAX_ATTEMPTS} and run_at <= now()
          ${opts.jobId ? sql`and id = ${opts.jobId}` : sql``}
        order by run_at limit 1 for update skip locked`;
      if (!j) return null;
      // 처리 중 표시: run_at 을 미뤄 두면 다른 워커가 집어가지 않는다
      await tx`update notification_jobs set attempts = attempts + 1, run_at = now() + interval '5 minutes',
        updated_at = now() where id = ${j.id}`;
      return j;
    });
    if (!job) break;

    let status: "sent" | "skipped" | "failed" = "failed";
    let error: string | null = null;
    try {
      if (job.kind === "slack") {
        await postSlack(job.payload.text ?? "");
        status = "sent";
      } else if (job.kind === "slack_held") {
        const text = await heldAlertText(job.id, job.conversation_id);
        if (text) {
          await postSlack(text);
          status = "sent";
        } else [status, error] = ["skipped", "nothing_to_send"];
      } else if (job.kind === "email_reply") {
        ({ status, error } = await runEmailJob(job));
      } else {
        throw new Error(`unknown job kind ${job.kind}`);
      }
    } catch (err) {
      status = "failed";
      error = err instanceof EmailNotConfigured ? "email_not_configured" : String(err).slice(0, 300);
      // 슬랙 연결이 빠진 상태의 알림은 나중에 보내도 의미가 없으니 건너뛴다
      if (err instanceof SlackNotConfigured) [status, error] = ["skipped", "slack_not_configured"];
    }
    if (error === "email_not_configured") {
      // 메일 발송이 아직 연결되지 않음 → 재시도 횟수를 쓰지 않고 15분 뒤 다시 확인 (연결되면 밀린 메일이 나간다)
      await sql`update notification_jobs set status = 'pending', attempts = attempts - 1, last_error = ${error},
        run_at = now() + interval '15 minutes', updated_at = now() where id = ${job.id}`;
      results.push({ id: job.id, status: "waiting_config" });
      if (opts.jobId) break;
      continue;
    }
    const backoffMin = 2 ** (job.attempts + 1); // 2, 4, 8, 16 ... 분
    await sql`update notification_jobs set status = ${status}, last_error = ${error}, updated_at = now(),
      run_at = case when ${status} = 'failed' then now() + make_interval(mins => ${backoffMin}) else run_at end
      where id = ${job.id}`;
    if (job.kind === "email_reply") {
      await sql`insert into conversation_events (conversation_id, type, data)
        values (${job.conversation_id}, ${status === "sent" ? "email_sent" : status === "skipped" ? "email_skipped" : "email_failed"},
          ${sql.json({ error })})`;
    }
    // 재시도를 다 쓰고도 실패한 작업은 사람이 봐야 한다 (슬랙 알림 자체의 실패는 슬랙으로 알릴 수 없으니 제외)
    if (status === "failed" && job.attempts + 1 >= MAX_ATTEMPTS && !job.kind.startsWith("slack")) {
      await enqueueSlack(
        `slack:dead:${job.id}`,
        `:warning: 작업이 ${MAX_ATTEMPTS}번 모두 실패했어요 · ${job.kind}\n\`${(error ?? "").slice(0, 150)}\`` +
          (job.conversation_id ? `\n<${inboxLink(job.conversation_id)}|문의 보기>` : ""),
        job.conversation_id,
      );
    }
    results.push({ id: job.id, status });
    if (opts.jobId) break;
  }
  return results;
}

// 관리자: 이 문의의 대기 중인 답변 메일을 기다리지 않고 지금 처리한다 (테스트·급한 안내용).
// 보낼지 말지는 평소와 같은 조건(회원·이미 읽음·이메일 없음이면 건너뜀)으로 판단한다.
export async function sendReplyEmailNow(conversationId: string) {
  const jobs = await sql<{ id: string }[]>`
    update notification_jobs set run_at = now(), updated_at = now()
    where conversation_id = ${conversationId} and kind = 'email_reply'
      and status in ('pending', 'failed') and attempts < ${MAX_ATTEMPTS}
    returning id`;
  const results: { id: string; status: string }[] = [];
  for (const j of jobs) results.push(...(await processJobs({ jobId: j.id })));
  return results;
}

// 답변 후 N일간 고객 추가 문의가 없으면 종료
export async function autoCloseStale(days: number) {
  const rows = await sql<{ id: string }[]>`
    update conversations set status = 'resolved', resolved_at = now()
    where status = 'waiting_customer' and last_agent_reply_at < now() - make_interval(days => ${days})
    returning id`;
  for (const r of rows) {
    await sql`insert into conversation_events (conversation_id, type, data) values (${r.id}, 'auto_closed', ${sql.json({ days })})`;
  }
  return rows.length;
}
