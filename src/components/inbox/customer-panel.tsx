"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { toast } from "@/components/ui/toast";
import { api, formatTime } from "@/lib/client/api";
import { Panel, Section } from "./app-shell";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "./labels";
import { OrderPanel, type ItemPicker, type Order } from "./order-panel";

export type ConversationDetail = {
  // 위젯 "AI에게 물어보기"에서 이어진 문의면 그 문답 (인박스 AI 응대)
  aiOrigin?: { id: string; question: string; decision: string; reason: string | null; review: string | null; joined?: boolean; created_at: string } | null;
  conversation: {
    id: string;
    status: "open" | "waiting_customer" | "resolved";
    assigned_agent_id: string | null;
    assigned_agent_name: string | null;
    priority: "normal" | "high" | "urgent";
    category: string | null;
    page_url: string | null;
    order_ref: string | null;
    created_at: string;
    contact_id: string;
    // 고객이 위젯 '내 문의'·메일 링크로 답변을 마지막으로 본 시각
    customer_last_read_at: string | null;
  };
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    cafe24_member_id_hint: string | null;
    verified_member_id: string | null;
    last_page_url: string | null;
    last_seen_at: string | null;
    created_at: string;
  };
  history: {
    id: string;
    status: string;
    category: string | null;
    created_at: string;
    last_message_preview: string | null;
  }[];
  events: {
    type: string;
    data: { from?: unknown; to?: unknown };
    created_at: string;
    agent_name: string | null;
  }[];
};

function describeEvent(e: ConversationDetail["events"][number], agentName: (id: unknown) => string) {
  switch (e.type) {
    case "created":
      return "상담 시작";
    case "assigned":
      return `담당자 → ${e.data.to ? agentName(e.data.to) : "미배정"}`;
    case "status":
      return `상태 → ${STATUS_LABEL[String(e.data.to)] ?? e.data.to}`;
    case "priority":
      return `우선순위 → ${PRIORITY_LABEL[String(e.data.to)] ?? e.data.to}`;
    case "category":
      return `유형 → ${e.data.to ? CATEGORY_LABEL[String(e.data.to)] : "없음"}`;
    case "order_lookup":
      return "주문 조회";
    case "email_sent":
      return "답변 이메일 발송";
    case "email_skipped":
      return "답변 이메일 미발송 (이메일 없음)";
    case "email_failed":
      return "답변 이메일 발송 실패 (자동 재시도)";
    case "auto_closed":
      return "추가 문의가 없어 자동 종료";
    case "reopened_by_customer":
      return "고객이 다시 문의";
    case "closed_by_customer":
      return "고객이 상담 종료";
    default:
      return e.type;
  }
}

