"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/inbox/app-shell";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Notice } from "@/components/ui/notice";
import { GoogleG } from "@/components/ui/google-g";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { ChoiceCards, SwitchRow } from "./field";

type Access = {
  policy: { autoApprove: boolean; passwordLogin: boolean };
  google: boolean;
  domains: string[];
  meGoogleLinked: boolean;
};

export function AccessSettings() {
  const [data, setData] = useState<Access | null>(null);
  const [policy, setPolicy] = useState<Access["policy"] | null>(null);

  useEffect(() => {
    api<Access>("/api/inbox/access")
      .then((r) => (setData(r), setPolicy(r.policy)))
      .catch((err) => toast.error("로그인 설정을 불러오지 못했어요.", err));
  }, []);

  if (!data || !policy) return null;
  const domains = data.domains.map((d) => `@${d}`).join(", ");
  const canDisablePassword = data.google && data.meGoogleLinked;
  const dirty =
    policy.autoApprove !== data.policy.autoApprove || policy.passwordLogin !== data.policy.passwordLogin;

  return (
    <>
      <Card title="구글 로그인" hint="회사 Google Workspace 계정으로 로그인해요. 퇴사자는 구글 계정이 막히거나 여기서 비활성화하면 바로 못 들어와요.">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-2xl bg-panel-2 px-4 py-3 edge">
            <GoogleG className="size-5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">허용 도메인 {domains}</p>
              <p className="text-xs text-ink-3">다른 도메인·개인 gmail 계정은 로그인 화면에서 막혀요.</p>
            </div>
            {data.google ? <Chip tone="ok">켜짐</Chip> : <Chip tone="warn">설정 필요</Chip>}
          </div>
          {!data.google && (
            <Notice tone="warning" size="sm">
              구글 로그인용 OAuth 클라이언트가 아직 연결되지 않았어요. Google Cloud 콘솔에서 만든 클라이언트 ID·보안 비밀을
              Vercel 환경변수(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)에 넣으면 켜져요.
            </Notice>
          )}
        </div>
      </Card>

      <Card title="처음 로그인한 사람" hint="허용 도메인 계정으로 처음 들어온 사람을 어떻게 받을지 정해요.">
        <ChoiceCards
          name="auto-approve"
          value={policy.autoApprove ? "auto" : "approve"}
          onChange={(v) => setPolicy({ ...policy, autoApprove: v === "auto" })}
          options={[
            {
              value: "auto",
              title: "바로 상담원으로",
              badge: "추천",
              description: "회사 계정이면 바로 인박스를 쓸 수 있어요. 관리자는 따로 지정해요.",
            },
            {
              value: "approve",
              title: "관리자 승인 후",
              description: "승인 대기로 들어오고, 관리자가 사용자 탭에서 승인해야 써요. 슬랙으로 알려드려요.",
            },
          ]}
        />
        <p className="mt-3 text-xs text-ink-3">미리 등록한 사람은 이 설정과 상관없이 바로 들어와요.</p>
      </Card>

      <Card title="비밀번호 로그인" hint="구글 로그인 이전에 만든 계정용이에요.">
        <SwitchRow
          checked={policy.passwordLogin}
          disabled={!canDisablePassword && policy.passwordLogin}
          onChange={(v) => setPolicy({ ...policy, passwordLogin: v })}
          title="이메일·비밀번호 로그인 허용"
          description={
            !data.google
              ? "구글 로그인이 켜지기 전에는 끌 수 없어요."
              : !data.meGoogleLinked
                ? "내 계정을 구글로 한 번 로그인해 연결한 뒤 끌 수 있어요."
                : "모두 구글로 로그인하고 있다면 꺼 두는 게 안전해요. 꺼도 계정은 그대로이고 구글로 들어오면 돼요."
          }
        />
      </Card>

      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center gap-3 self-start rounded-2xl bg-raised px-4 py-3 shadow-lg edge">
          <span className="text-sm text-muted-foreground">바뀐 로그인 설정이 있어요.</span>
          <Button
            className="rounded-xl px-4"
            onClick={async () => {
              try {
                await api("/api/inbox/access", { method: "PUT", body: JSON.stringify(policy) });
                setData({ ...data, policy });
                toast.success("로그인 설정을 저장했어요.");
              } catch (err) {
                toast.error("로그인 설정을 저장하지 못했어요.", err);
              }
            }}
          >
            저장
          </Button>
          <Button variant="ghost" className="text-ink-3" onClick={() => setPolicy(data.policy)}>
            되돌리기
          </Button>
        </div>
      )}
    </>
  );
}
