"use client";

import { ImageUp, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ProfileAvatar, PublicProfileProvider, type PublicProfile } from "@/components/chat/public-profile";
import { Card } from "@/components/inbox/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { api, type ChatMessage } from "@/lib/client/api";
import { toAvatarDataUrl } from "@/lib/client/avatar-image";
import { Field } from "./field";
import { SUPPORT_NAME } from "@/lib/brand";

const NAME_MAX = 30;

const sample = (id: string, sender: ChatMessage["sender_type"], body: string, ai = false): ChatMessage => ({
  id,
  seq: 0,
  sender_type: sender,
  agent_name: null,
  body,
  ai_kind: ai ? "auto_sent" : null,
  client_message_id: null,
  created_at: new Date().toISOString(),
});
const PREVIEW = [
  sample("p1", "customer", "주문한 니트 언제 받을 수 있나요?"),
  sample("p2", "ai", "결제 완료 후 영업일 기준 1–3일 안에 출고돼요.", true),
  sample("p3", "agent", "확인해보니 오늘 출고됐어요. 내일 도착 예정이에요!"),
];

export function ProfileSettings({ isAdmin }: { isAdmin: boolean }) {
  const [saved, setSaved] = useState<PublicProfile | null>(null);
  const [name, setName] = useState("");
  // undefined = 그대로, null = 기본 마크로, string = 새로 올린 이미지(data URL)
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<PublicProfile>("/api/inbox/profile")
      .then((p) => (setSaved(p), setName(p.name)))
      .catch((err) => toast.error("고객 노출 정보를 불러오지 못했어요.", err));
  }, []);

  if (!saved) return <Card title="답변 이름 · 로고"><p className="text-sm text-ink-3">불러오는 중…</p></Card>;

  const draft: PublicProfile = {
    name: name.trim() || saved.name,
    avatarUrl: avatar === undefined ? saved.avatarUrl : avatar,
  };
  const dirty = name.trim() !== saved.name || avatar !== undefined;

  return (
    <Card
      title="답변 이름 · 로고"
      hint="고객에게 나가는 모든 답변(상담원 답변·AI 답변·답변 메일)이 이 이름과 로고 하나로 보여요."
    >
      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <fieldset disabled={!isAdmin || busy} className="flex min-w-0 flex-col gap-5">
          <Field label="로고" hint="정사각형 PNG·JPG·WEBP · 256px 로 줄여 저장돼요">
            <div className="flex items-center gap-4">
              <ProfileAvatar size="lg" profile={draft} />
              <div className="flex flex-col items-start gap-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  aria-label="로고 이미지 선택"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      setAvatar(await toAvatarDataUrl(file));
                    } catch {
                      toast.error("이미지를 읽지 못했어요.", undefined, {
                        description: "PNG·JPG·WEBP 파일인지 확인해주세요.",
                      });
                    }
                  }}
                />
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => fileRef.current?.click()}>
                  <ImageUp className="size-3.5" />
                  {draft.avatarUrl ? "로고 바꾸기" : "로고 올리기"}
                </Button>
                {draft.avatarUrl && (
                  <Button variant="ghost" size="sm" className="text-ink-3" onClick={() => setAvatar(null)}>
                    <RotateCcw className="size-3.5" />
                    기본 마크로
                  </Button>
                )}
              </div>
            </div>
          </Field>
          <Field label="답변 이름" hint={`${name.length}/${NAME_MAX}`}>
            <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={SUPPORT_NAME} />
          </Field>
          <Notice tone="info" size="sm">
            상담원 이름은 고객에게 보이지 않아요. 인박스에서 누가 답했는지만 표시돼요. AI 답변에는 이름 옆에 작은
            &lsquo;AI 답변&rsquo; 표시가 붙어요.
          </Notice>
          {isAdmin && (
            <div className="flex gap-2">
              <Button
                className="rounded-xl px-4"
                disabled={!dirty || !name.trim() || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const p = await api<PublicProfile>("/api/inbox/profile", {
                      method: "PUT",
                      body: JSON.stringify({ name: name.trim(), ...(avatar !== undefined ? { avatar } : {}) }),
                    });
                    setSaved(p);
                    setName(p.name);
                    setAvatar(undefined);
                    toast.success("답변 이름·로고를 저장했어요.", { description: "새로 여는 위젯부터 바로 적용돼요." });
                  } catch (err) {
                    toast.error("답변 이름·로고를 저장하지 못했어요.", err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                저장
              </Button>
              {dirty && (
                <Button
                  variant="ghost"
                  className="rounded-xl text-ink-3"
                  onClick={() => (setName(saved.name), setAvatar(undefined))}
                >
                  되돌리기
                </Button>
              )}
            </div>
          )}
        </fieldset>

        {/* 실제 위젯 말풍선 컴포넌트로 그린 미리보기 */}
        <figure className="flex flex-col gap-2">
          <figcaption className="text-xs font-semibold text-muted-foreground">고객 화면 미리보기</figcaption>
          <div className="overflow-hidden rounded-[20px] bg-card edge">
            <PublicProfileProvider value={draft}>
              <div className="flex h-12 items-center gap-1.5 border-b px-4">
                <ProfileAvatar size="sm" />
                <span className="ml-0.5 truncate text-xs text-ink-3">{draft.name}</span>
              </div>
              <div className="pointer-events-none py-3">
                {PREVIEW.map((m) => (
                  <MessageBubble key={m.id} message={m} viewer="customer" />
                ))}
              </div>
            </PublicProfileProvider>
          </div>
        </figure>
      </div>
    </Card>
  );
}

// 위젯 첫 인사 · 답변 기한 안내
export function MessagesSettings({ isAdmin }: { isAdmin: boolean }) {
  const [greeting, setGreeting] = useState<string | null>(null);
  const [replySla, setReplySla] = useState("");

  useEffect(() => {
    api<{ greeting: string; replySla: string }>("/api/inbox/settings")
      .then((s) => (setGreeting(s.greeting ?? ""), setReplySla(s.replySla ?? "")))
      .catch((err) => toast.error("안내 문구를 불러오지 못했어요.", err));
  }, []);

  if (greeting === null) return null;
  return (
    <Card title="안내 문구" hint={isAdmin ? "위젯에서 고객이 처음 보는 문구예요." : "관리자만 수정할 수 있어요."}>
      <fieldset disabled={!isAdmin} className="flex flex-col gap-5">
        <Field label="첫 인사" hint="위젯 홈 상단에 보여요.">
          <Textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} />
        </Field>
        <Field label="답변 기한 안내" hint="문의 접수 시 고객에게 표시돼요.">
          <Input value={replySla} onChange={(e) => setReplySla(e.target.value)} placeholder="영업일 기준 24시간 이내" />
        </Field>
        {isAdmin && (
          <Button
            className="self-start rounded-xl px-4"
            disabled={!greeting.trim() || !replySla.trim()}
            onClick={async () => {
              try {
                await api("/api/inbox/settings", { method: "PUT", body: JSON.stringify({ greeting, replySla }) });
                toast.success("안내 문구를 저장했어요.");
              } catch (err) {
                toast.error("안내 문구를 저장하지 못했어요.", err);
              }
            }}
          >
            저장
          </Button>
        )}
      </fieldset>
    </Card>
  );
}
