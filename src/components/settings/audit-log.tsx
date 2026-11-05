"use client";

import {
  ChevronDown,
  CircleX,
  KeyRound,
  Lock,
  Plug,
  Settings2,
  Sparkles,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NativeSelect } from "@/components/inbox/native-select";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

// 설정 → 변경 이력 (관리자 전용).
// 주소 ?view=logins&user=<id> 로 로그인 기록을 바로 열 수 있다 (사용자 탭·슬랙 경고 링크).

type Area = "widget" | "users" | "security" | "settings" | "ai";
type Change = { label: string; before?: string | null; after: string };
type AuditItem = { id: string; actor_name: string | null; area: Area; action: string; title: string; changes: Change[]; created_at: string };
type ChangesRes = { items: AuditItem[]; more: boolean; counts: Partial<Record<Area, number>> };
type LoginItem = {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  email: string | null;
  method: "google" | "password";
  ok: boolean;
  reasonLabel: string | null;
  ip: string | null;
  device: string;
  created_at: string;
};
type LoginsRes = {
  items: LoginItem[];
  more: boolean;
  stats: { total: number; failed: number; domain: number };
  alert: { count: number; from: string; to: string; email: string | null; ip: string | null; password: boolean } | null;
  recentFail: boolean;
  passwordLogin: boolean;
  slack: boolean;
};

const AREAS: { id: Area; label: string; icon: LucideIcon }[] = [
  { id: "widget", label: "위젯 설치", icon: Plug },
  { id: "users", label: "사용자", icon: Users },
  { id: "security", label: "로그인 · 보안", icon: KeyRound },
  { id: "settings", label: "설정", icon: Settings2 },
  { id: "ai", label: "AI", icon: Sparkles },
];
const AREA_ICON = Object.fromEntries(AREAS.map((a) => [a.id, a.icon])) as Record<Area, LucideIcon>;
const PERIODS = [7, 30, 90, 365];

// 색은 움직여야 하는 신호에만: 제거·정지·삭제는 빨강, 보안은 주황, 설치·연결은 파랑
function toneOf(it: AuditItem) {
  if (it.action === "widget.remove" || it.action === "users.delete" || /정지|끔$/.test(it.title)) return "late";
  if (it.area === "security") return "warn";
  if (it.area === "widget") return "signal";
  return "neutral";
}
const ICON_TONE = {
  neutral: "bg-panel-3 text-muted-foreground",
  signal: "bg-signal-soft text-signal-text",
  warn: "bg-warn/15 text-warn-text",
  late: "bg-late/12 text-late-text",
  ok: "bg-ok/15 text-ok-text",
} as const;

const time = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const md = d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  const diff = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  return diff === 0 ? `오늘 · ${md}` : diff === 1 ? `어제 · ${md}` : md;
}
function shortWhen(iso: string) {
  const day = dayLabel(iso);
  return `${day.startsWith("오늘") ? "오늘" : day.startsWith("어제") ? "어제" : day} ${time(iso)}`;
}
function groupByDay<T extends { created_at: string }>(items: T[]) {
  const groups: { day: string; items: T[] }[] = [];
  for (const it of items) {
    const day = dayLabel(it.created_at);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(it);
  }
  return groups;
}

const readParams = () => {
  const p = new URLSearchParams(location.search);
  return { view: p.get("view") === "logins" ? ("logins" as const) : ("changes" as const), user: p.get("user") };
};

