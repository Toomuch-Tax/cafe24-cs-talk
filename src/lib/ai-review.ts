import { LIVE_SECONDS } from "./ai-chat";
import { appOrigin, enqueueSlack } from "./alerts";
import { CATEGORIES, postAgentMessage } from "./chat";
import type postgres from "postgres";
import { sql } from "./db";
import { HttpError } from "./http";
import { oneLine } from "./slack-format";

// 인박스 'AI 응대'.
// 고객이 위젯에서 AI 와 나눈 대화(ai_chats, 문답 여러 개)를 모은다. 답변 필요 목록과는 따로 둔다.
//  - live   대화 중: 고객이 위젯 대화 화면을 열어 두고 있음 (1분 안에 확인 신호). 담당자가 참여하면 문의로 바뀜
//  - need   확인 필요: 마지막 문답에서 AI 가 넘겼거나(handoff·blocked·error) 고객이 '해결 안 됨'을 눌렀는데, 문의로 이어지지 않고 30분이 지남
//  - linked 문의로 이어짐: 고객이 문의를 남겼거나 담당자가 참여·답변해 문의로 만듦
//  - done   해결됨: AI 가 답했고 '해결됐어요' 또는 반응 없음, 또는 상담원이 '확인함'
// 30분 안의 미해결 대화는 고객이 아직 문의를 쓰는 중일 수 있어 어느 탭에도 넣지 않는다.
// 예전 단발 문답은 마이그레이션 0015 에서 문답 하나짜리 대화가 됐다 (대화 id = 문답 id).
export const NEED_AFTER_MIN = 30;
export const AI_TABS = ["live", "need", "linked", "done"] as const;
export type AiTab = (typeof AI_TABS)[number];

const ACTIVITY = sql`greatest(ch.last_turn_at, coalesce(ch.last_seen_at, ch.last_turn_at))`;
// 대화 뒤 2시간 안에 같은 고객이 남긴 문의는 (AI 화면에서 바로 넘어가지 않았어도) 이어진 것으로 본다. 다른 대화에서 만든 문의는 제외
const LINKED_CONV = sql`coalesce(ch.conversation_id,
    (select a.conversation_id from ai_answers a where a.chat_id = ch.id and a.conversation_id is not null order by a.created_at limit 1),
    (select c.id from conversations c
      where c.contact_id = ch.contact_id and c.submitted_at between ch.created_at and ch.last_turn_at + interval '2 hours'
        and not exists (select 1 from ai_chats o where o.conversation_id = c.id and o.id <> ch.id)
      order by c.submitted_at limit 1))`;
const UNRESOLVED = sql`(l.decision <> 'answered' or f.feedback = 'not_helpful')`;
const GROUP = sql`case
    when ${LINKED_CONV} is not null then 'linked'
    when ch.review = 'dismissed' then 'done'
    when ch.last_seen_at > now() - make_interval(secs => ${LIVE_SECONDS}) then 'live'
    when ${UNRESOLVED} and ${ACTIVITY} < now() - make_interval(mins => ${NEED_AFTER_MIN}) then 'need'
    when ${UNRESOLVED} then 'waiting'
    else 'done' end`;
// 마지막 문답(l)과 가장 최근 반응(f)
const FROM = sql`ai_chats ch
  join contacts ct on ct.id = ch.contact_id
  join lateral (select a.question, a.answer, a.decision, a.reason, a.category from ai_answers a
    where a.chat_id = ch.id order by a.created_at desc limit 1) l on true
  left join lateral (select a.feedback, a.feedback_at from ai_answers a
    where a.chat_id = ch.id and a.feedback is not null order by a.feedback_at desc nulls last limit 1) f on true`;
const RECENT = sql`ch.last_turn_at > now() - interval '90 days'`;