export function CustomerPanel({
  detail,
  onSaved,
  emailReplies,
  picker,
  onOrders,
  onOpen,
}: {
  detail: ConversationDetail;
  onSaved: () => void;
  emailReplies: boolean;
  picker?: ItemPicker;
  onOrders?: (orders: Order[]) => void;
  // 이전 문의 열기 (⌘/Ctrl·가운데 클릭은 브라우저 기본대로 새 탭)
  onOpen?: (id: string) => void;
}) {
  const { contact, conversation, history, events } = detail;
  const [name, setName] = useState(contact.name ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [agents, setAgents] = useState<Record<string, string>>({});

  useEffect(() => {
    api<{ agents: { id: string; name: string }[] }>("/api/inbox/agents")
      .then((r) => setAgents(Object.fromEntries(r.agents.map((a) => [a.id, a.name]))))
      .catch(() => {});
  }, []);

  const dirty = name !== (contact.name ?? "") || phone !== (contact.phone ?? "") || email !== (contact.email ?? "");
  // 고객 브라우저가 보낸 값이므로 http(s) 링크만 렌더링한다 (javascript: 등 차단)
  const rawUrl = conversation.page_url ?? contact.last_page_url;
  const pageUrl = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null;

  const displayName = contact.name ?? `고객 ${contact.id.slice(0, 6)}`;

  // 1600px 이상 모니터에서는 대화 칼럼이 남긴 폭을 고객·주문 정보에 쓴다 (주문 카드는 배송 진행 단계까지 펼침)
  return (
    <Panel data-tour="customer" className="hidden w-[300px] shrink-0 overflow-y-auto xl:flex min-[1600px]:w-[440px]">
      <Section>
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-signal-soft text-sm font-bold text-signal-text">
            {displayName.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-[-0.015em]">{displayName}</p>
            <p className="text-xs text-ink-3">
              첫 방문 <span className="num">{formatTime(contact.created_at)}</span> · 이전 문의 {history.length}건
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-ink-3">회원</dt>
          <dd className="min-w-0">
            {contact.verified_member_id ? (
              <Chip tone="signal">
                <ShieldCheck className="size-3" strokeWidth={2} />
                Cafe24 확인됨
              </Chip>
            ) : contact.cafe24_member_id_hint ? (
              <span className="text-muted-foreground">미인증 추정</span>
            ) : (
              <span className="text-muted-foreground">비회원 또는 확인 불가</span>
            )}
          </dd>
          {(contact.verified_member_id ?? contact.cafe24_member_id_hint) && (
            <>
              <dt className="text-ink-3">ID</dt>
              <dd className="truncate font-mono text-[12.5px]">
                {contact.verified_member_id ?? contact.cafe24_member_id_hint}
              </dd>
            </>
          )}
          {conversation.order_ref && (
            <>
              <dt className="text-ink-3">주문</dt>
              <dd className="truncate font-mono text-[12.5px]">{conversation.order_ref}</dd>
            </>
          )}
          {pageUrl && (
            <>
              <dt className="text-ink-3">페이지</dt>
              <dd className="truncate">
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex max-w-full items-center gap-1 text-signal-text hover:underline"
                >
                  <span className="truncate">{pageUrl.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              </dd>
            </>
          )}
        </dl>
      </Section>

      <Section title="연락처 · 상담원 메모용">
        <div className="flex flex-col gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" aria-label="고객 이름" />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="휴대폰"
            inputMode="tel"
            aria-label="휴대폰"
          />
          {emailReplies && (
            <>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="답변 받을 이메일"
                inputMode="email"
                aria-label="답변 받을 이메일"
              />
              {!contact.email && (
                <Notice tone="warning" size="sm">
                  이메일이 없어 답변을 메일로 보낼 수 없어요.
                </Notice>
              )}
            </>
          )}
          {contact.verified_member_id && (contact.name || contact.phone) && !dirty && (
            <p className="text-[11.5px] text-ink-3">회원은 쇼핑몰 회원 정보로 자동으로 채워져요. 고쳐서 저장할 수 있어요.</p>
          )}
          {dirty && (
            <Button
              size="sm"
              className="self-start rounded-lg"
              onClick={async () => {
                try {
                  await api(`/api/inbox/contacts/${contact.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ name, phone, email }),
                  });
                  toast.success("고객 정보를 저장했어요.");
                  onSaved();
                } catch (err) {
                  toast.error("고객 정보를 저장하지 못했어요.", err);
                }
              }}
            >
              저장
            </Button>
          )}
        </div>
      </Section>

      <OrderPanel
        key={conversation.id}
        contactId={contact.id}
        conversationId={conversation.id}
        verifiedMemberId={contact.verified_member_id}
        orderRef={conversation.order_ref}
        phone={contact.phone}
        onContactFilled={onSaved}
        picker={picker}
        onOrders={onOrders}
      />

      <Section title={`이전 문의 ${history.length}`}>
        {history.length === 0 ? (
          <p className="text-xs text-ink-3">이전 문의가 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {history.map((h) => (
              <li key={h.id} className="text-[13px]">
                <a
                  href={`/inbox?c=${h.id}`}
                  onClick={(e) => {
                    if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    onOpen(h.id);
                  }}
                  className="-mx-2 block rounded-lg px-2 py-1 transition-colors hover:bg-panel-3"
                >
                  <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
                    {h.category && <Chip className="h-[18px]">{CATEGORY_LABEL[h.category]}</Chip>}
                    <span className="num">{formatTime(h.created_at)}</span>
                    <span>· {STATUS_LABEL[h.status]}</span>
                  </div>
                  <p className="truncate text-muted-foreground">{h.last_message_preview}</p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="처리 이력" last>
        <ol className="relative flex flex-col gap-2.5 border-l border-border pl-3.5">
          {events.map((e, i) => (
            <li key={i} className="relative text-xs">
              <span className="absolute top-1.5 -left-[17px] size-[5px] rounded-full bg-ink-3" />
              <span className="num mr-2 text-ink-3">{formatTime(e.created_at)}</span>
              <span className="text-muted-foreground">
                {describeEvent(e, (id) => agents[String(id)] ?? "상담원")}
                {e.agent_name && <span className="text-ink-3"> · {e.agent_name}</span>}
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </Panel>
  );
}
