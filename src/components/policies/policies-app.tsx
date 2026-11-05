"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError, Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Panel, useConsole } from "@/components/inbox/app-shell";
import { api, ApiError, formatTime } from "@/lib/client/api";
import { errorReason } from "@/lib/client/error-text";
import { cn } from "@/lib/utils";
import { lineDiff } from "./diff";
import { SHOP_URL } from "@/lib/brand";

type Mode = "auto" | "draft" | "off";
type Kind = "always" | "topic" | "product";
type Product = { no: number; name: string; image?: string | null };
type Topic = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: Kind;
  ai_mode: Mode;
  categories: string[];
  products: Product[];
  sort_order: number;
  archived: boolean;
  version: number | null;
  version_id: string | null;
  updated_at: string | null;
  updated_by: string | null;
};
type TopicDetail = Topic & { content: string | null };
type Version = { id: string; version: number; change_note: string | null; created_at: string; created_by: string | null };

const MODE_LABEL: Record<Mode, { label: string; desc: string; tone: string }> = {
  auto: { label: "자동 응답", desc: "고객 질문에 AI 가 바로 답해요", tone: "bg-status-open/15 text-status-open" },
  draft: { label: "초안만", desc: "고객에게는 문의 남기기로 안내하고, 상담원 AI 초안에만 써요", tone: "bg-muted text-foreground" },
  off: { label: "사용 안 함", desc: "AI 가 이 주제를 참고하지 않아요", tone: "bg-muted text-muted-foreground" },
};
const CATS: [string, string][] = [
  ["shipping", "배송"],
  ["return", "반품"],
  ["exchange", "교환"],
  ["defect", "불량"],
  ["restock", "재입고"],
  ["size", "사이즈"],
  ["etc", "기타"],
];
const KIND_OPTIONS: [Kind, string][] = [
  ["topic", "주제별 (관련 질문에만)"],
  ["always", "항상 적용 (모든 답변)"],
  ["product", "상품별 (지정한 상품 페이지 질문에만)"],
];
const GROUPS: { kind: Kind; label: string; desc: string; add: string }[] = [
  { kind: "always", label: "항상 적용", desc: "말투·금지 규칙", add: "+ 항상 적용 규칙 추가" },
  { kind: "topic", label: "주제별", desc: "배송·반품 등 관련 질문에만", add: "+ 주제 추가" },
  { kind: "product", label: "상품별 응대", desc: "지정한 상품 페이지 질문에만", add: "+ 상품별 정책 추가" },
];
const productNames = (list: Product[]) => list.map((p) => p.name || `#${p.no}`).join(", ");
// 테스트 패널에서 그 상품 페이지에서 물은 것처럼 돌리기 위한 주소 (productNoFromUrl 이 product_no= 를 읽는다)
const productPageUrl = (no: number) => `${SHOP_URL}/product/detail.html?product_no=${no}`;
const unverified = (s: string) => s.split("\n").filter((l) => l.includes("[확인 필요]")).length;