export type AiReviewRow = {
  id: string;
  grp: AiTab | "waiting";
  question: string; // 마지막 질문
  answer: string | null;
  decision: "answered" | "handoff" | "blocked" | "error";
  reason: string | null;
  feedback: "helpful" | "not_helpful" | null;
  category: string | null;
  page_url: string | null;
  created_at: string;
  activity_at: string;
  last_seen_at: string | null;
  turns: number;
  contact_id: string;
  contact_name: string | null;
  member_id: string | null;
  email: string | null;
  linked_conversation_id: string | null;
  topics: string[];
};

const ROW = sql`
  ch.id, ${GROUP} as grp, l.question, l.answer, l.decision, l.reason, f.feedback, l.category, ch.page_url, ch.created_at,
  ${ACTIVITY} as activity_at, ch.last_seen_at,
  (select count(*)::int from ai_answers a where a.chat_id = ch.id) as turns,
  ch.contact_id, ct.name as contact_name, ct.verified_member_id as member_id, ct.email,
  ${LINKED_CONV} as linked_conversation_id,
  coalesce((select array_agg(distinct t.slug order by t.slug) from ai_answers a
    join policy_topics t on t.id = any(a.topic_ids) and t.kind = 'topic' where a.chat_id = ch.id), '{}') as topics`;

// today_*: 오늘(한국 시간) 시작한 대화 중 결과가 난 것(대화 중·30분 대기 제외)과 그중 AI 가 혼자 끝낸 것 — 관제 보드의 'AI 해결률'
export type AiReviewCounts = Record<AiTab, number> & { today_done: number; today_total: number };

export async function aiReviewCounts() {
  const [row] = await sql<AiReviewCounts[]>`
    select count(*) filter (where g = 'live')::int as live,
           count(*) filter (where g = 'need')::int as need,
           count(*) filter (where g = 'linked')::int as linked,
           count(*) filter (where g = 'done')::int as done,
           count(*) filter (where today and g = 'done' and review is distinct from 'dismissed')::int as today_done,
           count(*) filter (where today and g in ('need', 'linked', 'done'))::int as today_total
    from (select ${GROUP} as g, ch.review,
            ch.created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as today
          from ${FROM} where ${RECENT}) x`;
  return row;
}

export async function listAiReview(tab: AiTab) {
  return sql<AiReviewRow[]>`
    select * from (select ${ROW} from ${FROM} where ${RECENT}) x
    where x.grp = ${tab}
    order by x.activity_at ${tab === "need" ? sql`asc` : sql`desc`}
    limit 200`;
}

export type AiReviewTurn = {
  id: string;
  question: string;
  answer: string | null;
  decision: AiReviewRow["decision"];
  reason: string | null;
  feedback: AiReviewRow["feedback"];
  feedback_at: string | null;
  created_at: string;
  topics: string[];
};

export async function getAiReview(id: string) {
  const [row] = await sql<
    (AiReviewRow & {
      feedback_at: string | null;
      review: "dismissed" | "replied" | null;
      reviewed_at: string | null;
      reviewer_name: string | null;
      joined_at: string | null;
      joined_name: string | null;
      linked_submitted_at: string | null;
    })[]
  >`
    select x.*, lc.submitted_at as linked_submitted_at from (
      select ${ROW}, f.feedback_at, ch.review, ch.reviewed_at, rv.name as reviewer_name, ch.joined_at, jn.name as joined_name
      from ${FROM}
        left join agents rv on rv.id = ch.reviewed_by
        left join agents jn on jn.id = ch.joined_by
      where ch.id = ${id}
    ) x left join conversations lc on lc.id = x.linked_conversation_id`;
  if (!row) throw new HttpError(404, "not_found");
  const turns = await sql<AiReviewTurn[]>`
    select a.id, a.question, a.answer, a.decision, a.reason, a.feedback, a.feedback_at, a.created_at,
      coalesce((select array_agg(t.slug order by t.slug) from policy_topics t where t.id = any(a.topic_ids) and t.kind = 'topic'), '{}') as topics
    from ai_answers a where a.chat_id = ${id} order by a.created_at`;
  return { ...row, turnList: turns };
}

