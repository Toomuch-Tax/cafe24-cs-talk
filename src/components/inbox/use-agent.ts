"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

export type AgentInfo = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "agent";
  avatar_url: string | null;
  avatar_emoji: string;
  avatar_mode: "emoji" | "image" | "google";
  google_picture: string | null;
  emailReplies: boolean;
  // 사진 첨부 저장소가 설정돼 있는지 (답변·메모에 사진 올리기)
  attachments: boolean;
  pendingUsers: number;
};

// 로그인 확인. 세션이 없으면 /login 으로 보낸다. (실제 권한 검사는 모든 API 에서 서버가 한다)
export function useAgent() {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  useEffect(() => {
    const load = () =>
      api<{
        agent: Omit<AgentInfo, "emailReplies" | "attachments" | "pendingUsers">;
        pendingUsers?: number;
        features: { email: boolean; attachments?: boolean };
      }>("/api/auth/me")
        .then((r) =>
          setAgent({
            ...r.agent,
            emailReplies: r.features.email,
            attachments: Boolean(r.features.attachments),
            pendingUsers: r.pendingUsers ?? 0,
          }),
        )
        // 로그인 뒤 보던 주소로 돌아온다 (슬랙 알림의 /inbox?c=<id> 링크 등)
        .catch(() => router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`));
    load();
    // 프로필 사진을 바꾸면 독(사이드바)의 내 사진도 바로 바뀌게
    window.addEventListener("cstalk:agent-updated", load);
    return () => window.removeEventListener("cstalk:agent-updated", load);
  }, [router]);
  return agent;
}
