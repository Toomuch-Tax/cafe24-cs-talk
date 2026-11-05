"use client";

import { Check, ChevronDown, Pencil, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AgentAvatar, AgentAvatarEditor } from "@/components/inbox/agent-avatar";
import { Card } from "@/components/inbox/app-shell";
import { NativeSelect } from "@/components/inbox/native-select";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Field } from "./field";

type Role = "admin" | "agent";
type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: "pending" | "active" | "disabled";
  avatar_url: string | null;
  avatar_emoji: string;
  avatar_mode: "emoji" | "image" | "google";
  google_picture: string | null;
  google: boolean;
  password: boolean;
  last_login_at: string | null;
  created_at: string;
};

const ROLE_LABEL: Record<Role, string> = { admin: "관리자", agent: "상담원" };
const ROLE_HINT: Record<Role, string> = {
  admin: "설정·AI 응답 정책·사용자 관리까지",
  agent: "문의 확인·답변, 빠른 답변",
};

function when(iso: string | null) {
  if (!iso) return "접속 기록 없음";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return `오늘 ${d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })} 접속`;
  if (days < 30) return `${days}일 전 접속`;
  return `${d.toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric" })} 접속`;
}

function UserAvatar({ user }: { user: Pick<User, "name" | "avatar_url" | "avatar_emoji"> }) {
  return <AgentAvatar agent={user} size={36} />;
}