// 확인함: 답변 없이 정리 (해결됨으로). 문답 쪽에도 남겨 위젯 '새 답변 확인' 대상에서 뺀다
export async function dismissAiReview(id: string, agentId: string) {
  await sql.begin(async (tx) => {
    const done = await tx`update ai_chats set review = 'dismissed', reviewed_at = now(), reviewed_by = ${agentId}
      where id = ${id} and review is null returning id`;
    if (done.length)
      await tx`update ai_answers set review = 'dismissed', reviewed_at = now(), reviewed_by = ${agentId}
        where chat_id = ${id} and review is null`;
  });
}

// 대화를 고객의 문의로 바꾼다: 문답을 메시지로 옮기고(중복 방지 키 ai-q:/ai-a:), 대화·문답에 문의를 연결한다.
// 이미 문의로 이어졌으면 409 already_linked:<문의 id>
async function convertChat(tx: postgres.TransactionSql, id: string, agentId: string, mode: "join" | "reply") {
  const [ch] = await tx<
    { id: string; contact_id: string; page_url: string | null; created_at: Date; last_turn_at: Date; linked: string | null }[]
  >`
    select ch.id, ch.contact_id, ch.page_url, ch.created_at, ch.last_turn_at, ${LINKED_CONV} as linked
    from ai_chats ch where ch.id = ${id} for update`;
  if (!ch) throw new HttpError(404, "not_found");
  if (ch.linked) throw new HttpError(409, `already_linked:${ch.linked}`);
  const turns = await tx<
    { id: string; question: string; answer: string | null; decision: string; category: string | null; created_at: Date }[]
  >`select id, question, answer, decision, category, created_at from ai_answers where chat_id = ${id} order by created_at`;
  if (!turns.length) throw new HttpError(404, "not_found");
  const last = turns[turns.length - 1];
  const picked = [...turns].reverse().find((t) => (CATEGORIES as readonly string[]).includes(t.category ?? "") && t.category !== "etc");
  const category = picked?.category ?? "etc";

  // 고객이 읽은 시각은 마지막 질문 시각으로 둔다 → 담당자 답변이 '새 답변'으로 잡혀 배지·메일이 나간다
  // (위젯이 열려 있으면 위젯이 곧바로 읽음 처리한다)
  const [conv] = await tx<{ id: string }[]>`
    insert into conversations (contact_id, page_url, category, submitted_at, created_at, assigned_agent_id,
      last_message_at, last_message_preview, last_customer_message_at, customer_last_read_at)
    values (${ch.contact_id}, ${ch.page_url}, ${category}, now(), ${ch.created_at}, ${mode === "join" ? agentId : null},
      ${last.created_at}, ${last.question.replace(/\s+/g, " ").trim().slice(0, 80)}, ${last.created_at}, ${last.created_at})
    returning id`;
  await tx`insert into conversation_events (conversation_id, agent_id, type, data)
    values (${conv.id}, ${agentId}, 'created', ${sql.json({ category, from_ai_chat: id, joined: mode === "join" })})`;
  for (const t of turns) {
    await tx`insert into messages (conversation_id, sender_type, body, client_message_id, created_at)
      values (${conv.id}, 'customer', ${t.question}, ${`ai-q:${t.id}`}, ${t.created_at})`;
    if (t.decision === "answered" && t.answer)
      await tx`insert into messages (conversation_id, sender_type, body, ai_kind, client_message_id, created_at)
        values (${conv.id}, 'ai', ${t.answer}, 'auto_sent', ${`ai-a:${t.id}`}, ${t.created_at})`;
  }
  if (mode === "join") {
    await tx`update ai_chats set conversation_id = ${conv.id}, joined_by = ${agentId}, joined_at = now() where id = ${id}`;
    await tx`update ai_answers set conversation_id = ${conv.id} where chat_id = ${id} and conversation_id is null`;
  } else {
    await tx`update ai_chats set conversation_id = ${conv.id}, review = 'replied', reviewed_at = now(), reviewed_by = ${agentId}
      where id = ${id}`;
    await tx`update ai_answers set conversation_id = ${conv.id}, review = 'replied', reviewed_at = now(), reviewed_by = ${agentId}
      where chat_id = ${id} and conversation_id is null`;
  }
  return conv.id;
}

