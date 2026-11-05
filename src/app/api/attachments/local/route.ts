import { handle, HttpError } from "@/lib/http";
import { MAX_VIDEO_BYTES, readLocal, verifyLocalSignature, writeLocal } from "@/lib/storage";

// 로컬 개발 전용: .data/uploads 의 첨부를 서명 URL 로만 열어준다(GET), 동영상은 서명 업로드 URL 로 받는다(PUT).
// 운영(Supabase 사용)에서는 항상 404.
const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
const KEY_RE = /^c\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|mp4|mov|webm)$/;

export const GET = handle(async (request: Request) => {
  const q = new URL(request.url).searchParams;
  const key = q.get("k") ?? "";
  if (!KEY_RE.test(key)) throw new HttpError(404, "not_found");
  if (!verifyLocalSignature(key, Number(q.get("e")), q.get("s") ?? "")) throw new HttpError(404, "not_found");
  const data = await readLocal(key).catch(() => null);
  if (!data) throw new HttpError(404, "not_found");
  const headers = {
    "content-type": TYPES[key.split(".").pop()!],
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };
  // 동영상 재생(특히 Safari)은 Range 요청을 보낸다
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = data.byteLength;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    return new Response(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}` },
    });
  }
  return new Response(new Uint8Array(data), { headers });
});

export const PUT = handle(async (request: Request) => {
  const q = new URL(request.url).searchParams;
  const key = q.get("k") ?? "";
  if (!KEY_RE.test(key) || !TYPES[key.split(".").pop()!].startsWith("video/")) throw new HttpError(404, "not_found");
  if (!verifyLocalSignature(key, Number(q.get("e")), q.get("s") ?? "", "put")) throw new HttpError(404, "not_found");
  const data = new Uint8Array(await request.arrayBuffer());
  if (data.byteLength === 0 || data.byteLength > MAX_VIDEO_BYTES) throw new HttpError(413, "file_too_large");
  await writeLocal(key, data);
  return new Response(null, { status: 200 });
});
