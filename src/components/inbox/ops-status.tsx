"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { HealthReport } from "@/lib/ops";
import { cn } from "@/lib/utils";
import { Card } from "./app-shell";

type Level = "ok" | "warn" | "bad" | "off";
const DOT: Record<Level, string> = {
  ok: "bg-ok shadow-[0_0_8px_var(--cs-ok)]",
  warn: "bg-warn",
  bad: "bg-late shadow-[0_0_8px_var(--cs-late)]",
  off: "bg-ink-3",
};

const CAFE24_TEXT: Record<HealthReport["cafe24"]["state"], [Level, string]> = {
  ok: ["ok", "연결됨"],
  expiring: ["warn", "곧 만료 — 다시 연결 필요"],
  expired: ["bad", "만료됨 — 다시 연결 필요"],
  not_connected: ["bad", "연결 안 됨"],
  not_configured: ["off", "설정 안 됨"],
  error: ["bad", "상태 확인 실패"],
};

const ago = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? "방금" : min < 60 ? `${min}분 전` : `${Math.floor(min / 60)}시간 전`;
};

export function OpsStatus() {
  const [h, setH] = useState<HealthReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<HealthReport>("/api/inbox/ops")
        .then((r) => !stopped && (setH(r), setFailed(false)))
        .catch(() => !stopped && setFailed(true));
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  if (!h)
    return (
      <Card title="운영 상태">
        <p className="text-sm text-ink-3">{failed ? "상태를 불러오지 못했어요 — 서버나 DB 문제일 수 있어요." : "확인 중…"}</p>
      </Card>
    );

  const rows: [Level, string, string][] = [
    ["ok", "DB", `응답 ${h.db.ms}ms`],
    [
      h.cron.stale ? "bad" : "ok",
      "자동 작업 (10분마다)",
      h.cron.lastRunAt ? `마지막 실행 ${ago(h.cron.lastRunAt)}${h.cron.stale ? " — 멈춤" : ""}` : "실행 기록 없음",
    ],
    [CAFE24_TEXT[h.cafe24.state][0], "Cafe24", CAFE24_TEXT[h.cafe24.state][1]],
    [
      h.integrations.slack ? "ok" : "warn",
      "슬랙 알림",
      h.integrations.slack ? "켜짐" : "꺼짐 — 새 문의·지연 알림을 받을 수 없어요",
    ],
    [h.integrations.email ? "ok" : "off", "답변 이메일", h.integrations.email ? "켜짐" : "꺼짐 (보류)"],
    [
      h.jobs.dead > 0 ? "bad" : h.jobs.pending > 10 ? "warn" : "ok",
      "알림·메일 대기열",
      `대기 ${h.jobs.pending}건 · 최종 실패 ${h.jobs.dead}건 (7일)`,
    ],
  ];

  return (
    <Card title="운영 상태" hint="1분마다 갱신돼요. 문제가 생기면 슬랙으로도 알려드려요.">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Stat label="답변 필요" value={`${h.inbox.open}건`} />
        <Stat
          label="가장 오래 기다린 문의"
          value={h.inbox.oldestWaitHours === null ? "—" : `${Math.floor(h.inbox.oldestWaitHours)}시간`}
          tone={h.inbox.oldestWaitHours !== null && h.inbox.oldestWaitHours >= 24 ? "late" : undefined}
        />
      </div>
      <ul className="flex flex-col divide-y overflow-hidden rounded-2xl bg-panel-3 edge">
        {rows.map(([level, label, text]) => (
          <li key={label} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className={cn("size-2 shrink-0 rounded-full", DOT[level])} />
            <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
            <span className={cn("min-w-0", level === "bad" && "text-late-text", level === "warn" && "text-warn-text")}>
              {text}
            </span>
          </li>
        ))}
      </ul>
      {h.aiCostUsdThisMonth > 0 && (
        <p className="mt-3 text-xs text-ink-3">
          이번 달 AI 비용 <span className="num">${h.aiCostUsdThisMonth.toFixed(h.aiCostUsdThisMonth < 1 ? 3 : 2)}</span>
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "late" }) {
  return (
    <div className="rounded-2xl bg-panel-3 px-4 py-3 edge">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("num mt-1 text-xl font-bold", tone === "late" && "text-late-text")}>{value}</p>
    </div>
  );
}
