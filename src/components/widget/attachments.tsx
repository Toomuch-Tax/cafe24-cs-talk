"use client";

import { ImagePlus, Loader2, Play, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MediaViewer } from "@/components/chat/message-bubble";
import { Notice } from "@/components/ui/notice";
import { ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { canCompressVideo, compressVideo, MAX_VIDEO_MINUTES, type Trim, VideoTooLongError } from "./video-compress";
import { formatDuration, probeDuration, TRIM_FROM_SECONDS, TrimSheet } from "./video-trim";

// 사진·동영상 첨부 (고객 위젯·상담원 인박스 공용): 사진은 고르는 즉시 줄여서(긴 변 2048px JPEG, 위치정보 등 메타데이터 제거)
// 서버로 올리고, 동영상은 브라우저에서 720p 로 줄인 뒤(video-compress.ts) 저장소에 바로 올린다. 문의를 보낼 때는 업로드 id 만 넘긴다.
export const MAX_ATTACHMENTS = 4;
// 동영상은 메시지당 1개, 올라가는 파일은 50MB 까지 (저장소 비용·모바일 업로드 시간 때문에 서버도 같은 상한).
// 고르는 원본은 더 커도 되고 줄여서 50MB 안에 맞춘다. 줄일 수 없는 브라우저에서는 원본이 50MB 이하일 때만 올린다.
export const MAX_VIDEOS = 1;
export const MAX_VIDEO_MB = 50;
const RAW_VIDEO_MAX = 2 * 1024 * 1024 * 1024;
const MAX_DIM = 2048;
// 브라우저가 읽지 못해 원본 그대로 올리는 경우(예: 데스크톱 Chrome 의 HEIC)의 상한. 서버 상한은 5MB.
const RAW_MAX = 4 * 1024 * 1024;
// 동영상을 줄인 경우 전체 진행률 중 줄이기가 차지하는 몫 (나머지는 업로드)
const COMPRESS_SHARE = 0.5;

type Uploaded = { id: string; type: string; size: number };
export type Upload = (file: Blob, onProgress?: (ratio: number) => void) => Promise<Uploaded>;

export const isVideoFile = (f: { type: string; name?: string }) =>
  f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name ?? "");
const isImageFile = (f: File) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name);
const videoType = (f: File) =>
  f.type.startsWith("video/") ? f.type : /\.mov$/i.test(f.name) ? "video/quicktime" : /\.webm$/i.test(f.name) ? "video/webm" : "video/mp4";

async function prepareImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // 투명 PNG 가 JPEG 에서 검게 나오지 않도록
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (blob) return blob;
  } catch {}
  if (file.size > RAW_MAX) throw new ApiError(413, "file_too_large");
  return file;
}

async function postJson(url: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed");
  return data;
}

// 사진 1장: 서버로 multipart 업로드
async function postPhoto(url: string, file: Blob, headers: Record<string, string>) {
  const form = new FormData();
  form.append("file", file, "photo");
  const res = await fetch(url, { method: "POST", headers, body: form, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed");
  return data.attachment as Uploaded;
}

// 동영상 1개: 업로드 URL 받기 → 저장소에 바로 PUT(진행률 표시) → 서버가 올라온 파일 확인
async function putVideo(base: string, file: File, headers: Record<string, string>, onProgress?: (r: number) => void) {
  const type = videoType(file);
  const { id, uploadUrl, contentType } = await postJson(base, { type, size: file.size }, headers);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status === 413 ? 413 : xhr.status === 415 ? 415 : 502, "upload_failed"));
    xhr.onerror = () => reject(new ApiError(0, "network"));
    xhr.send(file);
  });
  return (await postJson(`${base}/complete`, { id }, headers)).attachment as Uploaded;
}

// 위젯 방문자 토큰으로 1개 업로드
export const widgetUpload =
  (token: string): Upload =>
  async (file, onProgress) => {
    const headers = { authorization: `Bearer ${token}` };
    return file instanceof File && isVideoFile(file)
      ? putVideo("/api/widget/attachments/video", file, headers, onProgress)
      : postPhoto("/api/widget/attachments", file, headers);
  };

// 인박스 상담원 세션(쿠키)으로 이 문의에 답할 사진·동영상 1개 업로드
export const inboxUpload =
  (conversationId: string): Upload =>
  async (file, onProgress) => {
    const base = `/api/inbox/conversations/${conversationId}/attachments`;
    return file instanceof File && isVideoFile(file)
      ? putVideo(`${base}/video`, file, {}, onProgress)
      : postPhoto(base, file, {});
  };

