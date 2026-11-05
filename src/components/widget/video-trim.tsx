"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  estimateVideoBytes,
  MAX_VIDEO_MINUTES,
  type Trim,
} from "./video-compress";

// 긴 동영상을 고르면 보낼 부분만 고르게 하는 시트.
// 고른 구간은 줄이기 단계(video-compress.ts)에 trim 으로 넘겨 한 번에 자르고 줄인다.

// 이보다 긴 영상만 고르기를 띄운다. 짧은 영상은 지금처럼 바로 올린다.
export const TRIM_FROM_SECONDS = 30;
// 한 번에 보낼 수 있는 최대 길이. 더 긴 영상은 처음 이만큼이 골라진 채로 열린다.
const MAX_SELECT = MAX_VIDEO_MINUTES * 60;
const MIN_SELECT = 1;
const FRAMES = 8;

export const formatDuration = (sec: number) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const lengthText = (sec: number) => {
  const s = Math.max(1, Math.round(sec));
  return s >= 60
    ? `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ""}`
    : `${s}초`;
};
const sizeText = (s: number) =>
  `약 ${Math.max(1, Math.round(estimateVideoBytes(s) / 1024 / 1024))}MB`;

// 동영상 길이(초). 읽지 못하면 null (그 경우 고르기 없이 바로 올린다).
export function probeDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const done = (d: number | null) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      resolve(d);
    };
    const timer = setTimeout(() => done(null), 5000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () =>
      done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

// 구간 막대에 깔 장면 8장. 따로 영상을 하나 더 열어 차례로 넘기며 그린다.
function useFilmstrip(src: string, duration: number) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    let stop = false;
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = src;
    const canvas = document.createElement("canvas");
    const seek = (t: number) =>
      new Promise<void>((resolve) => {
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          resolve();
        };
        v.addEventListener("seeked", onSeeked);
        v.currentTime = t;
      });
    (async () => {
      await new Promise((r) =>
        v.readyState >= 1 ? r(null) : (v.onloadeddata = r),
      );
      const h = 96;
      canvas.height = h;
      canvas.width = Math.round(
        (h * (v.videoWidth || 9)) / (v.videoHeight || 16),
      );
      const ctx = canvas.getContext("2d");
      for (let i = 0; i < FRAMES && !stop; i++) {
        await seek(((i + 0.5) * duration) / FRAMES);
        if (stop || !ctx) break;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", 0.6);
        setFrames((cur) => [...cur, url]);
      }
    })().catch(() => {});
    return () => {
      stop = true;
      v.removeAttribute("src");
      v.load();
    };
  }, [src, duration]);
  return frames;
}

