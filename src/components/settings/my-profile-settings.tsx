"use client";

import { Compass } from "lucide-react";
import { AgentAvatar, AgentAvatarEditor } from "@/components/inbox/agent-avatar";
import { Card, useConsole } from "@/components/inbox/app-shell";
import type { AgentInfo } from "@/components/inbox/use-agent";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

// 내 프로필 사진. 저장하면 useAgent 가 다시 불러와 이 화면과 독의 사진이 함께 바뀐다.
export function MyProfileSettings({ agent }: { agent: AgentInfo }) {
  const { startTour } = useConsole();
  return (
    <>
    <Card title="내 프로필 사진" hint="인박스의 담당자 표시와 왼쪽 메뉴에 보여요.">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-2xl bg-panel-2 px-4 py-3 edge">
          <AgentAvatar agent={agent} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{agent.name}</p>
            <p className="truncate text-xs text-ink-3">{agent.email}</p>
          </div>
        </div>
        <AgentAvatarEditor agent={agent} />
        <Notice tone="info" size="sm">
          이 사진은 운영 콘솔 안에서 동료에게만 보여요. 고객에게는 &lsquo;고객 노출 정보&rsquo;의 이름·로고만 보여요.
        </Notice>
      </div>
    </Card>
    <Card title="콘솔 둘러보기" hint="처음 로그인할 때 본 메뉴 설명을 다시 볼 수 있어요.">
      <Button variant="outline" onClick={startTour}>
        <Compass strokeWidth={1.75} />
        가이드 다시 보기
      </Button>
    </Card>
    </>
  );
}
