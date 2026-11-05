"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { errorReason } from "@/lib/client/error-text";
import { TEST_SKIN_NO, testShopUrl } from "@/lib/client/test-shop";
import { Card } from "./app-shell";
import { SHOP_HOST } from "@/lib/brand";

type Status = {
  connected: boolean;
  configured?: boolean;
  mallId: string;
  scopes?: string[];
  missingScopes?: string[];
  refreshExpiresAt?: string;
};
type ScriptTagState = {
  installed: boolean;
  testSkinNo: number;
  tags: { scriptNo: number; mode: "live" | "test" | "legacy" }[];
};

// Cafe24 OAuth 에서 돌아올 때 ?cafe24= 로 오는 실패 이유 (connected 는 성공)
const RESULT_TEXT: Record<string, string> = {
  denied: "Cafe24 권한 승인이 취소됐어요.",
  login_required: "관리자 계정으로 로그인한 뒤 다시 시도해주세요.",
  invalid_state: "연결 요청이 만료됐어요. 다시 시도해주세요.",
  token_error: "Cafe24 토큰 발급에 실패했어요. Redirect URI·권한 설정을 확인해주세요.",
};

export function Cafe24Settings({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [tag, setTag] = useState<ScriptTagState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await api<Status>("/api/cafe24/status");
      setStatus(s);
      if (s.connected) setTag(await api<ScriptTagState>("/api/cafe24/scripttag"));
    } catch (err) {
      setLoadError(`Cafe24 상태를 불러오지 못했어요. ${errorReason(err).reason}`);
    }
  }, []);

  useEffect(() => {
    const result = new URLSearchParams(location.search).get("cafe24");
    const t = setTimeout(() => {
      if (result === "connected") toast.success("Cafe24 를 연결했어요.");
      else if (result)
        toast.error("Cafe24 를 연결하지 못했어요.", undefined, {
          description: RESULT_TEXT[result] ?? "잠시 후 다시 시도해주세요.",
        });
      load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const scripttag = async (method: "POST" | "DELETE", mode: "live" | "test") => {
    setBusy(true);
    try {
      await api(method === "DELETE" ? `/api/cafe24/scripttag?mode=${mode}` : "/api/cafe24/scripttag", {
        method,
        body: method === "POST" ? JSON.stringify({ mode }) : undefined,
      });
      const label = mode === "test" ? "테스트 스킨" : "전체 공개";
      if (method === "DELETE") toast.success(`${label} 위젯을 제거했어요.`);
      else if (mode === "test")
        toast.success(`테스트 스킨(skin${tag?.testSkinNo ?? TEST_SKIN_NO})에 위젯을 설치했어요.`, {
          description: "아래 ‘테스트 쇼핑몰 열기’로 확인하세요. 미공개 기능도 여기서만 켜져요.",
        });
      else toast.success("전체 공개 위젯을 설치했어요.", { description: "모든 방문자에게 위젯이 보여요." });
      // Cafe24 목록 API 는 설치·삭제가 한동안 늦게 반영되므로, 방금 한 작업 결과를 바로 화면에 쓴다
      setTag((prev) => {
        const others = (prev?.tags ?? []).filter((t) => t.mode !== mode && t.mode !== "legacy");
        const tags = method === "DELETE" ? others : [...others, { scriptNo: 0, mode }];
        return { testSkinNo: prev?.testSkinNo ?? TEST_SKIN_NO, installed: tags.length > 0, tags };
      });
    } catch (err) {
      const label = mode === "test" ? "테스트 스킨" : "전체 공개";
      toast.error(`${label} 위젯을 ${method === "DELETE" ? "제거" : "설치"}하지 못했어요.`, err, {
        action: { label: "다시 시도", onClick: () => scripttag(method, mode) },
      });
    } finally {
      setBusy(false);
    }
  };

  if (!status)
    return (
      <Card title="Cafe24 연동">
        {loadError ? (
          <Notice tone="error" action={{ label: "다시 시도", onClick: load }}>
            {loadError}
          </Notice>
        ) : (
          <p className="text-sm text-ink-3">상태 확인 중…</p>
        )}
      </Card>
    );
  const has = (m: "live" | "test") => Boolean(tag?.tags.some((t) => t.mode === m));
  const legacy = Boolean(tag?.tags.some((t) => t.mode === "legacy"));
  const skinNo = tag?.testSkinNo ?? TEST_SKIN_NO;

  return (
    <Card title="Cafe24 연동" hint="주문 조회와 쇼핑몰 위젯 설치에 쓰여요.">
      <div className="flex flex-col gap-3">
        {loadError && (
          <Notice tone="error" action={{ label: "다시 시도", onClick: load }}>
            {loadError}
          </Notice>
        )}

        {status.configured === false && (
          <Notice tone="info">
            아직 Cafe24 앱 정보가 없어요. 서버 환경변수에 CAFE24_MALL_ID · CAFE24_CLIENT_ID · CAFE24_CLIENT_SECRET · CAFE24_SERVICE_KEY 를 넣고 다시
            시작하면 여기서 연결할 수 있어요. 순서는 저장소의 docs/cafe24-app.md 를 보세요.
          </Notice>
        )}

        {status.configured !== false && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-panel-3 px-4 py-3 text-sm edge">
          <span
            className={cn("size-2 rounded-full", status.connected ? "bg-ok shadow-[0_0_8px_var(--cs-ok)]" : "bg-ink-3")}
          />
          <span>
            <span className="font-mono">{status.mallId}</span>
            <span className="text-muted-foreground"> · {status.connected ? "연결됨" : "연결 안 됨"}</span>
          </span>
          {status.connected && status.refreshExpiresAt && (
            <span className="text-xs text-ink-3">
              유지 기한 <span className="num">{new Date(status.refreshExpiresAt).toLocaleDateString("ko-KR")}</span> ·
              사용 중 자동 연장
            </span>
          )}
          {isAdmin && (
            <a
              href="/api/cafe24/install"
              className={cn(
                "ml-auto rounded-xl",
                buttonVariants({
                  variant: status.connected ? "outline" : "default",
                  size: "sm",
                }),
              )}
            >
              {status.connected ? "다시 연결" : "Cafe24 연결"}
            </a>
          )}
        </div>
        )}
        {status.missingScopes && status.missingScopes.length > 0 && (
          <Notice tone="warning" size="sm">
            빠진 권한: <span className="font-mono">{status.missingScopes.join(", ")}</span> — 개발자센터에서 권한을
            추가한 뒤 다시 연결해주세요.
          </Notice>
        )}

        {status.connected && (
          <>
            {legacy && (
              <Notice tone="warning" size="sm">
                예전 ‘테스트 모드’ 스크립트가 남아 있어요. 아래에서 설치를 한 번 누르면 정리돼요.
              </Notice>
            )}
            <div className="rounded-2xl bg-panel-3 px-4 py-3 text-xs leading-relaxed text-ink-3 edge">
              <p className="mb-1 text-sm font-semibold text-foreground">전체 공개와 테스트</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>
                  <b className="text-foreground">전체 공개</b>는 모든 스킨에 설치돼요. 검증이 끝난 기능만 보여요.
                </li>
                <li>
                  <b className="text-foreground">테스트</b>는 skin{skinNo} 에만 설치돼요. 미공개 기능이 켜지고,{" "}
                  <span className="font-mono">{SHOP_HOST}/skin-skin{skinNo}</span> 로 접속한 화면에서만 보여요.
                </li>
                <li>
                  두 위젯은 따로 설치·제거해요. 테스트 화면에서는 전체 공개 위젯이 대신 숨어서 버튼이 겹치지 않아요.
                </li>
                <li>테스트 화면에서 남긴 문의도 실제 인박스에 쌓여요. 상담원이 헷갈리지 않게 미리 알려주세요.</li>
                <li>
                  기능은 코드의 기능 목록(src/lib/features.ts)에서 test 로 두면 테스트에서만 켜지고, live 로 바꾸면 전체
                  공개돼요.
                </li>
              </ul>
            </div>
            <ScriptRow
              title="전체 공개"
              hint="모든 스킨 · 검증된 기능만"
              installed={has("live")}
              ready={Boolean(tag)}
              isAdmin={isAdmin}
              busy={busy}
              onInstall={() => {
                if (confirm("모든 쇼핑몰 방문자에게 상담 버튼이 보이게 됩니다. 진행할까요?")) scripttag("POST", "live");
              }}
              onRemove={() => scripttag("DELETE", "live")}
            />
            <ScriptRow
              title={`테스트 (skin${skinNo})`}
              hint="미공개 기능 포함 · 이 스킨에서만"
              installed={has("test")}
              ready={Boolean(tag)}
              isAdmin={isAdmin}
              busy={busy}
              link={{
                href: `https://${status.mallId}.cafe24.com/skin-skin${skinNo}/`,
                label: "테스트 화면 열기",
              }}
              onInstall={() => scripttag("POST", "test")}
              onRemove={() => scripttag("DELETE", "test")}
            />
            <TestShop skinNo={skinNo} />
          </>
        )}
      </div>
    </Card>
  );
}

function ScriptRow({
  title,
  hint,
  installed,
  ready,
  isAdmin,
  busy,
  link,
  onInstall,
  onRemove,
}: {
  title: string;
  hint: string;
  installed: boolean;
  ready: boolean;
  isAdmin: boolean;
  busy: boolean;
  link?: { href: string; label: string };
  onInstall: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-panel-3 px-4 py-3 text-sm edge">
      <span className="mr-auto">
        <span className="text-muted-foreground">쇼핑몰 위젯 · {title} · </span>
        <b className="font-semibold">{!ready ? "확인 중" : installed ? "설치됨" : "설치 안 됨"}</b>
        <span className="block text-xs text-ink-3">{hint}</span>
      </span>
      {isAdmin && (
        <>
          {installed && link && (
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer noopener"
              className={cn("rounded-xl", buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {link.label}
            </a>
          )}
          <Button size="sm" className="rounded-xl" disabled={busy || !ready || installed} onClick={onInstall}>
            설치
          </Button>
          {installed && (
            <Button size="sm" variant="ghost" className="text-ink-3" disabled={busy} onClick={onRemove}>
              제거
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// 테스트용 쇼핑몰 주소. 설치 상태와 관계없이 항상 보여준다 (주소는 바뀌지 않는다).
function TestShop({ skinNo }: { skinNo: number }) {
  const url = testShopUrl(skinNo);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-signal-soft px-4 py-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto flex min-w-0 flex-col gap-0.5">
          <b className="font-semibold">테스트 쇼핑몰</b>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="truncate font-mono text-xs text-signal-text hover:underline"
          >
            {url}
          </a>
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-xl text-muted-foreground"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "복사됨" : "주소 복사"}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className={cn("rounded-xl", buttonVariants({ size: "sm" }))}
        >
          테스트 쇼핑몰 열기
          <ExternalLink />
        </a>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        이 주소로 접속한 화면에서만 테스트 위젯이 보여요. 다른 상품 페이지는 주소의 도메인 뒤에 /skin-skin{skinNo} 를
        붙여 열어보세요.
      </p>
    </div>
  );
}
