"use client";

import { Dices, ImageUp } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { AGENT_EMOJIS } from "@/lib/agent-emojis";
import { api } from "@/lib/client/api";
import { toAvatarDataUrl } from "@/lib/client/avatar-image";
import { cn } from "@/lib/utils";

// 상담원 프로필 사진(인박스 안에서만 보임). 사진이 있으면 사진, 없으면 이모지, 그것도 없으면 이름 첫 글자.
export type AvatarLike = { name: string; avatar_url?: string | null; avatar_emoji?: string | null };

export function AgentAvatar({
  agent,
  size = 32,
  className,
  title,
}: {
  agent: AvatarLike;
  size?: number;
  className?: string;
  title?: string;
}) {
  const style = { width: size, height: size };
  if (agent.avatar_url)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 작은 프로필 사진 (구글 사진은 외부 주소)
      <img
        src={agent.avatar_url}
        alt=""
        title={title}
        referrerPolicy="no-referrer"
        style={style}
        className={cn("shrink-0 rounded-full bg-panel-3 object-cover edge", className)}
      />
    );
  return (
    <span
      title={title}
      aria-hidden={!title}
      style={{ ...style, fontSize: Math.round(size * (agent.avatar_emoji ? 0.55 : 0.38)) }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-panel-3 leading-none font-semibold text-muted-foreground select-none",
        className,
      )}
    >
      {agent.avatar_emoji || agent.name.slice(0, 1)}
    </span>
  );
}

export type EditableAvatar = AvatarLike & {
  id: string;
  avatar_mode: "emoji" | "image" | "google";
  google_picture: string | null;
};

const pick = (list: readonly string[], not?: string | null) => {
  const rest = list.filter((x) => x !== not);
  return rest[Math.floor(Math.random() * rest.length)];
};

// 이모지 고르기 · 랜덤 · 사진 올리기(160px 로 줄여 저장) · 구글 사진. 누르면 바로 저장된다.
export function AgentAvatarEditor({
  agent,
  onSaved,
}: {
  agent: EditableAvatar;
  onSaved?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // 고른 것을 바로 보여주고, 저장 후 새 정보(props)가 내려오면 그쪽으로 넘어간다
  const current = `${agent.avatar_url}|${agent.avatar_emoji}`;
  const [preview, setPreview] = useState<{ from: string; avatar: AvatarLike } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = preview?.from === current ? preview.avatar : agent;
  const emojiMode = !shown.avatar_url;

  const save = async (body: object, next: AvatarLike, done: string) => {
    setBusy(true);
    setPreview({ from: current, avatar: next });
    try {
      await api(`/api/inbox/users/${agent.id}/avatar`, { method: "PUT", body: JSON.stringify(body) });
      window.dispatchEvent(new Event("cstalk:agent-updated"));
      await onSaved?.();
      toast.success(done);
    } catch (err) {
      setPreview(null);
      toast.error("프로필 사진을 바꾸지 못했어요.", err);
    } finally {
      setBusy(false);
    }
  };
  const setEmoji = (emoji: string) =>
    save({ emoji }, { name: agent.name, avatar_url: null, avatar_emoji: emoji }, "프로필 이모지를 바꿨어요.");

  return (
    <fieldset disabled={busy} className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <AgentAvatar agent={shown} size={64} className={cn("transition-opacity", busy && "opacity-60")} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => setEmoji(pick(AGENT_EMOJIS, emojiMode ? shown.avatar_emoji : null))}
          >
            <Dices className="size-3.5" />
            랜덤 이모지
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="프로필 사진 선택"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              let image: string;
              try {
                image = await toAvatarDataUrl(file, 160, 0.85);
              } catch {
                toast.error("이미지를 읽지 못했어요.", undefined, { description: "PNG·JPG·WEBP 파일인지 확인해주세요." });
                return;
              }
              await save({ image }, { name: agent.name, avatar_url: image }, "프로필 사진을 올렸어요.");
            }}
          />
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => fileRef.current?.click()}>
            <ImageUp className="size-3.5" />
            사진 올리기
          </Button>
          {agent.google_picture && agent.avatar_mode !== "google" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-ink-3"
              onClick={() =>
                save({ google: true }, { name: agent.name, avatar_url: agent.google_picture }, "구글 프로필 사진으로 바꿨어요.")
              }
            >
              구글 사진 쓰기
            </Button>
          )}
        </div>
      </div>
      <div role="radiogroup" aria-label="프로필 이모지" className="grid max-w-md grid-cols-8 gap-1 sm:grid-cols-10">
        {AGENT_EMOJIS.map((e) => {
          const on = emojiMode && shown.avatar_emoji === e;
          return (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={e}
              onClick={() => !on && setEmoji(e)}
              className={cn(
                "grid aspect-square place-items-center rounded-xl text-[20px] leading-none transition-[background-color,transform] hover:bg-panel-3 active:scale-90 disabled:opacity-50",
                on && "bg-panel-3 edge",
              )}
            >
              {e}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-3">사진은 정사각형으로 잘라 160px 로 줄여 저장돼요 (PNG·JPG·WEBP).</p>
    </fieldset>
  );
}
