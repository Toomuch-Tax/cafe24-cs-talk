import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureError } from "./errors";

// 첨부 파일 저장소. 운영은 Supabase Storage 비공개 버킷(서버 전용 키로만 접근, 열람은 짧은 서명 URL),
// 로컬 개발은 .data/uploads 디렉터리(서명 URL 은 /api/attachments/local 이 확인)로 대신한다.
// 위젯은 Bearer 토큰을 쓰고 iframe 이라 쿠키가 없으므로, <img> 로 열 수 있게 URL 자체에 서명을 담는다.

const BUCKET = process.env.ATTACHMENTS_BUCKET ?? "attachments";
export const SIGNED_URL_TTL = 60 * 60; // 1시간. 화면을 오래 열어 두면 다음 불러오기에서 새 URL 을 받는다.
export const MAX_BYTES = 5 * 1024 * 1024;
// 동영상은 서버를 거치지 않고 저장소에 바로 올린다 (Vercel 함수 요청 4.5MB 제한). 50MB 는 Supabase 무료 플랜의 파일 상한이기도 하다.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const ALLOWED_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export type VideoType = (typeof VIDEO_TYPES)[number];
export type MediaType = (typeof ALLOWED_TYPES)[number];
export const isVideoType = (t: string): t is VideoType => (VIDEO_TYPES as readonly string[]).includes(t);

const supabase = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
};

type Driver = "supabase" | "local" | null;
export const storageDriver = (): Driver =>
  supabase() ? "supabase" : process.env.NODE_ENV !== "production" ? "local" : null;

// ---- Supabase Storage (REST) ------------------------------------------------

