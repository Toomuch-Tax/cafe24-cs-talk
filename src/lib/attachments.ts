import type postgres from "postgres";
import { sql } from "./db";
import { HttpError } from "./http";
import {
  type ImageType,
  inspectObject,
  isVideoType,
  MAX_BYTES,
  MAX_VIDEO_BYTES,
  type MediaType,
  putObject,
  removeObjects,
  signUploadUrl,
  signUrls,
  storageDriver,
  type VideoType,
} from "./storage";

// 사진·동영상 첨부 (고객 문의·상담원 답변 공용). 메시지 1개에 최대 4개, 그중 동영상은 1개.
// 사진은 장당 5MB(JPEG·PNG·WebP·HEIC, 서버 경유), 동영상은 50MB(MP4·MOV·WebM, 저장소에 바로 업로드).
export const MAX_PER_MESSAGE = 4;
export const MAX_VIDEOS_PER_MESSAGE = 1;

// messages.attachments 에 저장하는 형태. key 는 서버 전용(고객·상담원 응답에는 url 로 바꿔 내려준다).
export type StoredAttachment = { id: string; key: string; type: MediaType; size: number };
export type Attachment = { id: string; type: MediaType; size: number; url: string | null };

export const attachmentsAvailable = () => storageDriver() !== null;

// 확장자·브라우저가 알려준 형식은 믿지 않고 파일 앞부분으로 판별한다 (SVG·HTML 등은 여기서 걸러짐)
export function sniffImage(b: Uint8Array): ImageType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) return "image/heic";
  return null;
}

// 동영상 컨테이너 판별: MP4·MOV 는 ftyp 상자(HEIC 브랜드 제외), WebM 은 EBML 머리
export function sniffVideo(b: Uint8Array): VideoType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (ascii(4, 8) !== "ftyp") return null;
  const brand = ascii(8, 12);
  if (brand === "qt  ") return "video/quicktime";
  if (/^(isom|iso[2-9]|mp41|mp42|avc1|M4V |M4VH|M4VP|3gp[4-6]|3g2a|dash|mmp4|MSNV|hvc1|f4v )$/.test(brand)) return "video/mp4";
  return null;
}

const EXT: Record<MediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

// agentId 가 있으면 상담원이 그 고객 문의에 답하려고 올린 사진 (고객은 붙일 수 없다)
export async function saveUpload(contactId: string, data: Uint8Array, agentId: string | null = null) {
  if (data.byteLength === 0 || data.byteLength > MAX_BYTES) throw new HttpError(413, "file_too_large");
  const type = sniffImage(data);
  if (!type) throw new HttpError(415, "unsupported_type");
  await checkPending(contactId, agentId);

  const id = crypto.randomUUID();
  const key = `c/${contactId}/${id}.${EXT[type]}`;
  await putObject(key, data, type);
  await sql`insert into uploads (id, contact_id, agent_id, storage_key, content_type, size_bytes)
    values (${id}, ${contactId}, ${agentId}, ${key}, ${type}, ${data.byteLength})`;
  return { id, type, size: data.byteLength };
}

// 동영상 1단계: 업로드 행(ready = false)을 만들고 저장소에 바로 올릴 URL 을 준다.
// 브라우저가 알려준 형식·크기는 여기선 상한 확인용이고, 2단계에서 실제 파일로 다시 본다.
export async function startVideoUpload(contactId: string, input: { type: string; size: number }, agentId: string | null = null) {
  const type = isVideoType(input.type) ? input.type : "video/mp4";
  if (!input.type.startsWith("video/")) throw new HttpError(415, "unsupported_type");
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_VIDEO_BYTES) {
    throw new HttpError(413, "file_too_large");
  }
  await checkPending(contactId, agentId, true);
  const id = crypto.randomUUID();
  const key = `c/${contactId}/${id}.${EXT[type]}`;
  const uploadUrl = await signUploadUrl(key);
  await sql`insert into uploads (id, contact_id, agent_id, storage_key, content_type, size_bytes, ready)
    values (${id}, ${contactId}, ${agentId}, ${key}, ${type}, ${input.size}, false)`;
  return { id, uploadUrl, contentType: type };
}

