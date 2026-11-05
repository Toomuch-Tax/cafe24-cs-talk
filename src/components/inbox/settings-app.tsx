"use client";

import { Activity, CircleUserRound, Clock, History, KeyRound, Lightbulb, MessageSquareText, Plug, UserRound, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessSettings } from "@/components/settings/access-settings";
import { AuditLog } from "@/components/settings/audit-log";
import { HoursSettings } from "@/components/settings/hours-settings";
import { PasswordSettings } from "@/components/settings/password-settings";
import { MyProfileSettings } from "@/components/settings/my-profile-settings";
import { OpsInsights } from "@/components/settings/ops-insights";
import { MessagesSettings, ProfileSettings } from "@/components/settings/profile-settings";
import { QuickRepliesSettings } from "@/components/settings/quick-replies-settings";
import { UsersSettings } from "@/components/settings/users-settings";
import { cn } from "@/lib/utils";
import { Panel, useConsole } from "./app-shell";
import { Cafe24Settings } from "./cafe24-settings";
import { OpsStatus } from "./ops-status";

// 설정은 주제별 탭으로 나눈다. 주소에 ?tab= 이 남아 슬랙 알림(승인 요청) 링크로 바로 열 수 있다.
const TABS = [
  { id: "profile", label: "고객 노출 정보", desc: "답변 이름·로고, 위젯 안내 문구", icon: UserRound, admin: false },
  { id: "me", label: "내 프로필", desc: "내 사진·비밀번호", icon: CircleUserRound, admin: false },
  { id: "hours", label: "영업 시간", desc: "영업일·운영 시간", icon: Clock, admin: false },
  { id: "quick", label: "빠른 답변", desc: "/단축어 답변", icon: MessageSquareText, admin: false },
  { id: "users", label: "사용자", desc: "구성원·권한·승인", icon: Users, admin: true },
  { id: "access", label: "로그인 · 보안", desc: "구글 로그인, 가입 방식", icon: KeyRound, admin: true },
  { id: "cafe24", label: "Cafe24 연동", desc: "쇼핑몰 연결·위젯 설치", icon: Plug, admin: false },
  { id: "ops", label: "운영 상태", desc: "알림·크론·연결 상태", icon: Activity, admin: false },
  { id: "improve", label: "운영 개선", desc: "개선 후보·오류·사용 현황", icon: Lightbulb, admin: true },
  { id: "audit", label: "변경 이력", desc: "설정 변경·로그인 기록", icon: History, admin: true },
] as const;
type TabId = (typeof TABS)[number]["id"];

const readTab = (): TabId => {
  const t = new URLSearchParams(location.search).get("tab");
  return TABS.some((x) => x.id === t) ? (t as TabId) : "profile";
};

export function SettingsApp() {
  const { agent, setPendingUsers } = useConsole();
  const [tab, setTabState] = useState<TabId>("profile");
  // 사용자 탭에서 승인·거절하면 그 값으로, 아니면 로그인 정보의 값으로 배지를 그린다
  const [pendingLive, setPending] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => setTabState(readTab());
    const t = setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    return () => (clearTimeout(t), window.removeEventListener("popstate", sync));
  }, []);
  const setTab = useCallback((id: TabId) => {
    setTabState(id);
    const url = new URL(location.href);
    url.searchParams.set("tab", id);
    if (id !== "audit") {
      url.searchParams.delete("view");
      url.searchParams.delete("user");
    }
    history.replaceState(null, "", url);
  }, []);
  // 사용자 탭 → 그 사람의 로그인 기록
  const openLogins = useCallback(
    (userId: string) => {
      const url = new URL(location.href);
      url.searchParams.set("view", "logins");
      url.searchParams.set("user", userId);
      history.replaceState(null, "", url);
      setTab("audit");
    },
    [setTab],
  );
  const onPendingChange = useCallback(
    (n: number) => {
      setPending(n);
      setPendingUsers(n);
    },
    [setPendingUsers],
  );

  if (!agent) return null;
  const isAdmin = agent.role === "admin";
  const pending = pendingLive ?? agent.pendingUsers;
  const tabs = TABS.filter((t) => isAdmin || !t.admin);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <>
      <Panel className="flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="shrink-0 border-b px-3 pt-6 pb-3 md:w-60 md:border-r md:border-b-0 md:px-4 md:py-8">
            <h1 className="px-2 text-[22px] leading-tight font-bold tracking-[-0.03em]">설정</h1>
            <nav aria-label="설정 메뉴" data-tour="settings-menu" className="mt-4 flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
              {tabs.map((t) => {
                const on = t.id === current.id;
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-current={on ? "page" : undefined}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "group flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                      on ? "bg-panel-3 text-foreground edge" : "text-muted-foreground hover:bg-panel-2 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold whitespace-nowrap">{t.label}</span>
                      <span className="hidden truncate text-[11px] text-ink-3 md:block">{t.desc}</span>
                    </span>
                    {t.id === "users" && pending > 0 && (
                      <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-signal px-1.5 text-[11px] font-bold text-white">
                        {pending}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
              <header>
                <h2 className="text-xl font-bold tracking-[-0.02em]">{current.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{current.desc}</p>
              </header>
              {current.id === "profile" && (
                <>
                  <ProfileSettings isAdmin={isAdmin} />
                  <MessagesSettings isAdmin={isAdmin} />
                </>
              )}
              {current.id === "me" && (
                <>
                  <MyProfileSettings agent={agent} />
                  <PasswordSettings email={agent.email} />
                </>
              )}
              {current.id === "hours" && <HoursSettings isAdmin={isAdmin} />}
              {current.id === "quick" && <QuickRepliesSettings />}
              {current.id === "users" && <UsersSettings onPendingChange={onPendingChange} onOpenLogins={openLogins} />}
              {current.id === "access" && <AccessSettings />}
              {current.id === "cafe24" && <Cafe24Settings isAdmin={isAdmin} />}
              {current.id === "ops" && <OpsStatus />}
              {current.id === "improve" && <OpsInsights />}
              {current.id === "audit" && <AuditLog onOpenTab={setTab} />}
            </div>
          </div>
        </div>
      </Panel>
    </>
  );
}
