import { maskPersonal } from "@/lib/slack-format";
import { CATEGORY_LABEL, STATUS_LABEL } from "./labels";

// 문의 고유 주소. 팀원끼리 공유하거나 노션에 기록하는 용도 — 열면 로그인 확인 뒤 바로 그 문의로 간다.
export const conversationUrl = (id: string) => `${location.origin}/inbox?c=${id}`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 서식 있는 칸(노션·슬랙 등)에는 html 이 링크로 붙고, 주소창·메모장에는 글자 그대로 붙는다
async function write(text: string, html?: string) {
  if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // 클립보드 권한이 막힌 브라우저·앱 안 화면: 예전 방식(선택 후 복사)으로 한 번 더
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    if (!ok) throw err;
  }
}

export const copyConversationLink = (id: string) => write(conversationUrl(id));

// 노션 '특이 CS' 기록용: 유형·접수일·상태 + 첫 문의 요약 + 링크.
// 팀 문서에 남으므로 고객 이름은 빼고, 문의 글의 연락처·주소·계좌 등은 슬랙 알림과 같은 기준으로 가린다.
export function copyConversationSummary(c: {
  id: string;
  category: string | null;
  status: string;
  created_at: string;
  firstMessage: string | null;
}) {
  const url = conversationUrl(c.id);
  const d = new Date(c.created_at);
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  const title = `[${c.category ? `${CATEGORY_LABEL[c.category]} 문의` : "문의"}] ${date} 접수 · ${STATUS_LABEL[c.status] ?? c.status}`;
  const body = c.firstMessage ? maskPersonal(c.firstMessage).replace(/\s+/g, " ").trim() : "";
  const quote = body ? `고객 문의: “${body.length > 120 ? `${body.slice(0, 120)}…` : body}”` : "";
  const text = [title, quote, url].filter(Boolean).join("\n");
  const html = `<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>${quote ? `<p>${escapeHtml(quote)}</p>` : ""}`;
  return write(text, html);
}