export function TrimSheet({
  src,
  duration,
  onConfirm,
  onCancel,
}: {
  src: string;
  duration: number;
  onConfirm: (trim: Trim | null) => void;
  onCancel: () => void;
}) {
  const tooLong = duration > MAX_SELECT;
  const [range, setRange] = useState({
    start: 0,
    end: Math.min(duration, MAX_SELECT),
  });
  const rangeRef = useRef(range);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const frames = useFilmstrip(src, duration);

  // 고른 구간만 반복 재생하고, 재생 위치 막대·시간을 따라 움직인다
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const { start, end } = rangeRef.current;
        if (
          !dragging.current &&
          (v.currentTime >= end || v.currentTime < start - 0.25)
        )
          v.currentTime = start;
        if (headRef.current)
          headRef.current.style.left = `${(v.currentTime / duration) * 100}%`;
        if (timeRef.current)
          timeRef.current.textContent = formatDuration(
            Math.floor(v.currentTime),
          );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const drag = useCallback(
    (key: "start" | "end") => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      dragging.current = true;
      const v = videoRef.current;
      v?.pause();
      const move = (ev: PointerEvent) => {
        const r = trackRef.current!.getBoundingClientRect();
        const t = Math.max(
          0,
          Math.min(duration, ((ev.clientX - r.left) / r.width) * duration),
        );
        const cur = rangeRef.current;
        // 최소 1초, 최대 10분
        const next =
          key === "start"
            ? {
                ...cur,
                start: Math.max(
                  cur.end - MAX_SELECT,
                  Math.min(t, cur.end - MIN_SELECT),
                ),
              }
            : {
                ...cur,
                end: Math.min(
                  cur.start + MAX_SELECT,
                  Math.max(t, cur.start + MIN_SELECT),
                ),
              };
        rangeRef.current = next;
        setRange(next);
        // 끄는 동안에는 손잡이 위치의 장면을 보여준다
        if (v)
          v.currentTime =
            key === "start" ? next.start : Math.max(next.start, next.end - 0.1);
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        dragging.current = false;
        if (v) {
          v.currentTime = rangeRef.current.start;
          void v.play().catch(() => {});
        }
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    },
    [duration],
  );

  const len = range.end - range.start;
  const whole = range.start <= 0.05 && range.end >= duration - 0.05;
  const a = (range.start / duration) * 100;
  const b = (range.end / duration) * 100;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-foreground/30 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="보낼 부분 고르기"
        className="widget-sheet-up flex h-full w-full flex-col bg-card sm:h-[min(680px,92vh)] sm:max-w-sm sm:rounded-2xl sm:shadow-xl"
      >
        <div className="flex items-center gap-2 py-3 pr-3.5 pl-[18px]">
          <h3 className="flex-1 text-base font-bold tracking-tight">
            보낼 부분 고르기
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="grid size-8 place-items-center rounded-full bg-panel-3 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="relative mx-[18px] min-h-40 flex-1 overflow-hidden rounded-2xl bg-foreground">
          <video
            ref={videoRef}
            src={src}
            muted
            autoPlay
            playsInline
            className="absolute inset-0 size-full object-contain"
          />
          <span
            ref={timeRef}
            className="num absolute bottom-2.5 left-2.5 rounded-md bg-foreground/60 px-1.5 py-0.5 text-[11px] text-background"
          >
            0:00
          </span>
        </div>
        <div className="mx-[18px] mt-3.5">
          <div className="mb-2 flex items-baseline justify-between text-[12.5px]">
            <b className="num text-sm font-semibold">
              {formatDuration(range.start)} – {formatDuration(range.end)}
            </b>
            <span className="text-muted-foreground">
              {lengthText(len)} · {sizeText(len)}
            </span>
          </div>
          {/* 손잡이(20px)가 막대 바깥에 붙으므로 그만큼 안으로 들여 화면 가장자리에 닿지 않게 한다 */}
          <div className="px-5">
            <div
              ref={trackRef}
              className="relative h-[52px] touch-none select-none"
            >
              <div className="absolute inset-0 flex overflow-hidden rounded-[10px] bg-panel-3">
                {frames.map((f, i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- 영상에서 그린 장면(data:)
                  <img
                    key={i}
                    src={f}
                    alt=""
                    className="h-full min-w-0 flex-1 object-cover"
                  />
                ))}
              </div>
              <div
                className="absolute inset-y-0 left-0 rounded-l-[10px] bg-card/70"
                style={{ width: `${a}%` }}
              />
              <div
                className="absolute inset-y-0 right-0 rounded-r-[10px] bg-card/70"
                style={{ width: `${100 - b}%` }}
              />
              <div
                className="pointer-events-none absolute -inset-y-[3px] border-y-[3px] border-signal"
                style={{ left: `${a}%`, right: `${100 - b}%` }}
              />
              <div
                ref={headRef}
                className="pointer-events-none absolute -inset-y-1.5 -ml-px w-[3px] rounded-sm bg-background ring-1 ring-foreground/30"
              />
              {(["start", "end"] as const).map((key) => (
                <div
                  key={key}
                  role="slider"
                  aria-label={key === "start" ? "시작 지점" : "끝 지점"}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration)}
                  aria-valuenow={Math.round(range[key])}
                  aria-valuetext={formatDuration(range[key])}
                  onPointerDown={drag(key)}
                  className={cn(
                    "absolute -inset-y-[3px] grid w-5 cursor-ew-resize place-items-center bg-signal after:h-4 after:w-[3px] after:rounded-sm after:bg-signal-foreground",
                    key === "start"
                      ? "-translate-x-full rounded-l-[10px]"
                      : "rounded-r-[10px]",
                  )}
                  style={{ left: `${key === "start" ? a : b}%` }}
                />
              ))}
            </div>
          </div>
        </div>
        <p className="mx-[18px] mt-2.5 text-[12.5px] leading-normal text-muted-foreground">
          {tooLong
            ? `동영상은 ${MAX_VIDEO_MINUTES}분까지 보낼 수 있어요. 문제가 보이는 부분을 골라주세요.`
            : "문제가 보이는 부분만 남기면 더 빨리 올라가고, 담당자도 바로 확인할 수 있어요."}
        </p>
        <div className="flex flex-col gap-1.5 px-[18px] pt-3 pb-4">
          <button
            type="button"
            onClick={() =>
              onConfirm(whole ? null : { start: range.start, end: range.end })
            }
            className="h-[46px] rounded-[14px] bg-foreground text-[14.5px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            {whole ? "전체 첨부" : "이 부분만 첨부"}
          </button>
          {!tooLong && !whole && (
            <button
              type="button"
              onClick={() => onConfirm(null)}
              className="h-9 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              전체 첨부 ({lengthText(duration)})
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