export function PoliciesApp() {
  const { agent } = useConsole();
  const [tab, setTab] = useState<"docs" | "log" | "settings">("docs");
  if (!agent) return null;
  const isAdmin = agent.role === "admin";

  return (
    <>
      <Panel className="flex-1">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-6 pt-5 pb-4">
          <div>
            <h1 className="text-[22px] leading-tight font-bold tracking-[-0.025em]">AI 응답 정책</h1>
            <p className="mt-0.5 text-xs text-ink-3">
              AI 가 답할 때 참고하는 정책 문서와 응답 기록{!isAdmin && " · 보기 전용"}
            </p>
          </div>
          <div className="flex gap-1 rounded-xl bg-panel-2 p-1 edge" role="tablist">
            {(
              [
                ["docs", "정책 문서"],
                ["log", "AI 응답 기록"],
                ["settings", "AI 설정"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  tab === k ? "bg-panel-3 text-foreground edge" : "text-ink-3 hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </header>
        {tab === "docs" ? <Docs isAdmin={isAdmin} /> : tab === "log" ? <AnswerLog /> : <AiSettings isAdmin={isAdmin} />}
      </Panel>
    </>
  );
}

function Docs({ isAdmin }: { isAdmin: boolean }) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<Kind | null>(null);
  const [kindTab, setKindTab] = useState<Kind>("always");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ topics: Topic[] }>(`/api/policies${showArchived ? "?archived=1" : ""}`);
    setTopics(r.topics);
    setSelected((cur) => cur ?? r.topics[0]?.id ?? null);
  }, [showArchived]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // 1열: 묶음 → 2열: 그 묶음의 정책 → 3열: 편집. 목록이 길어져도 묶음을 골라 짧게 본다
  const group = (topics.find((t) => t.id === selected)?.kind ?? creating ?? kindTab) as Kind;
  const list = topics.filter((t) => t.kind === group);
  const pick = (k: Kind) => {
    setKindTab(k);
    setCreating(null);
    setSelected(topics.find((t) => t.kind === k)?.id ?? null);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r p-2" data-tour="policy-topics" aria-label="정책 묶음">
        {GROUPS.map((g) => {
          const count = topics.filter((t) => t.kind === g.kind).length;
          return (
            <button
              key={g.kind}
              onClick={() => pick(g.kind)}
              data-tour={g.kind === "product" ? "policy-products" : undefined}
              aria-current={group === g.kind || undefined}
              className={cn("flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted/60", group === g.kind && "bg-muted")}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {g.label}
                <span className="ml-auto text-[11px] font-normal text-muted-foreground tabular-nums">{count}</span>
              </span>
              <span className="text-[11px] leading-snug text-ink-3">{g.desc}</span>
            </button>
          );
        })}
        <label className="mt-auto flex items-center gap-1.5 px-2.5 py-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          보관한 주제도 보기
        </label>
      </nav>
      <aside className="flex w-64 shrink-0 flex-col border-r" data-tour="policy-topics">
        {isAdmin && (
          <div className="border-b p-2">
            <Button size="sm" variant="outline" className="w-full" onClick={() => setCreating(group)}>
              {GROUPS.find((g) => g.kind === group)!.add}
            </Button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto py-1">
          {list.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-ink-3">
              {group === "product"
                ? "특정 상품에만 해당하는 안내(소재·세탁·핏, 예약 출고일 등)를 상품별로 적어 두면 그 상품 페이지 질문에만 AI 가 참고해요."
                : "아직 정책이 없어요."}
            </p>
          )}
          {list.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setCreating(null);
                setSelected(t.id);
              }}
              className={cn("flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-muted/60", selected === t.id && !creating && "bg-muted")}
            >
              <span className={cn("truncate text-sm", t.archived && "text-muted-foreground line-through")}>{t.title}</span>
              {t.kind === "product" && (
                <span className="truncate text-[11px] text-ink-3">{t.products.length ? productNames(t.products) : "상품 미지정"}</span>
              )}
              <span className="flex items-center gap-1.5 text-[11px]">
                <span className={cn("rounded px-1.5 py-0.5", MODE_LABEL[t.ai_mode].tone)}>{MODE_LABEL[t.ai_mode].label}</span>
                <span className="text-muted-foreground">v{t.version ?? 0}</span>
                {t.updated_at && <span className="ml-auto text-muted-foreground">{formatTime(t.updated_at)}</span>}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {creating ? (
          <NewTopic
            key={creating}
            initialKind={creating}
            onCreated={(id) => {
              setKindTab(creating);
              setCreating(null);
              setSelected(id);
              load();
            }}
          />
        ) : selected ? (
          <TopicEditor key={selected} id={selected} isAdmin={isAdmin} onChanged={load} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">왼쪽 목록에서 정책을 선택하세요.</p>
        )}
      </main>
    </div>
  );
}

function ModePicker({ value, onChange, disabled }: { value: Mode; onChange: (m: Mode) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m)}
            className={cn("rounded-md border px-2.5 py-1 text-xs", value === m ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}
          >
            {MODE_LABEL[m].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{MODE_LABEL[value].desc}</p>
    </div>
  );
}

function ProductThumb({ src, size }: { src?: string | null; size: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- Cafe24 CDN 썸네일, 최적화 불필요
    <img src={src} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-md bg-muted object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="shrink-0 rounded-md bg-muted" style={{ width: size, height: size }} />
  );
}

// 상품별 정책의 대상 상품: 상품 페이지 주소·상품 번호·상품명으로 찾아 추가한다
function ProductPicker({ value, onChange, disabled }: { value: Product[]; onChange: (v: Product[]) => void; disabled?: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ products: Product[] }>(`/api/policies/products?q=${encodeURIComponent(q.trim())}`);
      // 한 개만 나오면 (주소·번호로 찾은 경우) 바로 추가
      if (r.products.length === 1) {
        add(r.products[0]);
        setResults(null);
      } else setResults(r.products);
    } catch (err) {
      toast.error("상품을 찾지 못했어요.", err);
    } finally {
      setBusy(false);
    }
  };
  const add = (p: Product) => {
    if (!value.some((v) => v.no === p.no)) onChange([...value, p]);
    setQ("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {value.length === 0 && <span className="text-xs text-unread">아직 지정한 상품이 없어요. 상품을 추가해야 AI 가 이 정책을 써요.</span>}
        {value.map((p) => (
          <span key={p.no} className="flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 text-[11px]">
            <ProductThumb src={p.image} size={20} />
            {p.name || `#${p.no}`}
            <span className="text-muted-foreground">#{p.no}</span>
            {!disabled && (
              <button type="button" aria-label={`${p.name} 빼기`} className="text-muted-foreground hover:text-foreground" onClick={() => onChange(value.filter((v) => v.no !== p.no))}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex gap-1.5">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                search();
              }
            }}
            placeholder="상품 페이지 주소, 상품 번호 또는 영문 상품명 (예: HOODIE)"
            className="h-8 text-xs"
            aria-label="상품 찾기"
          />
          <Button size="sm" variant="outline" disabled={busy || !q.trim()} onClick={search}>
            {busy ? "찾는 중…" : "찾기"}
          </Button>
        </div>
      )}
      {results && (
        <ul className="max-h-72 overflow-y-auto rounded-lg border text-xs">
          {results.length === 0 && <li className="px-2.5 py-2 text-muted-foreground">맞는 상품이 없어요. 상품명은 쇼핑몰에 등록된 영문 이름으로 찾거나, 상품 페이지 주소를 붙여 넣어 주세요.</li>}
          {results.map((p) => (
            <li key={p.no}>
              <button type="button" className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-muted" onClick={() => add(p)}>
                <ProductThumb src={p.image} size={40} />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">#{p.no}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TopicEditor({ id, isAdmin, onChanged }: { id: string; isAdmin: boolean; onChanged: () => void }) {
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [meta, setMeta] = useState<{
    title: string;
    description: string;
    ai_mode: Mode;
    categories: string[];
    kind: Kind;
    products: Product[];
  } | null>(null);
  // 버전 충돌은 해결될 때까지 편집기 아래에 남긴다
  const [conflict, setConflict] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; version: number; content: string; change_note: string | null } | null>(null);

  const load = useCallback(async () => {
    let r: { topic: TopicDetail; versions: Version[] };
    try {
      r = await api<{ topic: TopicDetail; versions: Version[] }>(`/api/policies/${id}`);
      setLoadError(null);
    } catch (err) {
      setLoadError(`정책을 불러오지 못했어요. ${errorReason(err).reason}`);
      return;
    }
    setTopic(r.topic);
    setVersions(r.versions);
    setContent(r.topic.content ?? "");
    setMeta({
      title: r.topic.title,
      description: r.topic.description ?? "",
      ai_mode: r.topic.ai_mode,
      categories: r.topic.categories,
      kind: r.topic.kind,
      products: r.topic.products,
    });
  }, [id]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = topic ? content !== (topic.content ?? "") : false;
  const metaDirty =
    topic && meta
      ? meta.title !== topic.title ||
        meta.description !== (topic.description ?? "") ||
        meta.ai_mode !== topic.ai_mode ||
        meta.kind !== topic.kind ||
        meta.categories.join() !== topic.categories.join() ||
        meta.products.map((p) => p.no).join() !== topic.products.map((p) => p.no).join()
      : false;
  const pending = useMemo(() => unverified(content), [content]);

  if (!topic || !meta)
    return loadError ? (
      <Notice tone="error" className="m-6" action={{ label: "다시 시도", onClick: load }}>
        {loadError}
      </Notice>
    ) : (
      <p className="p-6 text-sm text-muted-foreground">불러오는 중…</p>
    );

  const saveContent = async () => {
    try {
      const r = await api<{ version: number; unchanged: boolean }>(`/api/policies/${id}/versions`, {
        method: "POST",
        body: JSON.stringify({ content, changeNote: note || null, baseVersion: topic.version }),
      });
      setConflict(null);
      if (r.unchanged) toast.info("바뀐 내용이 없어요.");
      else toast.success(`${topic.title} 정책을 v${r.version}로 저장했어요.`, { description: "AI 답변에 바로 반영돼요." });
      setNote("");
      await load();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code.startsWith("version_conflict"))
        setConflict(
          `다른 사람이 먼저 v${err.code.split(":")[1]}을 저장했어요. 내 수정 내용을 복사해 두고 새로고침한 뒤 다시 반영해주세요.`,
        );
      else toast.error("정책을 저장하지 못했어요.", err);
    }
  };
  const saveMeta = async (patch: Record<string, unknown>, done: string) => {
    try {
      await api(`/api/policies/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (err) {
      toast.error("주제 설정을 저장하지 못했어요.", err);
      return;
    }
    toast.success(done);
    await load();
    onChanged();
  };

  return (
    <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <Input
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
              disabled={!isAdmin}
              className="text-base font-semibold"
              aria-label="주제 이름"
            />
            <span className="shrink-0 text-xs text-muted-foreground">id: {topic.slug}</span>
          </div>
          <Input
            value={meta.description}
            onChange={(e) => setMeta({ ...meta, description: e.target.value })}
            disabled={!isAdmin}
            placeholder="한 줄 설명 (AI 가 언제 이 주제를 쓸지 판단하는 데 도움이 돼요)"
            aria-label="설명"
          />
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">AI 사용 방식</span>
              <ModePicker value={meta.ai_mode} onChange={(m) => setMeta({ ...meta, ai_mode: m })} disabled={!isAdmin} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">적용 범위</span>
              <select
                value={meta.kind}
                disabled={!isAdmin}
                onChange={(e) => setMeta({ ...meta, kind: e.target.value as Kind })}
                className="h-8 rounded-lg border bg-background px-2 text-xs"
              >
                {KIND_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">연결된 문의 유형</span>
              <div className="flex flex-wrap gap-1">
                {CATS.map(([v, l]) => {
                  const on = meta.categories.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      disabled={!isAdmin}
                      onClick={() => setMeta({ ...meta, categories: on ? meta.categories.filter((c) => c !== v) : [...meta.categories, v] })}
                      className={cn("rounded-full border px-2 py-0.5 text-[11px]", on ? "border-foreground" : "text-muted-foreground")}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {meta.kind === "product" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">적용할 상품</span>
              <ProductPicker value={meta.products} onChange={(products) => setMeta({ ...meta, products })} disabled={!isAdmin} />
            </div>
          )}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!metaDirty}
                onClick={() =>
                  saveMeta({
                    title: meta.title,
                    description: meta.description || null,
                    ai_mode: meta.ai_mode,
                    kind: meta.kind,
                    categories: meta.categories,
                    products: meta.products,
                  }, "주제 설정을 저장했어요.")
                }
              >
                설정 저장
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() =>
                  saveMeta(
                    { archived: !topic.archived },
                    topic.archived ? "보관을 해제했어요. AI 답변에 다시 쓰여요." : "보관했어요. AI 답변에서 빠져요.",
                  )
                }>
                {topic.archived ? "보관 해제" : "보관 (AI 에서 제외)"}
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">정책 내용</span>
            <span>
              현재 v{topic.version ?? 0}
              {topic.updated_by && ` · ${topic.updated_by}`}
              {topic.updated_at && ` · ${formatTime(topic.updated_at)}`}
            </span>
            {dirty && <span className="text-unread">저장 안 됨</span>}
            {pending > 0 && <span className="ml-auto">[확인 필요] 줄 {pending}개는 AI 에 전달되지 않아요</span>}
          </div>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            readOnly={!isAdmin}
            rows={18}
            className="font-mono text-[13px] leading-relaxed"
            aria-label="정책 내용"
          />
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="변경 메모 (예: 반품비 3,000원으로 수정)" className="h-8 text-xs" />
              <Button size="sm" disabled={!dirty} onClick={saveContent}>
                새 버전으로 저장
              </Button>
            </div>
          )}
          {conflict && <Notice tone="warning">{conflict}</Notice>}
        </div>

        {viewing && (
          <div className="flex flex-col gap-2 rounded-xl border p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">v{viewing.version} 과 현재 v{topic.version} 비교</span>
              {viewing.change_note && <span className="text-xs text-muted-foreground">— {viewing.change_note}</span>}
              <div className="ml-auto flex gap-1">
                {isAdmin && viewing.version !== topic.version && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!confirm(`v${viewing.version} 내용으로 되돌릴까요? 새 버전으로 기록돼요.`)) return;
                      let r: { version: number };
                      try {
                        r = await api<{ version: number }>(`/api/policies/${id}/restore`, {
                          method: "POST",
                          body: JSON.stringify({ versionId: viewing.id }),
                        });
                      } catch (err) {
                        toast.error("이전 버전으로 되돌리지 못했어요.", err);
                        return;
                      }
                      toast.success(`v${viewing.version} 내용으로 되돌려 v${r.version}로 저장했어요.`);
                      setViewing(null);
                      await load();
                      onChanged();
                    }}
                  >
                    이 버전으로 되돌리기
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setViewing(null)}>
                  닫기
                </Button>
              </div>
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg bg-muted/50 p-3 text-[12px] leading-relaxed whitespace-pre-wrap">
              {lineDiff(viewing.content, topic.content ?? "").map((d, i) => (
                <div
                  key={i}
                  className={cn(d.type === "add" && "bg-status-open/15", d.type === "del" && "bg-unread/15 line-through opacity-70")}
                >
                  {d.type === "add" ? "+ " : d.type === "del" ? "- " : "  "}
                  {d.text}
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <TestPanel
          key={topic.products[0]?.no ?? 0}
          topicId={id}
          content={content}
          defaultUrl={topic.kind === "product" && topic.products[0] ? productPageUrl(topic.products[0].no) : ""}
        />
        <section className="rounded-xl border p-4">
          <h3 className="mb-2 text-sm font-medium">버전 히스토리</h3>
          <ol className="flex flex-col gap-1">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  className={cn("flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted", viewing?.id === v.id && "bg-muted")}
                  onClick={async () => {
                    const r = await api<{ version: { id: string; version: number; content: string; change_note: string | null } }>(
                      `/api/policies/${id}/versions/${v.id}`,
                    );
                    setViewing(r.version);
                  }}
                >
                  <span className="flex items-center gap-2 text-xs">
                    <span className="font-medium">v{v.version}</span>
                    {v.version === topic.version && <span className="rounded bg-foreground px-1 text-[10px] text-background">현재</span>}
                    <span className="ml-auto text-muted-foreground">{formatTime(v.created_at)}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {v.change_note ?? "메모 없음"}
                    {v.created_by && ` · ${v.created_by}`}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

type TestResult = { decision: string; answer: string | null; reason: string | null; topics: string[]; category: string };
const DECISION_LABEL: Record<string, string> = {
  answered: "AI 가 바로 답변",
  handoff: "문의 남기기로 안내",
  blocked: "위험 표현으로 차단 → 문의 안내",
  error: "오류",
};

function TestPanel({ topicId, content, defaultUrl }: { topicId: string; content: string; defaultUrl: string }) {
  const [q, setQ] = useState("");
  const [url, setUrl] = useState(defaultUrl);
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="flex flex-col gap-2 rounded-xl border p-4">
      <h3 className="text-sm font-medium">테스트</h3>
      <p className="text-xs text-muted-foreground">저장 전 내용으로 AI 가 어떻게 답할지 확인해요. 고객에게는 보이지 않아요.</p>
      <Textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} placeholder="예: 세일 상품도 반품 되나요?" aria-label="테스트 질문" />
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="(선택) 상품 페이지 주소" className="h-8 text-xs" aria-label="상품 페이지 주소" />
      {defaultUrl && <p className="text-[11px] text-muted-foreground">상품별 정책은 이 상품 페이지에서 물은 질문에만 쓰여요.</p>}
      <Button
        size="sm"
        disabled={busy || q.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          try {
            setResult(
              await api<TestResult>("/api/policies/test", {
                method: "POST",
                body: JSON.stringify({ question: q, pageUrl: url || null, overrides: { [topicId]: content } }),
              }),
            );
          } catch {
            setResult({ decision: "error", answer: null, reason: "request_failed", topics: [], category: "etc" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "생성 중…" : "테스트 실행"}
      </Button>
      {result && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-3 text-xs">
          <p className="font-medium">{DECISION_LABEL[result.decision] ?? result.decision}</p>
          {result.reason && <p className="text-muted-foreground">사유: {result.reason}</p>}
          {result.topics.length > 0 && <p className="text-muted-foreground">근거: {result.topics.join(", ")}</p>}
          {result.answer && <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.answer}</p>}
          {result.decision === "handoff" && result.reason?.startsWith("draft_only") && (
            <p className="text-muted-foreground">이 주제가 &lsquo;초안만&rsquo;이라 고객에게는 문의 남기기로 안내돼요. 위 답변은 테스트에서만 보여요.</p>
          )}
        </div>
      )}
    </section>
  );
}

function NewTopic({ initialKind, onCreated }: { initialKind: Kind; onCreated: (id: string) => void }) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<Kind>(initialKind);
  const [products, setProducts] = useState<Product[]>([]);
  const [mode, setMode] = useState<Mode>("draft");
  const [content, setContent] = useState("");
  const [slugTaken, setSlugTaken] = useState(false);
  return (
    <div className="flex max-w-2xl flex-col gap-3 p-6">
      <h2 className="text-base font-semibold">{kind === "product" ? "새 상품별 정책" : "새 주제"}</h2>
      {kind === "product" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">적용할 상품</span>
          <ProductPicker
            value={products}
            onChange={(next) => {
              setProducts(next);
              // 이름·id 를 비워 두었으면 첫 상품으로 채워 준다
              if (next[0] && !title) setTitle(next[0].name);
              if (next[0] && !slug) setSlug(`product-${next[0].no}`);
            }}
          />
        </div>
      )}
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={kind === "product" ? "정책 이름 (예: 울 니트 세탁·관리)" : "주제 이름 (예: 해외 배송)"}
      />
      <div>
        <Input
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value.toLowerCase());
            setSlugTaken(false);
          }}
          aria-invalid={slugTaken || undefined}
          placeholder="id (영문 소문자·숫자·하이픈, 예: overseas-shipping)"
        />
        {slugTaken && <FieldError className="mt-1.5">이미 있는 id 예요. 다른 id 를 써주세요.</FieldError>}
      </div>
      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="한 줄 설명" />
      <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="h-8 w-fit rounded-lg border bg-background px-2 text-xs">
        {KIND_OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <ModePicker value={mode} onChange={setMode} />
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={12}
        className="font-mono text-[13px]"
        placeholder={
          kind === "product"
            ? "- 이 상품에만 해당하는 응대 내용을 한 줄에 하나씩 적어주세요.\n- 예: 울 100%라 드라이클리닝만 가능합니다.\n- 예: 정사이즈보다 한 치수 크게 나왔습니다."
            : "- 정책을 한 줄에 하나씩 적어주세요."
        }
      />
      <Button
        className="self-start"
        disabled={!title || !slug || !content.trim() || (kind === "product" && products.length === 0)}
        onClick={async () => {
          try {
            const r = await api<{ id: string }>("/api/policies", {
              method: "POST",
              body: JSON.stringify({
                slug,
                title,
                description: description || null,
                kind,
                ai_mode: mode,
                categories: [],
                products: kind === "product" ? products : [],
                content,
              }),
            });
            toast.success(`${title} 주제를 만들었어요.`);
            onCreated(r.id);
          } catch (err) {
            if (err instanceof ApiError && err.code === "slug_taken") setSlugTaken(true);
            else
              toast.error(
                "주제를 만들지 못했어요.",
                err,
                err instanceof ApiError && err.code === "invalid_body"
                  ? { description: "id 는 영문 소문자·숫자·하이픈만 쓸 수 있어요." }
                  : undefined,
              );
          }
        }}
      >
        만들기 (v1)
      </Button>
    </div>
  );
}

type Answer = {
  id: string;
  question: string;
  answer: string | null;
  decision: string;
  reason: string | null;
  topics: string[];
  cost_usd: string;
  feedback: string | null;
  created_at: string;
};
type Stats = { asked: number; answered: number; helpful: number; not_helpful: number; drafts: number; cost_usd: number };

function AnswerLog() {
  const [kind, setKind] = useState<"customer_answer" | "agent_draft" | "test">("customer_answer");
  const [decision, setDecision] = useState("");
  const [data, setData] = useState<{ answers: Answer[]; stats: Stats } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({ kind, ...(decision ? { decision } : {}) });
    api<{ answers: Answer[]; stats: Stats }>(`/api/ai/answers?${q}`).then(setData).catch(() => {});
  }, [kind, decision]);

  const s = data?.stats;
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {s && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="이번 달 고객 질문" value={s.asked} />
          <Stat label="AI 가 바로 답변" value={s.answered} sub={s.asked ? `${Math.round((s.answered / s.asked) * 100)}%` : undefined} />
          <Stat label="도움됐어요 / 아니요" value={`${s.helpful} / ${s.not_helpful}`} />
          <Stat label="상담원 AI 초안" value={s.drafts} />
          <Stat label="이번 달 AI 비용" value={`$${s.cost_usd.toFixed(3)}`} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="h-8 rounded-lg border bg-background px-2 text-xs">
          <option value="customer_answer">고객 질문</option>
          <option value="agent_draft">상담원 초안</option>
          <option value="test">정책 테스트</option>
        </select>
        <select value={decision} onChange={(e) => setDecision(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-xs">
          <option value="">전체 결과</option>
          <option value="answered">바로 답변</option>
          <option value="handoff">문의 안내</option>
          <option value="blocked">차단</option>
          <option value="error">오류</option>
        </select>
      </div>
      <ul className="divide-y rounded-xl border">
        {data?.answers.length === 0 && <li className="p-4 text-sm text-muted-foreground">기록이 없어요.</li>}
        {data?.answers.map((a) => (
          <li key={a.id}>
            <button className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/40" onClick={() => setOpen(open === a.id ? null : a.id)}>
              <span className="flex items-center gap-2 text-xs">
                <span className="rounded bg-muted px-1.5 py-0.5">{DECISION_LABEL[a.decision] ?? a.decision}</span>
                {a.feedback && <span>{a.feedback === "helpful" ? "👍 도움됨" : "👎 도움 안 됨"}</span>}
                {a.topics.length > 0 && <span className="text-muted-foreground">{a.topics.join(", ")}</span>}
                <span className="ml-auto text-muted-foreground">{formatTime(a.created_at)}</span>
              </span>
              <span className="text-sm">{a.question}</span>
            </button>
            {open === a.id && (
              <div className="flex flex-col gap-1 bg-muted/30 px-4 pb-3 text-xs">
                {a.reason && <p className="text-muted-foreground">사유: {a.reason}</p>}
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{a.answer ?? "(답변 없음)"}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">고객 질문 원문은 정책 개선용으로만 보관돼요. 개인정보가 담긴 질문은 문의 접수로 넘어가요.</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">
        {value}
        {sub && <span className="ml-1 text-xs font-normal text-muted-foreground">{sub}</span>}
      </p>
    </div>
  );
}

function AiSettings({ isAdmin }: { isAdmin: boolean }) {
  const [s, setS] = useState<{ enabled: boolean; monthlyBudgetUsd: number; configured?: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoadError(null);
    api<{ enabled: boolean; monthlyBudgetUsd: number; configured?: boolean }>("/api/ai/settings")
      .then(setS)
      .catch((err) => setLoadError(`AI 설정을 불러오지 못했어요. ${errorReason(err).reason}`));
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  if (!s)
    return loadError ? (
      <Notice tone="error" className="m-6 max-w-xl" action={{ label: "다시 시도", onClick: load }}>
        {loadError}
      </Notice>
    ) : (
      <p className="p-6 text-sm text-muted-foreground">불러오는 중…</p>
    );
  return (
    <div className="flex max-w-xl flex-col gap-4 p-6">
      {s.configured === false && (
        <Notice tone="warning">
          AI 키가 없어 지금은 모든 질문이 문의 남기기로 넘어가요. 서버 환경변수에 AI_GATEWAY_API_KEY 를 넣으면 켜져요 (Vercel 에 배포했다면 자동).
        </Notice>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.enabled} disabled={!isAdmin} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        AI 응답 사용 (끄면 모든 질문이 문의 남기기로 안내돼요)
      </label>
      <label className="flex flex-col gap-1 text-sm">
        월 AI 예산 (USD) — 넘으면 이번 달은 AI 응답을 멈춰요
        <Input
          type="number"
          min={0}
          step={1}
          value={s.monthlyBudgetUsd}
          disabled={!isAdmin}
          onChange={(e) => setS({ ...s, monthlyBudgetUsd: Number(e.target.value) })}
          className="w-32"
        />
      </label>
      <p className="text-xs text-muted-foreground">고객 응답은 Claude Haiku 5.5, 상담원 초안은 Claude Sonnet 5.5 를 써요.</p>
      {isAdmin && (
        <Button
          className="self-start"
          onClick={async () => {
            try {
              await api("/api/ai/settings", { method: "PUT", body: JSON.stringify(s) });
              toast.success("AI 설정을 저장했어요.");
            } catch (err) {
              toast.error("AI 설정을 저장하지 못했어요.", err);
            }
          }}
        >
          저장
        </Button>
      )}
    </div>
  );
}