export function UsersSettings({
  onPendingChange,
  onOpenLogins,
}: {
  onPendingChange?: (n: number) => void;
  onOpenLogins?: (userId: string) => void;
}) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [me, setMe] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [showDisabled, setShowDisabled] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ users: User[]; me: string; domains: string[] }>("/api/inbox/users");
    setUsers(r.users);
    setMe(r.me);
    setDomains(r.domains);
    onPendingChange?.(r.users.filter((u) => u.status === "pending").length);
  }, [onPendingChange]);
  useEffect(() => {
    const t = setTimeout(() => load().catch((err) => toast.error("사용자 목록을 불러오지 못했어요.", err)), 0);
    return () => clearTimeout(t);
  }, [load]);

  const patch = async (u: User, body: Partial<Pick<User, "name" | "role" | "status">>, done: string) => {
    try {
      await api(`/api/inbox/users/${u.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(`${u.name} 님 정보를 바꾸지 못했어요.`, err);
    }
  };
  const remove = async (u: User, done: string) => {
    try {
      await api(`/api/inbox/users/${u.id}`, { method: "DELETE" });
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(`${u.name} 님을 삭제하지 못했어요.`, err);
    }
  };

  if (!users) return <Card title="사용자"><p className="text-sm text-ink-3">불러오는 중…</p></Card>;
  const pending = users.filter((u) => u.status === "pending");
  const active = users.filter((u) => u.status === "active");
  const disabled = users.filter((u) => u.status === "disabled");

  return (
    <>
      {pending.length > 0 && (
        <Card title={`승인 대기 ${pending.length}명`} hint="회사 구글 계정으로 로그인을 시도한 사람이에요. 승인하면 상담원으로 들어와요.">
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl bg-panel-2 edge">
            {pending.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <UserAvatar user={u} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.name}</p>
                  <p className="truncate text-xs text-ink-3">{u.email}</p>
                </div>
                <Button size="sm" className="rounded-xl" onClick={() => patch(u, { status: "active" }, `${u.name} 님을 승인했어요.`)}>
                  <Check className="size-3.5" />
                  승인
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-ink-3"
                  onClick={() => remove(u, `${u.name} 님의 요청을 거절했어요.`)}
                >
                  거절
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={`사용자 ${active.length}명`}
        hint="회사 구글 계정으로 로그인하는 운영 콘솔 사용자예요. 이름은 인박스 담당자 표시에만 쓰이고 고객에게는 보이지 않아요."
      >
        <ul className="flex flex-col divide-y overflow-hidden rounded-2xl bg-panel-2 edge">
          {active.map((u) => (
            <UserRow key={u.id} user={u} self={u.id === me} onPatch={patch} onReload={load} onOpenLogins={onOpenLogins} />
          ))}
        </ul>

        {adding ? (
          <AddUserForm
            domains={domains}
            onCancel={() => setAdding(false)}
            onDone={async () => {
              setAdding(false);
              await load();
            }}
          />
        ) : (
          <Button variant="outline" className="mt-4 rounded-xl px-4" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" />
            사용자 미리 등록
          </Button>
        )}

        {disabled.length > 0 && (
          <div className="mt-5">
            <button
              type="button"
              aria-expanded={showDisabled}
              onClick={() => setShowDisabled((v) => !v)}
              className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", showDisabled && "rotate-180")} />
              비활성 사용자 {disabled.length}명
            </button>
            {showDisabled && (
              <ul className="mt-2 flex flex-col divide-y overflow-hidden rounded-2xl bg-panel-2 opacity-80 edge">
                {disabled.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                    <UserAvatar user={u} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-muted-foreground">{u.name}</p>
                      <p className="truncate text-xs text-ink-3">{u.email}</p>
                    </div>
                    {!u.last_login_at && !u.password ? (
                      <Button size="sm" variant="ghost" className="text-ink-3" onClick={() => remove(u, `${u.name} 님을 삭제했어요.`)}>
                        삭제
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => patch(u, { status: "active" }, `${u.name} 님을 다시 활성화했어요.`)}
                    >
                      다시 활성화
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card title="권한 안내">
        <dl className="grid gap-3 sm:grid-cols-2">
          {(["admin", "agent"] as const).map((r) => (
            <div key={r} className="rounded-2xl bg-panel-2 p-4 edge">
              <dt className="text-sm font-semibold">{ROLE_LABEL[r]}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-ink-3">{ROLE_HINT[r]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}

function UserRow({
  user: u,
  self,
  onPatch,
  onReload,
  onOpenLogins,
}: {
  user: User;
  self: boolean;
  onPatch: (u: User, body: Partial<Pick<User, "name" | "role" | "status">>, done: string) => Promise<void>;
  onReload: () => Promise<void>;
  onOpenLogins?: (userId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [name, setName] = useState(u.name);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <button
        type="button"
        aria-label={`${u.name} 프로필 사진 바꾸기`}
        aria-expanded={editingAvatar}
        title="프로필 사진 바꾸기"
        onClick={() => setEditingAvatar((v) => !v)}
        className="group relative rounded-full"
      >
        <UserAvatar user={u} />
        <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-raised text-ink-3 opacity-0 edge transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-expanded:opacity-100">
          <Pencil className="size-2.5" />
        </span>
      </button>
      <div className="min-w-0 flex-1 basis-48">
        {editing ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              await onPatch(u, { name: name.trim() }, "이름을 바꿨어요.");
              setEditing(false);
            }}
          >
            <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="h-8" autoFocus aria-label="이름" />
            <Button type="submit" size="icon" variant="ghost" aria-label="이름 저장" className="size-8">
              <Check className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="취소"
              className="size-8 text-ink-3"
              onClick={() => (setEditing(false), setName(u.name))}
            >
              <X className="size-4" />
            </Button>
          </form>
        ) : (
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{u.name}</span>
            {self && <Chip tone="signal">나</Chip>}
            <button
              type="button"
              aria-label={`${u.name} 이름 바꾸기`}
              className="rounded p-0.5 text-ink-3 hover:text-foreground"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3" />
            </button>
          </p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
          <span className="truncate">{u.email}</span>
          <span aria-hidden>·</span>
          {u.google || u.password ? (
            <>
              <span>{u.google ? "구글" : "비밀번호"}</span>
              <span aria-hidden>·</span>
              <span>{when(u.last_login_at)}</span>
              {onOpenLogins && u.last_login_at && (
                <>
                  <span aria-hidden>·</span>
                  <button
                    type="button"
                    className="font-semibold text-signal-text hover:underline"
                    onClick={() => onOpenLogins(u.id)}
                  >
                    로그인 기록
                  </button>
                </>
              )}
            </>
          ) : (
            <span>아직 로그인 전</span>
          )}
        </p>
      </div>
      <NativeSelect
        aria-label={`${u.name} 권한`}
        value={u.role}
        disabled={self}
        title={self ? "내 권한은 다른 관리자가 바꿀 수 있어요." : undefined}
        onChange={(e) => {
          const role = e.target.value as Role;
          onPatch(u, { role }, `${u.name} 님을 ${ROLE_LABEL[role]}(으)로 바꿨어요.`);
        }}
      >
        <option value="admin">관리자</option>
        <option value="agent">상담원</option>
      </NativeSelect>
      {!self && (
        <Button
          size="sm"
          variant="ghost"
          className="text-ink-3 hover:text-late-text"
          onClick={() => onPatch(u, { status: "disabled" }, `${u.name} 님을 비활성화했어요. 바로 로그아웃돼요.`)}
        >
          비활성화
        </Button>
      )}
      {editingAvatar && (
        <div className="basis-full rounded-2xl bg-raised p-4 edge">
          <AgentAvatarEditor agent={u} onSaved={onReload} />
        </div>
      )}
    </li>
  );
}

function AddUserForm({ domains, onCancel, onDone }: { domains: string[]; onCancel: () => void; onDone: () => void }) {
  const [local, setLocal] = useState("");
  const [domain, setDomain] = useState(domains[0] ?? "");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const email = local.includes("@") ? local.trim() : `${local.trim()}@${domain}`;

  return (
    <form
      className="mt-4 flex flex-col gap-4 rounded-2xl bg-raised p-4 edge"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/inbox/users", { method: "POST", body: JSON.stringify({ email, name: name.trim(), role }) });
          toast.success(`${name.trim()} 님을 등록했어요.`, {
            description: "이 주소의 구글 계정으로 로그인하면 바로 들어와요.",
          });
          onDone();
        } catch (err) {
          toast.error("사용자를 등록하지 못했어요.", err);
        }
      }}
    >
      <p className="text-xs leading-relaxed text-ink-3">
        미리 등록해 두면 승인 절차 없이 정한 권한으로 바로 들어와요. 비밀번호는 없어요 — 회사 구글 계정으로만 로그인해요.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="회사 이메일">
          <div className="flex items-center gap-1.5">
            <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="hong" aria-label="이메일 아이디" required />
            {!local.includes("@") &&
              (domains.length > 1 ? (
                <NativeSelect value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="도메인" className="h-9">
                  {domains.map((d) => (
                    <option key={d} value={d}>
                      @{d}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <span className="shrink-0 text-sm text-ink-3">@{domain}</span>
              ))}
          </div>
        </Field>
        <Field label="이름" hint="인박스에 보이는 이름">
          <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="홍길동" required />
        </Field>
      </div>
      <Field label="권한">
        <div className="flex gap-2">
          {(["agent", "admin"] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={role === r}
              onClick={() => setRole(r)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                role === r ? "bg-foreground text-background" : "bg-panel-3 text-ink-3 edge hover:text-foreground",
              )}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
      </Field>
      <div className="flex gap-2">
        <Button type="submit" className="rounded-xl px-4" disabled={!local.trim() || !name.trim()}>
          등록
        </Button>
        <Button type="button" variant="ghost" className="text-ink-3" onClick={onCancel}>
          취소
        </Button>
      </div>
    </form>
  );
}