const errorText = (err: unknown, video: boolean) =>
  err instanceof VideoTooLongError
    ? `동영상이 너무 길어요. ${MAX_VIDEO_MINUTES}분 이내로 잘라서 올려주세요`
    : err instanceof ApiError && err.status === 413
    ? video
      ? `동영상이 너무 커요. ${MAX_VIDEO_MB}MB 이하로 잘라서 올려주세요`
      : "사진이 너무 커요 (장당 5MB까지)"
    : err instanceof ApiError && err.status === 415
      ? video
        ? "MP4·MOV 동영상만 올릴 수 있어요"
        : "사진 파일(JPG·PNG·HEIC)만 올릴 수 있어요"
      : err instanceof ApiError && err.status === 429
        ? "너무 많이 올렸어요. 잠시 후 다시 시도해주세요"
        : video
          ? "동영상을 올리지 못했어요"
          : "사진을 올리지 못했어요";

export type AttachmentItem = {
  localId: string;
  preview: string;
  status: "uploading" | "done" | "failed";
  video: boolean;
  // 동영상 진행률 0–1. 줄이기·올리기를 합친 하나의 값 ("올리는 중" 한 번으로 보인다)
  progress?: number;
  // 이미 줄인 파일이면 다시 올릴 때 또 줄이지 않는다
  compressed?: boolean;
  // 동영상: 보낼 부분(초)과 보낼 길이. 길이는 썸네일에 붙는다.
  trim?: Trim;
  duration?: number;
  id?: string;
  type?: string;
  size?: number;
  // 이미 올린 사진을 다시 채운 경우(보내기 전 되돌리기)에는 없다
  file?: File;
};

// 긴 동영상을 고른 뒤 보낼 부분을 고르기 전 (duration 은 길이를 읽는 동안 null)
export type PendingVideo = { file: File; preview: string; duration: number | null };

const newItem = (file: File, extra: Partial<AttachmentItem> = {}): AttachmentItem => ({
  localId: crypto.randomUUID(),
  preview: URL.createObjectURL(file),
  status: "uploading",
  video: isVideoFile(file),
  file,
  ...extra,
});