async function sb(pathname: string, init: RequestInit & { json?: unknown } = {}) {
  const cfg = supabase()!;
  const { json, ...rest } = init;
  return fetch(`${cfg.url}/storage/v1${pathname}`, {
    ...rest,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
}

// 버킷이 없으면 비공개로 만든다 (첫 업로드 때 한 번). 크기·형식 제한은 저장소 쪽에도 건다.
// 이미 있으면 제한을 지금 값으로 맞춘다 (사진 전용 5MB 로 만들어진 버킷에 동영상이 올라가도록).
let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const config = { public: false, file_size_limit: MAX_VIDEO_BYTES, allowed_mime_types: ALLOWED_TYPES };
  const res = await sb("/bucket", { method: "POST", json: { id: BUCKET, name: BUCKET, ...config } });
  if (!res.ok) {
    if (res.status !== 409 && !(await res.text()).includes("already exists")) {
      throw new Error(`storage bucket create failed: ${res.status}`);
    }
    const upd = await sb(`/bucket/${BUCKET}`, { method: "PUT", json: config });
    if (!upd.ok) throw new Error(`storage bucket update failed: ${upd.status}`);
  }
  bucketReady = true;
}

// ---- 로컬 개발용 -------------------------------------------------------------

const LOCAL_DIR = path.join(process.cwd(), ".data", "uploads");
const localPath = (key: string) => {
  const p = path.join(LOCAL_DIR, key);
  if (!p.startsWith(LOCAL_DIR + path.sep)) throw new Error("bad key");
  return p;
};
// mode: 열람(get)·업로드(put) 서명을 구분한다 (열람 URL 로 덮어쓰지 못하게)
const localSig = (key: string, exp: number, mode: "get" | "put" = "get") =>
  createHmac("sha256", `local-attachments:${process.env.WIDGET_TOKEN_SECRET ?? ""}`)
    .update(mode === "get" ? `${key}:${exp}` : `put:${key}:${exp}`)
    .digest("base64url");

export function verifyLocalSignature(key: string, exp: number, sig: string, mode: "get" | "put" = "get") {
  if (storageDriver() !== "local" || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const a = Buffer.from(localSig(key, exp, mode));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const readLocal = (key: string) => readFile(localPath(key));
export async function writeLocal(key: string, data: Uint8Array) {
  await mkdir(path.dirname(localPath(key)), { recursive: true });
  await writeFile(localPath(key), data);
}

// ---- 공용 --------------------------------------------------------------------

export async function putObject(key: string, data: Uint8Array, contentType: ImageType) {
  const driver = storageDriver();
  if (driver === "local") return writeLocal(key, data);
  if (driver !== "supabase") throw new Error("storage not configured");
  await ensureBucket();
  const res = await sb(`/object/${BUCKET}/${key}`, {
    method: "POST",
    headers: { "content-type": contentType, "x-upsert": "false", "cache-control": "private, max-age=3600" },
    body: Buffer.from(data),
  });
  if (!res.ok) throw new Error(`storage upload failed: ${res.status}`);
}

// 브라우저가 저장소에 바로 PUT 할 수 있는 1회용 업로드 URL (동영상용, 2시간 유효).
// 크기·형식 상한은 버킷 설정이 막고, 올라온 뒤 inspectObject 로 다시 확인한다.
export async function signUploadUrl(key: string): Promise<string> {
  const driver = storageDriver();
  if (driver === "local") {
    const exp = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
    return `/api/attachments/local?${new URLSearchParams({ k: key, e: String(exp), s: localSig(key, exp, "put") })}`;
  }
  if (driver !== "supabase") throw new Error("storage not configured");
  await ensureBucket();
  const res = await sb(`/object/upload/sign/${BUCKET}/${key}`, { method: "POST", json: {} });
  if (!res.ok) throw new Error(`storage upload sign failed: ${res.status}`);
  const { url } = (await res.json()) as { url: string };
  return `${supabase()!.url}/storage/v1${url}`;
}

// 올라온 파일의 실제 크기와 앞부분(형식 판별용). 없으면 null.
export async function inspectObject(key: string): Promise<{ size: number; head: Uint8Array } | null> {
  const driver = storageDriver();
  if (driver === "local") {
    const data = await readLocal(key).catch(() => null);
    return data ? { size: data.byteLength, head: new Uint8Array(data.subarray(0, 64)) } : null;
  }
  if (driver !== "supabase") return null;
  const res = await sb(`/object/authenticated/${BUCKET}/${key}`, { headers: { range: "bytes=0-63" } });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`storage inspect failed: ${res.status}`);
  const head = new Uint8Array(await res.arrayBuffer()).subarray(0, 64);
  // 206 이면 content-range 의 전체 크기, 아니면(파일이 64바이트 이하 등) 받은 크기
  const total = Number(res.headers.get("content-range")?.split("/")[1]);
  return { size: Number.isFinite(total) && total > 0 ? total : head.byteLength, head };
}

// 여러 파일의 열람 URL 을 한 번에 만든다 (Supabase 는 요청 1번)
export async function signUrls(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length) return out;
  const driver = storageDriver();
  if (driver === "local") {
    const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL;
    for (const k of keys) {
      out.set(k, `/api/attachments/local?${new URLSearchParams({ k, e: String(exp), s: localSig(k, exp) })}`);
    }
    return out;
  }
  if (driver !== "supabase") return out;
  const res = await sb(`/object/sign/${BUCKET}`, { method: "POST", json: { expiresIn: SIGNED_URL_TTL, paths: keys } });
  if (!res.ok) {
    captureError({ source: "external", where: "storage sign", area: "other", err: new Error(`storage sign ${res.status}`), status: res.status });
    return out;
  }
  const rows = (await res.json()) as { path: string | null; signedURL: string | null }[];
  const base = `${supabase()!.url}/storage/v1`;
  for (const r of rows) if (r.path && r.signedURL) out.set(r.path, `${base}${r.signedURL}`);
  return out;
}

export async function removeObjects(keys: string[]) {
  if (!keys.length) return;
  const driver = storageDriver();
  if (driver === "local") {
    await Promise.all(keys.map((k) => rm(localPath(k), { force: true })));
    return;
  }
  if (driver !== "supabase") return;
  const res = await sb(`/object/${BUCKET}`, { method: "DELETE", json: { prefixes: keys } });
  if (!res.ok) throw new Error(`storage delete failed: ${res.status}`);
}
