"use client";

import { Check, Mail, MailWarning, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { Panel } from "./app-shell";
import type { ConversationSummary } from "./conversation-list";
import { contactDisplayName } from "./labels";
import { NativeSelect } from "./native-select";

type Before = {
  id: string;
  status: ConversationSummary["status"];
  assignedAgentId: string | null;
};
type Changes = {
  status?: ConversationSummary["status"];
  assignedAgentId?: string | null;
};

function bulk(ids: string[], body: { changes?: Changes; read?: boolean }) {
  return api<{ before: Before[] }>("/api/inbox/conversations/bulk", {
    method: "POST",
    body: JSON.stringify({ ids, ...body }),
  });
}

// 바뀌기 전 값이 같은 문의끼리 묶어 원래대로 돌린다
async function restore(before: Before[], key: "status" | "assignedAgentId") {
  const groups = new Map<string | null, string[]>();
  for (const b of before) groups.set(b[key], [...(groups.get(b[key]) ?? []), b.id]);
  for (const [value, ids] of groups) await bulk(ids, { changes: { [key]: value } });
}

// 목록에서 여러 문의를 골랐을 때 오른쪽 화면: 종료·다시 열기, 담당자 지정, 읽음·안 읽음
export function BulkPanel({
  picked,
  agentId,
  agents,
  onChanged,
  onResolved,
}: {
  picked: ConversationSummary[];
  agentId: string;
  agents: { id: string; name: string }[];
  // 목록 새로 고침
  onChanged: () => void;
  // 상태가 바뀌어 목록에서 빠지는 처리 → 선택을 푼다
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const ids = picked.map((c) => c.id);
  const n = picked.length;
  const allResolved = picked.every((c) => c.status === "resolved");
  const unreadN = picked.filter((c) => c.unread).length;
  const unassignedN = picked.filter((c) => !c.assigned_agent_id).length;

  const run = async (fn: () => Promise<void>, failText: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(failText, err);
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const undo = (before: Before[], key: "status" | "assignedAgentId") => ({
    label: "되돌리기",
    onClick: () =>
      restore(before, key)
        .then(() => toast.success("되돌렸어요."))
        .catch((err) => toast.error("되돌리지 못했어요.", err))
        .finally(onChanged),
  });

  const setStatus = (status: "open" | "resolved") =>
    run(
      async () => {
        const { before } = await bulk(ids, { changes: { status } });
        onResolved();
        toast.success(`${n}건을 ${status === "resolved" ? "종료했어요" : "다시 열었어요"}.`, {
          action: undo(before, "status"),
        });
      },
      status === "resolved" ? "종료하지 못했어요." : "다시 열지 못했어요.",
    );

  const assign = (value: string) =>
    run(async () => {
      const assignedAgentId = value || null;
      const { before } = await bulk(ids, { changes: { assignedAgentId } });
      const name = agents.find((a) => a.id === assignedAgentId)?.name;
      toast.success(name ? `${n}건을 ${name} 님에게 배정했어요.` : `${n}건의 담당을 해제했어요.`, {
        action: undo(before, "assignedAgentId"),
      });
    }, "담당자를 바꾸지 못했어요.");

  const setRead = (read: boolean) =>
    run(
      async () => {
        await bulk(ids, { read });
        toast.success(`${n}건을 ${read ? "읽음" : "안 읽음"}으로 표시했어요. 내 목록에만 적용돼요.`);
      },
      read ? "읽음으로 표시하지 못했어요." : "안 읽음으로 표시하지 못했어요.",
    );

  // 마지막에 고른 3개를 카드로 겹쳐 보여준다
  const stack = picked.slice(-3).reverse();

  return (
    <Panel className="flex-1 items-center justify-center gap-6 p-6 text-center motion-safe:animate-in motion-safe:fade-in-0">
      <div className="relative h-[118px] w-[300px]" aria-hidden>
        {stack.map((c, i) => (
          <div
            key={c.id}
            className="absolute inset-x-0 bottom-0 flex h-[86px] origin-top flex-col gap-1.5 rounded-2xl bg-raised px-4 py-3.5 text-left edge transition-transform duration-200 motion-reduce:transition-none"
            style={{
              zIndex: 3 - i,
              transform: `translateY(${-13.5 * i}px) scale(${1 - 0.05 * i})`,
              opacity: 1 - 0.18 * i,
            }}
          >
            <span className="truncate text-[13.5px] font-semibold">{contactDisplayName(c)}</span>
            <span className="truncate text-[12.5px] text-muted-foreground">{c.last_message_preview ?? ""}</span>
          </div>
        ))}
      </div>
      <div>
        <h2 className="text-[22px] font-bold tracking-[-0.025em]">
          <span className="num">{n}</span>개 문의 선택됨
        </h2>
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          안 읽음 {unreadN} · 미배정 {unassignedN}
        </p>
      </div>
      <div className="flex max-w-[520px] flex-wrap items-center justify-center gap-2">
        {allResolved ? (
          <Button className="h-8 rounded-xl" disabled={busy} onClick={() => setStatus("open")}>
            <RotateCcw />
            다시 열기
          </Button>
        ) : (
          <Button className="h-8 rounded-xl" disabled={busy} onClick={() => setStatus("resolved")}>
            <Check />
            종료
          </Button>
        )}
        <NativeSelect
          aria-label="담당자 지정"
          value="-"
          disabled={busy}
          onChange={(e) => e.target.value !== "-" && assign(e.target.value)}
          className="bg-raised"
        >
          <option value="-" disabled>
            담당자 지정
          </option>
          <option value={agentId}>나에게</option>
          {agents
            .filter((a) => a.id !== agentId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          <option value="">담당 해제 (미배정)</option>
        </NativeSelect>
        <Button variant="outline" className="h-8 rounded-xl" disabled={busy} onClick={() => setRead(true)}>
          <Mail />
          읽음으로 표시
        </Button>
        <Button variant="outline" className="h-8 rounded-xl" disabled={busy} onClick={() => setRead(false)}>
          <MailWarning />안 읽음으로 표시
        </Button>
      </div>
      <p className="flex flex-wrap justify-center gap-4 text-[12px] text-ink-3">
        <span>
          <Kbd>⌘</Kbd> 클릭 하나씩
        </span>
        <span>
          <Kbd>⇧</Kbd> 클릭 범위
        </span>
        <span>
          <Kbd>⌘</Kbd>
          <Kbd>A</Kbd> 전체
        </span>
        <span>
          <Kbd>Esc</Kbd> 해제
        </span>
      </p>
    </Panel>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="num mx-px rounded-md bg-panel-3 px-1.5 py-px text-[11px] font-semibold text-muted-foreground edge">
      {children}
    </kbd>
  );
}