export function useAttachments(upload: Upload | null) {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingVideo | null>(null);
  // 연달아 고를 때도 4개(동영상 1개)를 넘지 않도록 현재 개수를 즉시 반영해 둔다 (고르는 중인 동영상 포함)
  const countRef = useRef(0);
  const videoRef = useRef(0);
  const videoCount = items.filter((x) => x.video).length + (pending ? 1 : 0);
  const count = items.length + (pending ? 1 : 0);
  useEffect(() => {
    countRef.current = count;
    videoRef.current = videoCount;
  }, [count, videoCount]);

  // 줄이는 중에 빼면 변환을 멈춘다
  const aborts = useRef(new Map<string, AbortController>());

  const run = useCallback(
    async (item: AttachmentItem) => {
      if (!upload || !item.file) return;
      const patch = (p: Partial<AttachmentItem>) =>
        setItems((cur) => cur.map((x) => (x.localId === item.localId ? { ...x, ...p } : x)));
      patch({ status: "uploading", progress: 0 });
      try {
        let saved: Uploaded;
        if (item.video) {
          let file = item.file;
          // 줄이는 단계가 실제로 돌았으면 0–50% 는 줄이기, 50–100% 는 업로드. 줄이지 않으면 업로드만 0–100%.
          let base = 0;
          if (!item.compressed) {
            const ctrl = new AbortController();
            aborts.current.set(item.localId, ctrl);
            const out = await compressVideo(file, {
              trim: item.trim,
              onProgress: (p) => {
                base = COMPRESS_SHARE;
                patch({ progress: p * COMPRESS_SHARE });
              },
              signal: ctrl.signal,
            })
              .catch((err) => {
                if (err instanceof VideoTooLongError) throw err;
                return null; // 변환 중 오류 → 원본으로
              })
              .finally(() => aborts.current.delete(item.localId));
            if (ctrl.signal.aborted) return;
            if (out && out !== file) {
              file = out;
              // 썸네일·다시 보기도 실제로 올라가는 (잘라서 줄인) 파일로 바꾼다
              URL.revokeObjectURL(item.preview);
              patch({ file: out, compressed: true, preview: URL.createObjectURL(out) });
            }
          }
          if (file.size > MAX_VIDEO_MB * 1024 * 1024) throw new ApiError(413, "file_too_large");
          patch({ progress: base });
          saved = await upload(file, (p) => patch({ progress: base + p * (1 - base) }));
        } else {
          saved = await upload(await prepareImage(item.file));
        }
        patch({ status: "done", id: saved.id, type: saved.type, size: saved.size });
      } catch (err) {
        patch({ status: "failed" });
        setError(errorText(err, item.video));
      }
    },
    [upload],
  );

  const add = useCallback(
    (files: FileList | File[]) => {
      setError(null);
      const room = MAX_ATTACHMENTS - countRef.current;
      const list = Array.from(files);
      const media = list.filter((f) => isImageFile(f) || isVideoFile(f));
      if (media.length < list.length) setError("사진·동영상 파일만 올릴 수 있어요");
      // 동영상: 메시지당 1개. 큰 원본은 줄여서 올리므로 여기서는 터무니없이 큰 파일만 막는다.
      let videoRoom = MAX_VIDEOS - videoRef.current;
      const picked = media.filter((f) => {
        if (!isVideoFile(f)) return true;
        if (f.size > RAW_VIDEO_MAX) {
          setError("동영상이 너무 커요. 짧게 잘라서 올려주세요");
          return false;
        }
        if (videoRoom <= 0) {
          setError(`동영상은 ${MAX_VIDEOS}개까지 올릴 수 있어요`);
          return false;
        }
        videoRoom--;
        return true;
      });
      if (picked.length > room) setError(`사진·동영상은 합쳐서 ${MAX_ATTACHMENTS}개까지 올릴 수 있어요`);
      const take = picked.slice(0, Math.max(0, room));
      const video = take.find(isVideoFile);
      const next = take.filter((f) => f !== video).map((f) => newItem(f));
      countRef.current += take.length;
      videoRef.current += video ? 1 : 0;
      if (video) {
        const item = newItem(video);
        if (!canCompressVideo()) next.push(item);
        else {
          // 길이를 읽어 30초 넘으면 보낼 부분 고르기를 띄운다. 그 전까지는 칸만 잡아 둔다.
          setPending({ file: video, preview: item.preview, duration: null });
          probeDuration(item.preview).then((duration) => {
            if (duration && duration > TRIM_FROM_SECONDS) {
              setPending({ file: video, preview: item.preview, duration });
              return;
            }
            const short = { ...item, duration: duration ?? undefined };
            setPending(null);
            setItems((cur) => [...cur, short]);
            run(short);
          });
        }
      }
      setItems((cur) => [...cur, ...next]);
      next.forEach(run);
    },
    [run],
  );

  // 보낼 부분 고르기: trim 이 없으면 전체
  const confirmTrim = useCallback(
    (trim: Trim | null) => {
      if (!pending?.duration) return;
      const item: AttachmentItem = {
        localId: crypto.randomUUID(),
        preview: pending.preview,
        status: "uploading",
        video: true,
        file: pending.file,
        ...(trim ? { trim, duration: trim.end - trim.start } : { duration: pending.duration }),
      };
      setPending(null);
      setItems((cur) => [...cur, item]);
      run(item);
    },
    [pending, run],
  );

  // 고르기 취소 → 첨부에 넣지 않는다
  const cancelTrim = useCallback(() => {
    if (pending) URL.revokeObjectURL(pending.preview);
    setPending(null);
  }, [pending]);

  const remove = useCallback((localId: string) => {
    setError(null);
    aborts.current.get(localId)?.abort();
    setItems((cur) => {
      const gone = cur.find((x) => x.localId === localId);
      if (gone) URL.revokeObjectURL(gone.preview);
      return cur.filter((x) => x.localId !== localId);
    });
  }, []);

  const retry = useCallback(
    (localId: string) => {
      setError(null);
      const item = items.find((x) => x.localId === localId);
      if (item) run(item);
    },
    [items, run],
  );

  // 보내지 않고 되돌린 메시지의 사진(이미 올린 것)을 다시 채운다
  const restore = useCallback((list: { id: string; type: string; size: number; url: string | null }[]) => {
    setError(null);
    const next = list.flatMap((a): AttachmentItem[] =>
      a.url
        ? [
            {
              localId: crypto.randomUUID(),
              preview: a.url,
              status: "done",
              video: isVideoFile(a),
              id: a.id,
              type: a.type,
              size: a.size,
            },
          ]
        : [],
    );
    countRef.current = next.length;
    videoRef.current = next.filter((x) => x.video).length;
    setItems(next);
  }, []);

  // 보낸 뒤 비운다. 미리보기 URL 은 보낸 메시지(임시 표시)가 쓰고 있을 수 있어 해제하지 않는다.
  const reset = useCallback(() => {
    setItems([]);
    setError(null);
  }, []);

  return {
    items,
    error,
    add,
    remove,
    retry,
    restore,
    reset,
    pending,
    confirmTrim,
    cancelTrim,
    uploading: !!pending || items.some((x) => x.status === "uploading"),
    failed: items.some((x) => x.status === "failed"),
    ids: items.flatMap((x) => (x.status === "done" && x.id ? [x.id] : [])),
    full: count >= MAX_ATTACHMENTS,
  };
}

export type AttachmentsState = ReturnType<typeof useAttachments>;

