import { answerCustomer } from "./ai/engine";
import { HISTORY_TURNS } from "./ai/prompt";
import { replyToInquiry } from "./chat";
import { sql } from "./db";
import { HttpError } from "./http";

// 위젯 AI 대화 이어가기.
// 고객이 AI 와 여러 번 주고받은 문답을 ai_chats 한 묶음으로 둔다. 문답 하나하나는 지금처럼 ai_answers.
// 담당자가 참여하면(src/lib/ai-review.ts joinAiChat) 대화가 문의로 바뀌고, 그 뒤로 AI 는 이 대화에서 답하지 않는다.

// 위젯이 열려 있고 화면에 보이는 동안 이 간격으로 확인한다 (닫히거나 숨으면 멈춤)
export const CHAT_POLL_MS = 4000;
// 마지막 확인이 이 시간 안이면 인박스에 '대화 중'
export const LIVE_SECONDS = 60;
// 돌아온 고객에게 '이어서 대화하기'를 보여주는 시간
export const RESUME_MINUTES = 30;

type ChatRow = { id: string; conversation_id: string | null };

async function ownedChat(contactId: string, chatId: string) {
  const [chat] = await sql<ChatRow[]>`select id, conversation_id from ai_chats where id = ${chatId} and contact_id = ${contactId}`;
  if (!chat) throw new HttpError(404, "not_found");
  return chat;
}

export type ChatTurnOut = {
  answerId: string;
  question: string;
  decision: "answered" | "handoff" | "blocked" | "error";
  answer: string | null;
  category: string;
};

// 질문 하나: 대화가 없으면 새로 만들고, 앞선 문답을 맥락으로 AI 에게 묻는다.
// 그 사이 담당자가 참여해 문의로 바뀌었으면 AI 에게 묻지 않고 그 문의에 고객 메시지로 남긴다.
export async function askInChat(input: {
  contactId: string;
  chatId: string | null;
  question: string;
  pageUrl: string | null;
  clientMessageId: string;
  // 예전 단발 화면(미공개 기능이 꺼진 위젯)은 새 답을 확인하지 않으므로 '대화 중'으로 표시하지 않는다
  watching?: boolean;
}): Promise<{ chatId: string; conversationId: string | null; turn: ChatTurnOut | null }> {
  let chatId = input.chatId;
  if (chatId) {
    const chat = await ownedChat(input.contactId, chatId);
    if (chat.conversation_id) {
      await replyToInquiry(input.contactId, chat.conversation_id, { clientMessageId: input.clientMessageId, body: input.question });
      return { chatId, conversationId: chat.conversation_id, turn: null };
    }
  } else {
    const [chat] = await sql<{ id: string }[]>`
      insert into ai_chats (contact_id, page_url, last_seen_at)
      values (${input.contactId}, ${input.pageUrl}, ${input.watching === false ? null : sql`now()`}) returning id`;
    chatId = chat.id;
  }

  const history = chatId
    ? (
        await sql<{ question: string; answer: string | null; decision: string }[]>`
          select question, answer, decision from (
            select question, answer, decision, created_at from ai_answers
            where chat_id = ${chatId} order by created_at desc limit ${HISTORY_TURNS}) x
          order by created_at`
      ).map((t) => ({ q: t.question, a: t.decision === "answered" ? t.answer : null }))
    : [];

  const r = await answerCustomer({ question: input.question, pageUrl: input.pageUrl, contactId: input.contactId, chatId, history });
  await sql`update ai_chats set last_turn_at = now()${input.watching === false ? sql`` : sql`, last_seen_at = now()`} where id = ${chatId}`;
  return {
    chatId,
    conversationId: null,
    turn: { answerId: r.answerId, question: input.question, decision: r.decision, answer: r.answer, category: r.category },
  };
}

// 위젯이 몇 초마다 묻는다: 담당자가 참여했는지(→ 문의 id). 묻는 것 자체가 '고객이 지금 보고 있음' 표시라
// 마지막 확인 시각을 남긴다 (매번 쓰지 않고 15초에 한 번).
export async function pollChat(contactId: string, chatId: string) {
  const [chat] = await sql<ChatRow[]>`
    update ai_chats set last_seen_at = case when last_seen_at is null or last_seen_at < now() - interval '15 seconds'
      then now() else last_seen_at end
    where id = ${chatId} and contact_id = ${contactId}
    returning id, conversation_id`;
  if (!chat) throw new HttpError(404, "not_found");
  return { conversationId: chat.conversation_id };
}

// 고객이 대화를 끝냄 → '대화 중' 표시를 바로 끈다 (문답 기록은 그대로)
export async function endChat(contactId: string, chatId: string) {
  await sql`update ai_chats set last_seen_at = null where id = ${chatId} and contact_id = ${contactId}`;
}

// 위젯 '대화' 탭에 보여줄 최근 AI 대화 (마지막 문답 미리보기). 담당자가 참여해 문의로 바뀐 대화는 문의 목록에 있으니 뺀다
export const LIST_DAYS = 14;
export async function listChats(contactId: string) {
  return sql<{ id: string; last_turn_at: string; preview: string }[]>`
    select ch.id, ch.last_turn_at, coalesce(t.answer, t.question) as preview
    from ai_chats ch
    cross join lateral (
      select question, case when decision = 'answered' then answer end as answer
      from ai_answers where chat_id = ch.id order by created_at desc limit 1) t
    where ch.contact_id = ${contactId} and ch.conversation_id is null
      and ch.last_turn_at > now() - make_interval(days => ${LIST_DAYS})
    order by ch.last_turn_at desc limit 20`;
}

// 쇼핑몰 다른 페이지로 옮겨 위젯이 새로 열려도 대화를 이어가도록 문답을 돌려준다
export async function chatForWidget(contactId: string, chatId: string) {
  const [chat] = await sql<(ChatRow & { recent: boolean })[]>`
    select id, conversation_id, last_turn_at > now() - make_interval(mins => ${RESUME_MINUTES}) as recent
    from ai_chats where id = ${chatId} and contact_id = ${contactId}`;
  if (!chat) throw new HttpError(404, "not_found");
  const turns = await sql<ChatTurnOut[]>`
    select id as "answerId", question, decision, case when decision = 'answered' then answer end as answer,
      coalesce(category, 'etc') as category
    from ai_answers where chat_id = ${chatId} order by created_at`;
  return { conversationId: chat.conversation_id, recent: chat.recent, turns };
}
