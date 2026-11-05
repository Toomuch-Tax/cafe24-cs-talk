import { BRAND_NAME, BRAND_NAME_EN, SHOP_HOST, SHOP_URL } from "./brand";

// 이메일 발송 (Resend REST API). Vercel Marketplace 연동이 RESEND_API_KEY 를 넣어준다.
export class EmailNotConfigured extends Error {}

// fromName: 보내는 사람 이름. 주소는 EMAIL_FROM 에서 꺼내고 이름만 바꾼다 (설정의 고객 노출 이름과 맞추기)
export async function sendEmail(input: { to: string; subject: string; html: string; text: string; fromName?: string }) {
  const key = process.env.RESEND_API_KEY;
  const configured = process.env.EMAIL_FROM;
  if (!key || !configured) throw new EmailNotConfigured("RESEND_API_KEY / EMAIL_FROM is not set");
  const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
  const from = input.fromName ? `${input.fromName.replace(/["<>]/g, "")} <${address}>` : configured;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 발신 도메인 인증 전(403)에는 설정 미완료로 보고 재시도 횟수를 쓰지 않게 한다
    if (res.status === 403 && /not verified|verify your domain|domain is not/i.test(body)) {
      throw new EmailNotConfigured(`resend domain not verified: ${body.slice(0, 120)}`);
    }
    throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as { id: string };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// 답변 알림 메일 (위젯과 같은 대화형).
// 메일 앱 호환: table + inline style, 웹폰트·SVG 없음. 본문은 이스케이프해서 넣는다 (상담원 답변이라도 HTML 로 해석하지 않음)
// sender: 설정의 '고객 노출 정보' 이름 (상담원 실명이 아니라 위젯과 같은 이름으로 보낸다)
const CATEGORY_LABEL: Record<string, string> = {
  shipping: "배송",
  exchange: "교환",
  return: "반품",
  size: "사이즈",
  defect: "불량",
  restock: "재입고",
};
const KO = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif";
const LAT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const kstDate = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(d);
const kstTime = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const lines = (t: string) => esc(t).replace(/\n/g, "<br>");

export function replyEmail(opts: {
  replies: string[];
  link: string;
  question: string | null;
  sender: string;
  category: string | null;
  repliedAt: Date;
  origin: string;
  avatarUrl: string | null;
}) {
  const label = opts.category ? CATEGORY_LABEL[opts.category] : undefined;
  const subject = `[${BRAND_NAME}] ${label ? `${label} 문의에` : "문의하신 내용에"} 답변드렸어요`;
  // 메일함 목록에 보이는 미리보기: 답변 첫 문장
  const preheader = (opts.replies[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  const avatar = opts.avatarUrl ? new URL(opts.avatarUrl, opts.origin).toString() : null;
  const day = `${kstDate(opts.repliedAt)}${label ? ` · ${label} 문의` : ""}`;
  const footer = `<a href="${SHOP_URL}/" class="lnk" style="color:#000;text-decoration:none">SHOP</a>&nbsp;&nbsp;&nbsp;&nbsp;<a href="${SHOP_URL}/myshop/index.html" class="lnk" style="color:#000;text-decoration:none">MY PAGE</a>&nbsp;&nbsp;&nbsp;&nbsp;<a href="${SHOP_URL}/" class="lnk" style="color:#000;text-decoration:none">${esc(SHOP_HOST.toUpperCase())}</a>`;

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>
/* 다크 모드를 지원하는 메일 앱(Apple Mail 등)용. Gmail 앱은 색을 스스로 뒤집으므로 밝은 쪽 색을 뒤집혀도 무난한 회색 계열로 둔다 */
@media (prefers-color-scheme: dark){
  .bg{background:#111111!important}
  .ink{color:#f2f2f2!important}
  .mute{color:#9a9a9a!important}
  .q{background:#2a2a2a!important;color:#f2f2f2!important}
  .a{background:#1c1c1c!important;border-color:#333333!important;color:#f2f2f2!important}
  .btn{background:#f2f2f2!important}.btn a{color:#000000!important}
  .lnk{color:#f2f2f2!important}
}
</style></head>
<body class="bg" style="margin:0;padding:0;background:#f9f9f9;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:#f9f9f9"><tr><td align="center" style="padding:0 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ink" style="max-width:560px;font-family:${KO};color:#000">
  <tr><td style="padding:32px 4px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left"><a href="${SHOP_URL}/" class="ink" style="font-family:${LAT};font-size:18px;font-weight:800;letter-spacing:-0.3px;color:#000;text-decoration:none">${esc(BRAND_NAME_EN)}</a></td>
      <td align="right" class="mute" style="font-family:${LAT};font-size:10px;font-weight:700;letter-spacing:2px;color:#8a8a8a">1:1 INQUIRY</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px 4px 4px;font-size:22px;font-weight:800;letter-spacing:-0.5px;line-height:1.4">답변이 도착했어요</td></tr>
  <tr><td align="center" class="mute" style="padding:14px 0 18px;font-size:12px;color:#8a8a8a">${esc(day)}</td></tr>
  ${
    opts.question
      ? `<tr><td align="right" style="padding:0 0 18px 48px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr><td class="q" style="background:#ececec;color:#000;font-size:14px;line-height:1.65;padding:12px 15px;border-radius:18px 4px 18px 18px;text-align:left">${lines(opts.question)}</td></tr></table>
  </td></tr>`
      : ""
  }
  <tr><td style="padding:0 0 8px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      ${avatar ? `<td style="padding-right:8px"><img src="${esc(avatar)}" width="26" height="26" alt="" style="display:block;border:1px solid #e6e6e6;border-radius:13px;background:#fff"></td>` : ""}
      <td class="ink" style="font-size:12.5px;font-weight:600;color:#3a3a3a">${esc(opts.sender)} <span style="font-weight:400;color:#8a8a8a;font-size:11px">${kstTime(opts.repliedAt)}</span></td>
    </tr></table>
  </td></tr>
  ${opts.replies
    .map(
      (r, i) => `<tr><td style="padding:${i ? "8px" : "0"} 40px 0 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="a" style="background:#fff;border:1px solid #e6e6e6;color:#000;font-size:15px;line-height:1.75;padding:14px 16px;border-radius:${i ? "18px" : "4px 18px 18px 18px"}">${lines(r)}</td></tr></table>
  </td></tr>`,
    )
    .join("")}
  <tr><td style="padding:28px 0 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" class="btn" style="background:#000;border-radius:999px">
      <a href="${esc(opts.link)}" style="display:block;padding:16px 20px;color:#fff;font-size:15px;font-weight:700;text-decoration:none">대화 이어가기</a>
    </td></tr></table>
  </td></tr>
  <tr><td class="mute" style="padding:36px 4px 40px;font-size:11.5px;line-height:1.7;color:#8a8a8a">
    <div style="font-family:${LAT};font-size:10.5px;font-weight:700;letter-spacing:1.5px;padding-bottom:10px">${footer}</div>
    쇼핑몰에서 답변을 확인하지 않으셔서 메일로 알려드려요. 이 메일은 발신 전용이에요. 추가 문의는 위 버튼으로 남겨주세요.<br>링크는 30일 동안 쓸 수 있어요.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = `${subject}\n\n${opts.question ? `문의: ${opts.question}\n\n` : ""}답변:\n${opts.replies.join("\n\n")}\n\n대화 이어가기: ${opts.link}\n(이 메일은 발신 전용이에요. 링크는 30일 동안 쓸 수 있어요)`;
  return { subject, html, text };
}

// 답변 이메일 사용 여부. 발신 도메인 인증까지 끝난 뒤 EMAIL_ENABLED=true 로 켠다 (2026-10-18 보류 결정).
export const emailEnabled = () =>
  process.env.EMAIL_ENABLED === "true" && Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
