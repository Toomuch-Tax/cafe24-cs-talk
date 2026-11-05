"use client";

import { Check, Clock, MailWarning, MessageSquare, ShieldCheck, Sparkles, StickyNote, Zap } from "lucide-react";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import type { ChatMessage } from "@/lib/client/api";
import { Panel, Section } from "./app-shell";
import { CATEGORY_LABEL, PRIORITY_LABEL } from "./labels";
import { NativeSelect } from "./native-select";

// 둘러보기 4~6단계용 예시 문의. 열린 문의가 없을 때 가운데에 그린다.
// 화면에만 있는 가짜 데이터라 서버를 부르지 않고, DB·알림에도 남지 않는다 (가이드가 뒤 화면 클릭을 막는다).

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const MESSAGES: ChatMessage[] = [
  {
    id: "tour-1",
    seq: 1,
    sender_type: "customer",
    agent_name: null,
    body: "안녕하세요! 지난주에 주문한 셔츠가 아직 배송 준비 중으로 나오는데 언제쯤 받을 수 있을까요?",
    client_message_id: null,
    created_at: ago(3),
  },
];

export function TourDemo() {
  return (
    <div aria-hidden className="pointer-events-none flex min-h-0 min-w-0 flex-1 gap-2 select-none">
      <Panel className="flex-1">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 pt-5 pb-4" data-tour="conv-head">
          <div className="mr-auto flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <h2 className="truncate text-[22px] leading-tight font-bold tracking-[-0.025em]">예시 고객</h2>
              <Chip>
                <Clock className="size-3" strokeWidth={2} />
                <span className="num">3시간 · 21시간 남음</span>
              </Chip>
            </div>
            <p className="flex min-w-0 items-center gap-2 text-[11.5px] text-ink-3">
              답변 필요 · 배송 <Chip tone="signal">가이드용 예시 문의</Chip>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <NativeSelect aria-label="담당자" defaultValue="" tabIndex={-1}>
              <option value="">미배정</option>
            </NativeSelect>
            <NativeSelect aria-label="처리 유형" defaultValue="shipping" tabIndex={-1}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="우선순위" defaultValue="normal" tabIndex={-1}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  우선순위 {v}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" className="h-8 rounded-xl" tabIndex={-1}>
              <MailWarning />
              안 읽음으로 표시
            </Button>
            <Button variant="outline" className="h-8 rounded-xl" tabIndex={-1}>
              <Check />
              종료
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden pt-2 pb-4">
          <div className="mx-auto w-full max-w-[760px]">
            {MESSAGES.map((m) => (
              <MessageBubble key={m.id} message={m} viewer="agent" />
            ))}
          </div>
        </div>

        <div className="mx-auto mb-4 w-[calc(100%-2rem)] max-w-[728px]">
          <div data-tour="composer" className="overflow-hidden rounded-[20px] bg-raised backdrop-blur-xl float">
            <div className="flex items-center gap-0.5 px-2 pt-2 text-xs font-semibold">
              <span className="flex items-center gap-1.5 rounded-lg bg-panel-3 px-2.5 py-1.5 text-foreground">
                <MessageSquare className="size-3.5" />
                답변
              </span>
              <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-ink-3">
                <StickyNote className="size-3.5" />
                내부 메모
              </span>
              <span className="ml-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-signal-text">
                <Sparkles className="size-3.5" />
                AI 초안
              </span>
            </div>
            <p className="min-h-20 px-4 py-3 text-[14px] leading-relaxed text-muted-foreground/70">고객에게 보낼 답변</p>
            <div className="flex items-center gap-2 border-t px-3 py-2">
              <span className="truncate text-xs text-ink-3">고객 위젯 ‘내 문의’에 표시돼요</span>
              <span className="ml-auto grid size-9 place-items-center rounded-xl text-ink-3">
                <Zap className="size-4" />
              </span>
              <Button className="h-8 rounded-xl px-4" disabled tabIndex={-1}>
                보내기
              </Button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel data-tour="customer" className="w-[300px] shrink-0 min-[1600px]:w-[440px]">
        <Section>
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-signal-soft text-sm font-bold text-signal-text">
              예
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-[-0.015em]">예시 고객</p>
              <p className="text-xs text-ink-3">이전 문의 1건</p>
            </div>
          </div>
          <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-ink-3">회원</dt>
            <dd>
              <Chip tone="signal">
                <ShieldCheck className="size-3" strokeWidth={2} />
                Cafe24 확인됨
              </Chip>
            </dd>
          </dl>
        </Section>
        <Section title="주문 · 최근 3개월" last>
          <ul className="flex flex-col gap-2">
            <DemoOrder status="배송준비중" name="오버핏 옥스포드 셔츠" option="블랙 / M" />
            <DemoOrder status="배송완료" name="와이드 데님 팬츠" option="인디고 / 30" />
          </ul>
        </Section>
      </Panel>
    </div>
  );
}

function DemoOrder({ status, name, option }: { status: string; name: string; option: string }) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-raised p-3 edge">
      <span className="font-mono text-xs text-muted-foreground">예시 주문</span>
      <p className="truncate text-[13px]">{name}</p>
      <div className="flex items-center gap-1.5">
        <Chip tone={status === "배송완료" ? "ok" : "neutral"}>{status}</Chip>
        <span className="truncate text-xs text-ink-3">{option}</span>
      </div>
    </li>
  );
}
