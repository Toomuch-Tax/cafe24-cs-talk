import { createHash } from "node:crypto";
import { getSetting, setSetting } from "./settings";
import { SUPPORT_NAME } from "./brand";

// 고객에게 보이는 답변 주체. 상담원 답변·AI 답변·이메일 모두 같은 이름과 로고로 나간다 (상담원 실명은 고객에게 보내지 않음).
// 로고는 작은 이미지(브라우저에서 256px 로 줄여 올림)라 settings 에 그대로 두고 /api/brand/avatar 로 내려준다.
export const DEFAULT_PROFILE_NAME = SUPPORT_NAME;
export const AVATAR_MAX_BYTES = 300 * 1024;
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type PublicProfile = { name: string; avatarUrl: string | null };
type StoredAvatar = { type: (typeof AVATAR_TYPES)[number]; data: string; v: string };

export async function getPublicProfile(): Promise<PublicProfile> {
  const [profile, avatar] = await Promise.all([
    getSetting<{ name?: string }>("public_profile"),
    getSetting<StoredAvatar>("public_avatar"),
  ]);
  return {
    name: profile?.name?.trim() || DEFAULT_PROFILE_NAME,
    avatarUrl: avatar ? `/api/brand/avatar?v=${avatar.v}` : null,
  };
}

export const getStoredAvatar = () => getSetting<StoredAvatar>("public_avatar");

export async function savePublicProfile(input: { name: string; avatar?: string | null }) {
  await setSetting("public_profile", { name: input.name.trim() });
  if (input.avatar === null) {
    await setSetting("public_avatar", null);
  } else if (input.avatar) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.avatar);
    if (!m) return { error: "invalid_image" as const };
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) return { error: "image_too_large" as const };
    const v = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    await setSetting("public_avatar", { type: m[1] as StoredAvatar["type"], data: m[2], v } satisfies StoredAvatar);
  }
  return { error: null };
}
