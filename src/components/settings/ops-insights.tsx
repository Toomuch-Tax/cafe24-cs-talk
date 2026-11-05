"use client";

import { ChevronDown, GitBranch, Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NativeSelect } from "@/components/inbox/native-select";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

// 설정 → 운영 개선 (관리자 전용): 개선 후보 / 오류 / 사용 현황.
// 후보는 cron(src/lib/improvements.ts)이 만들고 — 운영자가 확인하고 고친 뒤 효과를 본다.
// 사람은 여기서 근거·시도 이력을 보고 병합·배포를 정한 뒤 "배포됨 표시"를 누른다 → 7일 뒤부터 효과를 확인한다.

type View = "candidates" | "errors" | "usage";
type Status = "open" | "in_progress" | "fix_ready" | "needs_decision" | "deployed" | "verified" | "regressed" | "dismissed";
type Attempt = {
  id: string;
  run_id: string;
  started_at: string;
  finished_at: string | null;
  outcome: "fix_ready" | "needs_decision" | "failed" | "skipped" | null;
  hypothesis: string | null;
  change_summary: string | null;
  branch: string | null;
  commit: string | null;
  checks: unknown;
  review: unknown;
  post_deploy: { status: string; note: string; windowDays: number } | null;
  failure_reason: string | null;
};
type Candidate = {
  id: string;
  kind: "error" | "ai_unanswered" | "order_lookup";
  title: string;
  count_7d: number;
  attempts_7d: number | null;
  evidence: Record<string, unknown>;
  status: Status;
  fail_count: number;
  last_failure: string | null;
  branch: string | null;
  deployed_at: string | null;
  fix_release: string | null;
  attempts: Attempt[];
};
type ErrorItem = {
  id: string;
  source: string;
  where: string;
  code: string | null;
  status: number | null;
  message: string;
  stack: string | null;
  count: number;
  count_7d: number;
  first_at: string;
  last_at: string;
  last_release: string | null;
};
type Usage = {
  days: number;
  widget: { opens: number; menus: Record<string, number> };
  ai: { asked: number; answered: number };
  orders: { lookups: number; found: number };
  inquiries: number;
  firstResponse: { medianMin: number | null; p90Min: number | null };
  replies: { tracked: number; aiDraft: number; macro: number; byAgent: { name: string; replies: number }[] };
};

const STATUS: Record<Status, [string, "neutral" | "signal" | "warn" | "late" | "ok"]> = {
  regressed: ["재발", "late"],
  fix_ready: ["수정 준비됨", "signal"],
  needs_decision: ["결정 필요", "warn"],
  in_progress: ["조사 중", "neutral"],
  open: ["대기", "neutral"],
  deployed: ["배포됨 · 효과 확인 중", "signal"],
  verified: ["효과 확인", "ok"],
  dismissed: ["보류", "neutral"],
};
const KIND: Record<Candidate["kind"], string> = { error: "오류", ai_unanswered: "AI 미답변", order_lookup: "주문조회" };
const SOURCE: Record<string, string> = {
  server: "서버",
  external: "외부 연동",
  render: "화면(서버)",
  cron: "자동 작업",
  client_widget: "위젯 브라우저",
  client_console: "콘솔 브라우저",
};
const MENU: Record<string, string> = { order: "주문 조회", ai: "AI 질문", inquiry: "문의 남기기", restock: "재입고", size: "사이즈" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "—");
const minutes = (m: number | null) => (m === null ? "—" : m < 1 ? "1분 미만" : m < 60 ? `${Math.round(m)}분` : m < 2880 ? `${Math.round(m / 6) / 10}시간` : `${Math.round(m / 144) / 10}일`);

