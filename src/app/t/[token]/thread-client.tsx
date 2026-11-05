"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DEFAULT_PUBLIC_PROFILE,
  ProfileAvatar,
  PublicProfileProvider,
  type PublicProfile,
} from "@/components/chat/public-profile";
import { Chip } from "@/components/ui/chip";
import { INQUIRY_STATUS, ThreadView } from "@/components/widget/thread-view";
import { cn } from "@/lib/utils";
import { api, type ChatMessage } from "@/lib/client/api";

// iOS Safari 는 키보드가 올라와도 dvh 를 줄이지 않고 페이지 전체를 위로 밀어 올린다(헤더·대화가 잘림).
// 눈에 보이는 영역(visualViewport)의 높이·위치에 화면을 맞춰 헤더는 남기고 대화 영역만 줄어들게 한다.
function useVisualViewport() {
  const [box, setBox] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBox({ height: vv.height, top: vv.offsetTop });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return box;
}

export function ThreadClient() {
  const { token } = useParams<{ token: string }>();
  const [profile, setProfile] = useState<PublicProfile>(DEFAULT_PUBLIC_PROFILE);
  const vv = useVisualViewport();
  // 휴대폰에서 작성 중이면 헤더를 한 줄로 줄이고, 접힌 상태 줄 대신 헤더 오른쪽에 상태 칩을 둔다
  const [compact, setCompact] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const st = status ? INQUIRY_STATUS[status] : null;
  return (
    <PublicProfileProvider value={profile}>
    <div
      className="ambient fixed inset-x-0 top-0 flex h-dvh justify-center p-0 sm:p-4"
      style={vv ? { height: vv.height, transform: `translateY(${vv.top}px)` } : undefined}
    >
      <div className="glass flex w-full max-w-xl flex-col overflow-hidden sm:rounded-panel">
        <header className={cn("flex items-center gap-3 border-b transition-[padding]", compact ? "px-4 py-2" : "px-5 py-4")}>
          <ProfileAvatar size={compact ? "sm" : "md"} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{profile.name}</p>
            {!compact && <p className="text-xs text-ink-3">내 문의</p>}
          </div>
          {compact && st && (
            <Chip tone={st.tone} className="ml-auto">
              {st.label}
            </Chip>
          )}
        </header>
        <ThreadView
          sla="영업일 기준 24시간 이내"
          emailEnabled
          onCompactChange={setCompact}
          load={async (after) => {
            const r = await api<{ status: string; messages: ChatMessage[]; profile?: PublicProfile }>(
              `/api/thread/${token}?after=${after}`,
            );
            if (r.profile) setProfile(r.profile);
            setStatus(r.status);
            return r;
          }}
          send={async (m) =>
            (
              await api<{ message: ChatMessage }>(`/api/thread/${token}`, {
                method: "POST",
                body: JSON.stringify(m),
              })
            ).message
          }
        />
      </div>
    </div>
    </PublicProfileProvider>
  );
}