// 올린 첨부 요약: "사진 2장 · 동영상 1개"
export function attachmentSummary(items: AttachmentItem[]) {
  const done = items.filter((x) => x.status === "done" && x.id);
  const videos = done.filter((x) => x.video).length;
  const photos = done.length - videos;
  return [photos ? `사진 ${photos}장` : "", videos ? `동영상 ${videos}개` : ""].filter(Boolean).join(" · ");
}

// 숨겨진 파일 입력. ref.current.click() 으로 연다.
export function FilePicker({
  state,
  inputRef,
}: {
  state: AttachmentsState;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*,video/*"
      multiple
      hidden
      onChange={(e) => {
        if (e.target.files?.length) state.add(e.target.files);
        e.target.value = "";
      }}
    />
  );
}

function Thumb({ item, state, onOpen }: { item: AttachmentItem; state: AttachmentsState; onOpen: () => void }) {
  return (
    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-panel-3 edge">
      {/* 눌러서 크게 다시 보기 (올리는 중에도 된다) */}
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-0"
        aria-label={item.video ? "동영상 크게 보기" : "사진 크게 보기"}
      />
      {item.video ? (
        // 첫 프레임만 보여준다 (#t 로 0.1초 지점을 그리게 해 iOS 에서 검은 칸이 되지 않도록)
        <video
          src={`${item.preview}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className={cn("pointer-events-none size-full object-cover", item.status !== "done" && "opacity-50")}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 로컬 미리보기(blob:)
        <img
          src={item.preview}
          alt=""
          className={cn("pointer-events-none size-full object-cover", item.status !== "done" && "opacity-50")}
        />
      )}
      {item.video && item.status === "done" && (
        <span className="pointer-events-none absolute bottom-1 left-1 flex h-5 items-center gap-0.5 rounded-full bg-foreground/70 px-1.5 text-background">
          <Play className="size-2.5 fill-current" />
          {item.duration ? <span className="num text-[10px] leading-none">{formatDuration(item.duration)}</span> : null}
        </span>
      )}
      {item.status === "uploading" && (
        <span
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5"
          aria-label="올리는 중"
        >
          <Loader2 className="size-4 animate-spin text-foreground motion-reduce:animate-none" />
          {item.video && (
            <>
              <span className="num text-[10.5px] leading-none font-medium text-foreground">
                {Math.round((item.progress ?? 0) * 100)}%
              </span>
              <span className="text-[9.5px] leading-none text-foreground/80">올리는 중</span>
            </>
          )}
        </span>
      )}
      {item.status === "failed" && (
        <button
          type="button"
          onClick={() => state.retry(item.localId)}
          className="absolute inset-0 grid place-items-center bg-late/15 text-late-text"
          aria-label="다시 올리기"
        >
          <RotateCw className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => state.remove(item.localId)}
        className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-foreground/70 text-background"
        aria-label={item.video ? "동영상 빼기" : "사진 빼기"}
      >
        <X className="size-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}

// 첨부 미리보기 줄. withAdd 면 끝에 "사진·동영상 추가" 칸을 붙인다 (문의 폼용).
export function AttachmentStrip({
  state,
  onAdd,
  withAdd = false,
  className,
}: {
  state: AttachmentsState;
  onAdd?: () => void;
  withAdd?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const trimSheet = state.pending?.duration ? (
    <TrimSheet
      src={state.pending.preview}
      duration={state.pending.duration}
      onConfirm={state.confirmTrim}
      onCancel={state.cancelTrim}
    />
  ) : null;
  if (!state.items.length && !withAdd && !state.error) return trimSheet;
  // 뷰어는 보낸 메시지와 같은 것을 쓴다. 아직 올리는 중이면 고른 파일(blob:)을 그대로 보여준다.
  const media = state.items.map((x) => ({
    id: x.localId,
    type: x.type ?? x.file?.type ?? (x.video ? "video/mp4" : "image/jpeg"),
    size: x.size ?? x.file?.size ?? 0,
    url: x.preview,
  }));
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap gap-2">
        {state.items.map((item, i) => (
          <Thumb key={item.localId} item={item} state={state} onOpen={() => setOpen(i)} />
        ))}
        {withAdd && !state.full && (
          <button
            type="button"
            onClick={onAdd}
            className="flex size-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-ink-3/50 text-ink-3 transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <ImagePlus className="size-4" strokeWidth={1.75} />
            <span className="num text-[10.5px]">
              {state.items.length}/{MAX_ATTACHMENTS}
            </span>
          </button>
        )}
      </div>
      {state.error && (
        <Notice tone="error" size="sm">
          {state.error}
        </Notice>
      )}
      {trimSheet}
      {open !== null && media[open] && (
        <MediaViewer items={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