export function OpsInsights() {
  const [view, setView] = useState<View>("candidates");
  return (
    <>
      <div role="group" aria-label="보기" className="inline-flex self-start rounded-xl bg-panel-3 p-[3px] shadow-[inset_0_0_0_1px_var(--border)]">
        {(
          [
            ["candidates", "개선 후보"],
            ["errors", "오류"],
            ["usage", "사용 현황"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => setView(id)}
            className={cn(
              "flex h-[30px] items-center rounded-[9px] px-3.5 text-[13px] font-semibold transition-colors",
              view === id ? "bg-card text-foreground edge" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "candidates" ? <CandidatesView /> : view === "errors" ? <ErrorsView /> : <UsageView />}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-3">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        관리자만 볼 수 있어요. 연락처·이메일·긴 숫자는 가려서 저장하고, 행동 기록은 180일 뒤 자동으로 정리돼요.
      </p>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] bg-panel-2 p-5 edge sm:p-6">
      <h2 className="text-base font-bold tracking-[-0.015em]">{title}</h2>
      <p className="mt-1 text-xs text-ink-3">{hint}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-ink-3 edge">{children}</p>
);

function useToggle() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return [open, toggle] as const;
}

// ── 개선 후보 ─────────────────────────────────────────────────────────────

function CandidatesView() {
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, toggle] = useToggle();
  const load = useCallback(
    () =>
      api<{ items: Candidate[] }>("/api/inbox/improvements")
        .then((r) => (setItems(r.items), setFailed(false)))
        .catch(() => setFailed(true)),
    [],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (c: Candidate, action: "dismiss" | "deployed" | "reopen") => {
    let commit: string | undefined;
    if (action === "deployed") {
      const last = c.attempts.find((a) => a.commit)?.commit ?? "";
      const input = prompt("배포한 커밋(앞 7자리 이상, 모르면 비워 두세요)", last.slice(0, 7));
      if (input === null) return;
      commit = input.trim() || undefined;
    }
    try {
      await api(`/api/inbox/improvements/${c.id}`, { method: "POST", body: JSON.stringify({ action, commit }) });
      await load();
    } catch (err) {
      toast.error("상태를 바꾸지 못했어요.", err);
    }
  };

  return (
    <Section
      title="무엇을 고치면 좋을까"
      hint="최근 7일의 반복 오류·AI 가 답하지 못한 질문·실패한 주문조회를 많은 순으로 모았어요. 매일 자동으로 갱신돼요."
    >
      {!items ? (
        <p className="text-sm text-ink-3">{failed ? "후보를 불러오지 못했어요." : "불러오는 중…"}</p>
      ) : items.length === 0 ? (
        <Empty>아직 개선 후보가 없어요. 오류·미답변이 쌓이면 여기에 나타나요.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((c) => {
            const [label, tone] = STATUS[c.status];
            const isOpen = open.has(c.id);
            return (
              <li key={c.id} className="overflow-hidden rounded-2xl bg-card edge">
                <button type="button" onClick={() => toggle(c.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Chip tone={tone}>{label}</Chip>
                      <Chip>{KIND[c.kind]}</Chip>
                    </span>
                    <span className="mt-1.5 block text-sm font-semibold break-words">{c.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-3">
                      최근 7일 <span className="num">{c.count_7d}</span>건
                      {c.attempts_7d ? ` · 시도 ${c.attempts_7d}건 중 ${pct(c.count_7d, c.attempts_7d)}` : ""}
                      {c.fail_count ? ` · 자동 수정 실패 ${c.fail_count}회` : ""}
                    </span>
                  </span>
                  <ChevronDown className={cn("mt-1 size-4 shrink-0 text-ink-3 transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-3 border-t px-4 py-3 text-[13px]">
                    <Evidence c={c} />
                    {c.branch && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <GitBranch className="size-3.5" />
                        <span className="font-mono">{c.branch}</span>
                      </p>
                    )}
                    {c.last_failure && <p className="text-xs text-late-text">마지막 실패: {c.last_failure}</p>}
                    {c.attempts.length > 0 && <Attempts attempts={c.attempts} />}
                    <div className="flex flex-wrap gap-2">
                      {["fix_ready", "needs_decision", "open", "regressed"].includes(c.status) && (
                        <Button size="sm" onClick={() => act(c, "deployed")}>
                          배포됨 표시
                        </Button>
                      )}
                      {!["dismissed", "verified", "in_progress"].includes(c.status) && (
                        <Button size="sm" variant="outline" onClick={() => act(c, "dismiss")}>
                          보류
                        </Button>
                      )}
                      {["dismissed", "needs_decision", "verified", "fix_ready", "deployed"].includes(c.status) && (
                        <Button size="sm" variant="ghost" onClick={() => act(c, "reopen")}>
                          다시 열기
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Evidence({ c }: { c: Candidate }) {
  const e = c.evidence as Record<string, unknown>;
  if (c.kind === "ai_unanswered") {
    const questions = (e.questions as string[] | undefined) ?? [];
    const reasons = (e.reasons as string[] | undefined) ?? [];
    const topics = (e.topics as string[] | undefined) ?? [];
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-muted-foreground">최근 질문 (가린 뒤 일부)</p>
        <ul className="flex flex-col gap-1">
          {questions.map((q, i) => (
            <li key={i} className="rounded-lg bg-panel-3 px-3 py-1.5">
              {q}
            </li>
          ))}
        </ul>
        {reasons.length > 0 && <p className="text-xs text-ink-3">AI 가 남긴 이유: {reasons.slice(0, 2).join(" / ")}</p>}
        {topics.length > 0 && <p className="text-xs text-ink-3">참고한 정책 주제: {topics.join(", ")}</p>}
      </div>
    );
  }
  if (c.kind === "order_lookup")
    return (
      <p className="text-muted-foreground">
        {e.who === "member" ? "회원" : "비회원"} 주문조회 · 결과 <span className="font-mono">{String(e.code)}</span> · 실패율{" "}
        {e.failureRate === null ? "—" : `${e.failureRate}%`}
      </p>
    );
  return (
    <div className="flex flex-col gap-1 text-muted-foreground">
      <p>
        {SOURCE[String(e.source)] ?? String(e.source)} · <span className="font-mono">{String(e.where)}</span>
        {e.status ? ` · ${e.status}` : ""}
      </p>
      <p className="rounded-lg bg-panel-3 px-3 py-1.5 font-mono text-xs break-all text-foreground">{String(e.message)}</p>
      <p className="text-xs text-ink-3">
        누적 {String(e.total)}회 · 처음 {when(String(e.firstAt))} · 마지막 {when(String(e.lastAt))}
        {e.release ? ` · 배포 ${e.release}` : ""}
      </p>
    </div>
  );
}

const OUTCOME: Record<string, string> = { fix_ready: "수정 준비", needs_decision: "결정 필요", failed: "실패", skipped: "건너뜀" };

function Attempts({ attempts }: { attempts: Attempt[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted-foreground">시도 이력</p>
      <ol className="flex flex-col gap-2">
        {attempts.map((a) => (
          <li key={a.id} className="rounded-xl bg-panel-3 px-3 py-2 text-xs leading-relaxed">
            <p className="font-semibold">
              {when(a.started_at)} · {a.outcome ? OUTCOME[a.outcome] : a.run_id === "cron" ? "효과 확인" : "진행 중"}
              {a.commit && <span className="ml-1 font-mono font-normal text-ink-3">{a.commit.slice(0, 7)}</span>}
            </p>
            {a.hypothesis && <p>원인 판단: {a.hypothesis}</p>}
            {a.change_summary && <p>변경: {a.change_summary}</p>}
            {a.review != null && <p className="text-ink-3">검토: {summarize(a.review)}</p>}
            {a.checks != null && <p className="text-ink-3">검증: {summarize(a.checks)}</p>}
            {a.failure_reason && <p className="text-late-text">실패 이유: {a.failure_reason}</p>}
            {a.post_deploy && (
              <p className={cn(a.post_deploy.status === "verified" ? "text-ok-text" : a.post_deploy.status === "regressed" ? "text-late-text" : "text-ink-3")}>
                배포 후({a.post_deploy.windowDays}일): {a.post_deploy.note}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
const summarize = (v: unknown) => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "summary" in v) return String((v as { summary: unknown }).summary);
  return JSON.stringify(v).slice(0, 200);
};

// ── 오류 ─────────────────────────────────────────────────────────────────

function ErrorsView() {
  const [env, setEnv] = useState<"" | "live" | "test" | "dev">("");
  const [state, setState] = useState<"open" | "resolved">("open");
  const [data, setData] = useState<{ env: string; items: ErrorItem[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, toggle] = useToggle();
  const load = useCallback(
    () =>
      api<{ env: string; items: ErrorItem[] }>(`/api/inbox/errors?${new URLSearchParams({ state, ...(env ? { env } : {}) })}`)
        .then((r) => (setData(r), setFailed(false)))
        .catch(() => setFailed(true)),
    [env, state],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (id: string, action: "resolve" | "reopen") => {
    try {
      await api(`/api/inbox/errors/${id}`, { method: "POST", body: JSON.stringify({ action }) });
      await load();
    } catch (err) {
      toast.error(action === "resolve" ? "처리 완료로 바꾸지 못했어요." : "다시 열지 못했어요.", err);
    }
  };

  return (
    <Section title="어디서 무엇이 깨졌나" hint="같은 오류는 한 줄로 모아 횟수만 늘려요. 처음 생긴 운영 오류는 슬랙으로도 알려드려요.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="상태" value={state} onChange={(e) => setState(e.target.value as "open" | "resolved")}>
          <option value="open">처리 안 됨</option>
          <option value="resolved">처리 완료</option>
        </NativeSelect>
        <NativeSelect aria-label="환경" value={env} onChange={(e) => setEnv(e.target.value as typeof env)}>
          <option value="">기본 ({data?.env === "dev" ? "로컬" : "운영"})</option>
          <option value="live">운영</option>
          <option value="test">테스트 위젯</option>
          <option value="dev">로컬</option>
        </NativeSelect>
      </div>
      {!data ? (
        <p className="text-sm text-ink-3">{failed ? "오류 기록을 불러오지 못했어요." : "불러오는 중…"}</p>
      ) : data.items.length === 0 ? (
        <Empty>{state === "open" ? "처리할 오류가 없어요." : "처리 완료한 오류가 없어요."}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((e) => (
            <li key={e.id} className="overflow-hidden rounded-2xl bg-card edge">
              <button type="button" onClick={() => toggle(e.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={e.count_7d > 0 ? "late" : "neutral"}>7일 {e.count_7d}회</Chip>
                    <Chip>{SOURCE[e.source] ?? e.source}</Chip>
                    {e.status && <Chip>{e.status}</Chip>}
                  </span>
                  <span className="mt-1.5 block font-mono text-[12.5px] break-all">{e.where}</span>
                  <span className="mt-0.5 block text-sm break-words">{e.message}</span>
                  <span className="mt-0.5 block text-xs text-ink-3">
                    누적 <span className="num">{e.count}</span>회 · 마지막 {when(e.last_at)}
                    {e.last_release ? ` · 배포 ${e.last_release}` : ""}
                  </span>
                </span>
                <ChevronDown className={cn("mt-1 size-4 shrink-0 text-ink-3 transition-transform", open.has(e.id) && "rotate-180")} />
              </button>
              {open.has(e.id) && (
                <div className="flex flex-col gap-3 border-t px-4 py-3">
                  <p className="text-xs text-ink-3">처음 {when(e.first_at)}</p>
                  {e.stack && (
                    <pre className="max-h-64 overflow-auto rounded-lg bg-panel-3 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                      {e.stack}
                    </pre>
                  )}
                  <div>
                    <Button size="sm" variant="outline" onClick={() => act(e.id, state === "open" ? "resolve" : "reopen")}>
                      {state === "open" ? "처리 완료" : "다시 열기"}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── 사용 현황 ─────────────────────────────────────────────────────────────

function UsageView() {
  const [days, setDays] = useState<7 | 30>(7);
  const [env, setEnv] = useState<"" | "live" | "test">("");
  const [u, setU] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    api<Usage>(`/api/inbox/insights?${new URLSearchParams({ days: String(days), ...(env ? { env } : {}) })}`)
      .then((r) => !stop && (setU(r), setFailed(false)))
      .catch(() => !stop && setFailed(true));
    return () => {
      stop = true;
    };
  }, [days, env]);

  return (
    <Section title="얼마나 쓰이고 있나" hint="이름 그대로의 숫자예요. 'AI 답변 제공률'은 답을 냈는지이고, 고객 문제가 해결됐는지는 아니에요.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="기간" value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30)}>
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
        </NativeSelect>
        <NativeSelect aria-label="위젯 환경" value={env} onChange={(e) => setEnv(e.target.value as typeof env)}>
          <option value="">위젯: 기본</option>
          <option value="live">위젯: 운영</option>
          <option value="test">위젯: 테스트</option>
        </NativeSelect>
      </div>
      {!u ? (
        <p className="text-sm text-ink-3">{failed ? "사용 현황을 불러오지 못했어요." : "불러오는 중…"}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="위젯 열기" value={`${u.widget.opens}회`} />
            <Stat label="AI 답변 제공률" value={pct(u.ai.answered, u.ai.asked)} sub={`질문 ${u.ai.asked}건 중 ${u.ai.answered}건`} />
            <Stat label="주문조회 성공률" value={pct(u.orders.found, u.orders.lookups)} sub={`조회 ${u.orders.lookups}건`} />
            <Stat label="문의 접수" value={`${u.inquiries}건`} />
            <Stat
              label="첫 응답시간 중앙값"
              value={minutes(u.firstResponse.medianMin)}
              sub={`전체 경과 기준 · 영업시간 미반영${u.firstResponse.p90Min !== null ? ` · 90% ${minutes(u.firstResponse.p90Min)}` : ""}`}
            />
            <Stat
              label="AI 초안·빠른 답변 사용"
              value={pct(u.replies.aiDraft, u.replies.tracked)}
              sub={`답변 ${u.replies.tracked}건 · 빠른 답변 ${pct(u.replies.macro, u.replies.tracked)}`}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniTable title="홈 메뉴 클릭" rows={Object.entries(MENU).map(([k, label]) => [label, u.widget.menus[k] ?? 0])} />
            <MiniTable title="상담원별 답변" rows={u.replies.byAgent.map((a) => [a.name, a.replies])} empty="이 기간에 답변이 없어요." />
          </div>
        </div>
      )}
    </Section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3 edge">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num mt-1 text-xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{sub}</p>}
    </div>
  );
}

function MiniTable({ title, rows, empty }: { title: string; rows: [string, number][]; empty?: string }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3 edge">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between py-1.5 text-sm">
              <span>{k}</span>
              <span className="num font-semibold">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