// 대화 참여 (B1): 고객이 아직 위젯을 보고 있는 대화를 문의로 바꿔 내 담당으로 둔다. 그 뒤로 AI 는 이 대화에서 답하지 않고,
// 고객 위젯은 몇 초 안에 이를 알아채 담당자 답을 이어서 보여준다. 답은 문의 화면에서 평소처럼 쓴다.
export async function joinAiChat(id: string, agentId: string) {
  return sql.begin((tx) => convertChat(tx, id, agentId, "join"));
}

// 답변 남기기: 떠난 고객의 대화를 문의로 만들고 상담원 답변을 붙인다 → '답변 완료'.
// 고객은 위젯 '내 문의'·버튼 배지(·남긴 메일)로 받는다. 이미 문의로 이어졌으면 그 문의를 알려준다.
export async function replyFromAi(id: string, agentId: string, input: { clientMessageId: string; body: string }) {
  const conversationId = await sql.begin((tx) => convertChat(tx, id, agentId, "reply"));
  const result = await postAgentMessage(conversationId, agentId, { ...input, internal: false });
  return { conversationId, message: result.message, duplicate: result.duplicate };
}

// 문의 화면에 "AI 응대에서 이어진 문의" 표시용 (id 는 대화 id → /ai?a=<id>)
export async function aiOriginOf(conversationId: string) {
  const [row] = await sql<
    { id: string; question: string; decision: string; reason: string | null; review: string | null; joined: boolean; created_at: string }[]
  >`
    select ch.id, ch.review, ch.joined_at is not null as joined, ch.created_at,
      (select a.question from ai_answers a where a.chat_id = ch.id order by a.created_at limit 1) as question,
      l.decision, l.reason
    from ai_chats ch
    join lateral (select a.decision, a.reason from ai_answers a where a.chat_id = ch.id order by a.created_at desc limit 1) l on true
    where ch.conversation_id = ${conversationId}
       or exists (select 1 from ai_answers a where a.chat_id = ch.id and a.conversation_id = ${conversationId})
    order by ch.created_at limit 1`;
  return row ?? null;
}

// 고객이 문의 양식에서 접수하면 그 문답에 연결 (본인 문답만)
export async function linkAiAnswer(answerId: string, contactId: string, conversationId: string) {
  await sql`update ai_answers set conversation_id = ${conversationId}
    where id = ${answerId} and contact_id = ${contactId} and kind = 'customer_answer' and conversation_id is null`;
}

// 크론: 새로 '확인 필요'가 된 대화를 슬랙에 한 번씩 알린다 (질문은 연락처·주소를 가리고 한 줄만)
export async function alertAiNeedReview() {
  const rows = await sql<{ id: string; question: string; decision: string; turns: number }[]>`
    select * from (
      select ch.id, l.question, l.decision, (select count(*)::int from ai_answers a where a.chat_id = ch.id) as turns,
        ${GROUP} as g
      from ${FROM}
      where ch.last_turn_at > now() - interval '1 day'
    ) x where x.g = 'need'`;
  for (const r of rows) {
    const why = r.decision === "answered" ? "AI 답변 후 '해결 안 됨'" : "AI가 상담원에게 넘김";
    const more = r.turns > 1 ? ` · AI와 ${r.turns}번 주고받음` : "";
    await enqueueSlack(
      `slack:ai_need:${r.id}`,
      `:robot_face: *AI 응대 확인 필요* · ${why}${more} · 고객이 문의를 남기지 않고 떠났어요\n> ${oneLine(r.question, 80)}\n<${appOrigin()}/ai?a=${r.id}|AI 응대에서 답변하기 →>`,
    );
  }
  return rows.length;
}
