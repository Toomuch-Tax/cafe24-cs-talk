import { createHash } from "node:crypto";
import { sql } from "./db";
import { HttpError } from "./http";

// 상담원 프로필 사진. 인박스 안에서만 쓰고 고객용 API·메일·슬랙에는 붙이지 않는다.
// 처음엔 DB 가 랜덤 이모지를 넣고(0013_agent_avatars.sql), 본인이나 관리자가 이모지·사진·구글 사진으로 바꾼다.
export const AGENT_AVATAR_MAX_BYTES = 100 * 1024;

export type AvatarMode = "emoji" | "image" | "google";

// select 에 넣는 열: avatar_url = 지금 보여줄 사진 주소(없으면 이모지), avatar_emoji
// agents 원래 avatar_url 열은 구글 사진 원본이라 google_picture 로 따로 내보낸다.
// prefix 를 주면 열 이름 앞에 붙인다 (assigned_agent_avatar_url 등).
export const avatarColumns = (t = "agents", prefix = "") => {
  const a = sql(t);
  return sql`
    case ${a}.avatar_mode
      when 'image' then '/api/inbox/users/' || ${a}.id || '/avatar?v=' || ${a}.avatar_v
      when 'google' then ${a}.avatar_url
    end as ${sql(`${prefix}avatar_url`)},
    ${a}.avatar_emoji as ${sql(`${prefix}avatar_emoji`)}`;
};

export type AvatarInput = { emoji: string } | { image: string } | { google: true };

export async function saveAgentAvatar(agentId: string, input: AvatarInput) {
  if ("emoji" in input) {
    await sql`update agents set avatar_mode = 'emoji', avatar_emoji = ${input.emoji},
      avatar_image = null, avatar_image_type = null, avatar_v = null where id = ${agentId}`;
  } else if ("image" in input) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.image);
    if (!m) throw new HttpError(400, "invalid_image");
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length === 0 || bytes.length > AGENT_AVATAR_MAX_BYTES) throw new HttpError(400, "image_too_large");
    const v = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    await sql`update agents set avatar_mode = 'image', avatar_image = ${bytes}, avatar_image_type = ${m[1]},
      avatar_v = ${v} where id = ${agentId}`;
  } else {
    const [row] = await sql`select 1 from agents where id = ${agentId} and avatar_url is not null`;
    if (!row) throw new HttpError(409, "no_google_picture");
    await sql`update agents set avatar_mode = 'google', avatar_image = null, avatar_image_type = null,
      avatar_v = null where id = ${agentId}`;
  }
}

export async function getAgentAvatarImage(agentId: string) {
  const [row] = await sql<{ avatar_image: Buffer; avatar_image_type: string; avatar_v: string }[]>`
    select avatar_image, avatar_image_type, avatar_v from agents
    where id = ${agentId} and avatar_mode = 'image' and avatar_image is not null`;
  return row ?? null;
}