// 설정 화면은 로그인 확인 뒤 브라우저에서만 그려지므로 처음 값을 주소에서 바로 읽어도 된다
export function AuditLog({ onOpenTab }: { onOpenTab: (tab: "access") => void }) {
  const [view, setViewState] = useState(() => readParams().view);
  const [recentFail, setRecentFail] = useState(false);

  useEffect(() => {
    api<LoginsRes>("/api/inbox/audit?view=logins&failed=1")
      .then((r) => setRecentFail(r.recentFail))
      .catch(() => {});
  }, []);

  const setView = (v: "changes" | "logins") => {
    setViewState(v);
    const url = new URL(location.href);
    url.searchParams.set("view", v);
    if (v === "changes") url.searchParams.delete("user");
    history.replaceState(null, "", url);
  };

  return (
    <>
      <div role="group" aria-label="보기" className="inline-flex self-start rounded-xl bg-panel-3 p-[3px] shadow-[inset_0_0_0_1px_var(--border)]">
        {(
          [
            ["changes", "변경 이력"],
            ["logins", "로그인 기록"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => setView(id)}
            className={cn(
              "flex h-[30px] items-center gap-1.5 rounded-[9px] px-3.5 text-[13px] font-semibold transition-colors",
              view === id ? "bg-card text-foreground edge" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {id === "logins" && recentFail && (
              <span className="size-1.5 rounded-full bg-late" aria-label="최근 24시간 로그인 실패 있음" />
            )}
          </button>
        ))}
      </div>

      {view === "changes" ? <ChangesView /> : <LoginsView onOpenTab={onOpenTab} />}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-3">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        관리자만 볼 수 있어요. 기록은 지우거나 고칠 수 없고, 보관 기간이 지나면 자동으로 정리돼요.
      </p>
    </>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors",
        on ? "bg-foreground text-background" : "bg-raised text-muted-foreground edge hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
const Count = ({ n, on }: { n: number; on: boolean }) => (
  <span className={cn("num text-[11.5px] font-medium", on ? "text-background/60" : "text-ink-3")}>{n}</span>
);

function CardShell({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] bg-panel-2 p-5 edge sm:p-6">
      <h2 className="text-base font-bold tracking-[-0.015em]">{title}</h2>
      <p className="mt-1 text-xs text-ink-3">{hint}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ChangesView() {
  const [area, setArea] = useState<Area | null>(null);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ChangesRes | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);

  const query = useCallback(
    (before?: string) =>
      api<ChangesRes>(
        `/api/inbox/audit?${new URLSearchParams({ view: "changes", days: String(days), ...(area ? { area } : {}), ...(before ? { before } : {}) })}`,
      ),
    [area, days],
  );

  useEffect(() => {
    let stop = false;
    query()
      .then((r) => !stop && (setData(r), setFailed(false)))
      .catch(() => !stop && setFailed(true));
    return () => {
      stop = true;
    };
  }, [query]);

  const more = async () => {
    if (!data?.items.length) return;
    setLoadingMore(true);
    try {
      const r = await query(data.items.at(-1)!.created_at);
      setData({ ...r, items: [...data.items, ...r.items] });
    } finally {
      setLoadingMore(false);
    }
  };

  const total = Object.values(data?.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <CardShell title="누가 무엇을 바꿨나" hint="설정·사용자·위젯 설치·AI 정책 변경. 1년 보관. 비밀번호·토큰 값은 남기지 않아요.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip on={!area} onClick={() => setArea(null)}>
            전체 <Count n={total} on={!area} />
          </FilterChip>
          {AREAS.map((a) => (
            <FilterChip key={a.id} on={area === a.id} onClick={() => setArea(a.id)}>
              {a.label} <Count n={data?.counts[a.id] ?? 0} on={area === a.id} />
            </FilterChip>
          ))}
        </div>
        <NativeSelect aria-label="기간" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {PERIODS.map((d) => (
            <option key={d} value={d}>
              {d === 365 ? "최근 1년" : `최근 ${d}일`}
            </option>
          ))}
        </NativeSelect>
      </div>

      {!data ? (
        <p className="text-sm text-ink-3">{failed ? "기록을 불러오지 못했어요." : "불러오는 중…"}</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-ink-3 edge">이 기간에 남은 변경 기록이 없어요.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groupByDay(data.items).map((g) => (
            <div key={g.day}>
              <h3 className="mx-1 mb-2 font-mono text-[11px] font-medium text-ink-3">{g.day}</h3>
              <ul className="flex flex-col divide-y overflow-hidden rounded-2xl bg-card edge">
                {g.items.map((it) => {
                  const Icon = AREA_ICON[it.area];
                  const isOpen = open.has(it.id);
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        disabled={!it.changes.length}
                        onClick={() => toggle(it.id)}
                        className="grid w-full grid-cols-[28px_1fr_auto] items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/40 disabled:cursor-default"
                      >
                        <span className={cn("grid size-7 place-items-center rounded-[9px]", ICON_TONE[toneOf(it)])}>
                          <Icon className="size-[15px]" strokeWidth={2} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-semibold">{it.title}</span>
                          <span className="block truncate text-xs text-ink-3">
                            {AREAS.find((a) => a.id === it.area)?.label}
                          </span>
                        </span>
                        <span className="flex items-center gap-2.5 text-xs whitespace-nowrap text-ink-3">
                          <span className="font-medium text-muted-foreground">{it.actor_name ?? "시스템"}</span>
                          <span className="num">{time(it.created_at)}</span>
                          {it.changes.length > 0 && (
                            <ChevronDown className={cn("size-3.5 transition-transform duration-200", isOpen && "rotate-180")} />
                          )}
                        </span>
                      </button>
                      <div
                        className={cn(
                          "grid transition-[grid-template-rows] duration-[240ms] ease-[var(--ease-out)]",
                          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                        )}
                      >
                        <div className="overflow-hidden">
                          <dl className="mx-3.5 mb-3.5 grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 rounded-xl bg-panel-2 px-3.5 py-3 text-[12.5px] shadow-[inset_0_0_0_1px_var(--border)] sm:ml-[54px]">
                            {it.changes.map((c) => (
                              <div key={c.label} className="contents">
                                <dt className="text-ink-3">{c.label}</dt>
                                <dd className="min-w-0 leading-relaxed break-words">
                                  {c.before != null && (
                                    <>
                                      <span className="text-late-text line-through decoration-late/45">{c.before}</span>
                                      <span className="mx-1.5 text-ink-3">→</span>
                                    </>
                                  )}
                                  <span className="font-semibold text-ok-text">{c.after}</span>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {data.more && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" className="rounded-xl px-4" disabled={loadingMore} onClick={more}>
                {loadingMore ? "불러오는 중…" : "더 보기"}
              </Button>
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
}

function LoginsView({ onOpenTab }: { onOpenTab: (tab: "access") => void }) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [user, setUserState] = useState(() => readParams().user);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<LoginsRes | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api<{ users: { id: string; name: string; status: string }[] }>("/api/inbox/users")
      .then((r) => setUsers(r.users.filter((u) => u.status !== "pending")))
      .catch(() => {});
  }, []);

  const setUser = (id: string | null) => {
    setUserState(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set("user", id);
    else url.searchParams.delete("user");
    history.replaceState(null, "", url);
  };

  const query = useCallback(
    (before?: string) =>
      api<LoginsRes>(
        `/api/inbox/audit?${new URLSearchParams({
          view: "logins",
          ...(failedOnly ? { failed: "1" } : {}),
          ...(user ? { user } : {}),
          ...(before ? { before } : {}),
        })}`,
      ),
    [failedOnly, user],
  );

  useEffect(() => {
    let stop = false;
    query()
      .then((r) => !stop && (setData(r), setFailed(false)))
      .catch(() => !stop && setFailed(true));
    return () => {
      stop = true;
    };
  }, [query]);

  const more = async () => {
    if (!data?.items.length) return;
    setLoadingMore(true);
    try {
      const r = await query(data.items.at(-1)!.created_at);
      setData({ ...r, items: [...data.items, ...r.items] });
    } finally {
      setLoadingMore(false);
    }
  };

  const a = data?.alert;
  return (
    <CardShell title="로그인 기록" hint="성공·실패를 모두 남겨요. 90일 보관. 10분 안에 실패가 5번 이상이면 슬랙으로 알려요.">
      {a && (
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-2xl bg-late/[0.07] px-4 py-3.5 shadow-[inset_0_0_0_1px_oklch(60%_0.2_25/0.16)]">
          <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-late-text" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-bold">
              {shortWhen(a.from)}–{time(a.to)} 로그인 실패 {a.count}회
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {a.email ?? "알 수 없는 계정"}
              {a.ip && ` · IP ${a.ip}`}
              {data.slack ? " · 같은 내용을 슬랙으로 보냈어요." : " · 슬랙이 연결되지 않아 알림은 보내지 않았어요."}
            </p>
          </div>
          {a.password && data.passwordLogin && (
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => onOpenTab("access")}>
              비밀번호 로그인 끄러 가기
            </Button>
          )}
        </div>
      )}

      {data && (
        <div className="mb-4 grid grid-cols-3 gap-2.5">
          {(
            [
              ["7일 로그인", data.stats.total, false],
              ["7일 실패", data.stats.failed, data.stats.failed > 0],
              ["외부 계정 시도", data.stats.domain, false],
            ] as const
          ).map(([label, n, bad]) => (
            <div key={label} className="rounded-[14px] bg-card px-3.5 py-3 edge">
              <p className="truncate text-[11.5px] text-ink-3">{label}</p>
              <p className={cn("num mt-0.5 text-[22px] font-semibold tracking-[-0.02em]", bad && "text-late-text")}>{n}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          <FilterChip on={!failedOnly} onClick={() => setFailedOnly(false)}>
            전체
          </FilterChip>
          <FilterChip on={failedOnly} onClick={() => setFailedOnly(true)}>
            실패만
          </FilterChip>
        </div>
        <NativeSelect aria-label="사용자" value={user ?? ""} onChange={(e) => setUser(e.target.value || null)}>
          <option value="">모든 사용자</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      {!data ? (
        <p className="text-sm text-ink-3">{failed ? "기록을 불러오지 못했어요." : "불러오는 중…"}</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-ink-3 edge">남은 로그인 기록이 없어요.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl bg-card edge">
            <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-panel-2 text-left font-mono text-[11px] text-ink-3">
                  {["시각", "계정", "방식", "결과", "기기 · IP"].map((h) => (
                    <th key={h} className="border-b px-3.5 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((l) => (
                  <tr key={l.id} className={cn("border-t first:border-t-0", !l.ok && "bg-late/[0.035]")}>
                    <td className="num px-3.5 py-2.5 whitespace-nowrap">{shortWhen(l.created_at)}</td>
                    <td className="px-3.5 py-2.5">
                      {l.agent_name ?? <span className="text-ink-3">알 수 없음</span>}
                      <span className="block text-[11.5px] text-ink-3">{l.email ?? "—"}</span>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <Chip tone={l.method === "google" ? "signal" : "neutral"}>{l.method === "google" ? "구글" : "비밀번호"}</Chip>
                    </td>
                    <td className="px-3.5 py-2.5">
                      {l.ok ? (
                        <Chip tone="ok">성공</Chip>
                      ) : (
                        <>
                          <Chip tone="late">
                            <CircleX className="size-3" />
                            실패
                          </Chip>
                          <span className="mt-0.5 block text-[11.5px] text-ink-3">{l.reasonLabel}</span>
                        </>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      {l.device}
                      <span className="num block text-[11.5px] text-ink-3">{l.ip ?? "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.more && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" size="sm" className="rounded-xl px-4" disabled={loadingMore} onClick={more}>
                {loadingMore ? "불러오는 중…" : "더 보기"}
              </Button>
            </div>
          )}
        </>
      )}
    </CardShell>
  );
}