// 동영상 2단계: 저장소에 올라온 파일의 실제 크기·형식을 확인하고 ready 로 바꾼다. 아니면 파일째 지운다.
export async function finishVideoUpload(contactId: string, id: string, agentId: string | null = null) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "invalid_attachment");
  const [row] = await sql<{ storage_key: string; ready: boolean; content_type: MediaType; size_bytes: number }[]>`
    select storage_key, ready, content_type, size_bytes from uploads
    where id = ${id} and contact_id = ${contactId} and agent_id is not distinct from ${agentId} and message_id is null`;
  if (!row) throw new HttpError(404, "not_found");
  if (row.ready) return { id, type: row.content_type, size: row.size_bytes };
  const obj = await inspectObject(row.storage_key);
  if (!obj) throw new HttpError(409, "upload_incomplete");
  const type = sniffVideo(obj.head);
  if (!type || obj.size > MAX_VIDEO_BYTES) {
    await removeObjects([row.storage_key]).catch(() => {});
    await sql`delete from uploads where id = ${id}`;
    throw new HttpError(type ? 413 : 415, type ? "file_too_large" : "unsupported_type");
  }
  await sql`update uploads set ready = true, content_type = ${type}, size_bytes = ${obj.size} where id = ${id}`;
  return { id, type, size: obj.size };
}

// 연결 안 된 업로드가 쌓이지 않도록 (문의 1건 4개 기준으로 넉넉히, 동영상은 따로 더 좁게)
async function checkPending(contactId: string, agentId: string | null, video = false) {
  const [{ pending, videos }] = await sql<{ pending: number; videos: number }[]>`
    select count(*)::int as pending, (count(*) filter (where content_type like 'video/%'))::int as videos from uploads
    where contact_id = ${contactId} and agent_id is not distinct from ${agentId}
      and message_id is null and created_at > now() - interval '1 day'`;
  if (pending >= 12 || (video && videos >= 3)) throw new HttpError(429, "rate_limited");
}

// 메시지 저장 트랜잭션 안에서 호출: 이 고객(agentId 가 있으면 그 상담원)이 올렸고 아직 어디에도 붙지 않은 업로드만 연결한다.
export async function claimUploads(
  tx: postgres.TransactionSql,
  contactId: string,
  messageId: string,
  ids: string[],
  agentId: string | null = null,
): Promise<StoredAttachment[]> {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const rows = await tx<{ id: string; storage_key: string; content_type: MediaType; size_bytes: number }[]>`
    update uploads set message_id = ${messageId}
    where id = any(${unique}::uuid[]) and contact_id = ${contactId} and message_id is null
      and agent_id is not distinct from ${agentId} and ready
    returning id, storage_key, content_type, size_bytes`;
  if (rows.length !== unique.length) throw new HttpError(400, "invalid_attachment");
  if (rows.filter((r) => isVideoType(r.content_type)).length > MAX_VIDEOS_PER_MESSAGE) {
    throw new HttpError(400, "invalid_attachment");
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const list = unique.map((id) => {
    const r = byId.get(id)!;
    return { id, key: r.storage_key, type: r.content_type, size: r.size_bytes };
  });
  await tx`update messages set attachments = ${tx.json(list)} where id = ${messageId}`;
  return list;
}

// 응답 직전에 key 를 서명 URL 로 바꾼다. 첨부가 있는 메시지가 없으면 저장소를 부르지 않는다.
export async function withAttachmentUrls<T extends { attachments: unknown }>(rows: T[]) {
  const stored = (r: T) => (Array.isArray(r.attachments) ? (r.attachments as StoredAttachment[]) : []);
  const keys = rows.flatMap((r) => stored(r).map((a) => a.key));
  const urls = keys.length ? await signUrls(keys) : new Map<string, string>();
  return rows.map((r) => ({
    ...r,
    attachments: stored(r).map(({ id, key, type, size }): Attachment => ({
      id,
      type,
      size,
      url: urls.get(key) ?? null,
    })),
  }));
}

// "사진 2장 · 동영상 1개" (목록 미리보기·슬랙·메일 공용)
export const mediaLabel = (photos: number, videos: number) =>
  [photos ? `사진 ${photos}장` : "", videos ? `동영상 ${videos}개` : ""].filter(Boolean).join(" · ");
export const attachmentPreview = (list: { type: string }[]) => {
  const videos = list.filter((a) => isVideoType(a.type)).length;
  return mediaLabel(list.length - videos, videos);
};

// 크론: 메시지에 붙지 않은 채 하루가 지난 업로드(작성 중 이탈, 대화 삭제 등)를 파일과 함께 지운다
export async function cleanupOrphanUploads(limit = 100) {
  if (!attachmentsAvailable()) return 0;
  const rows = await sql<{ id: string; storage_key: string }[]>`
    select id, storage_key from uploads
    where message_id is null and created_at < now() - interval '1 day'
    order by created_at limit ${limit}`;
  if (!rows.length) return 0;
  await removeObjects(rows.map((r) => r.storage_key));
  await sql`delete from uploads where id = any(${rows.map((r) => r.id)}::uuid[])`;
  return rows.length;
}
