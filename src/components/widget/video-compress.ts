// 동영상을 올리기 전에 휴대폰·PC 브라우저에서 줄인다 (WebCodecs, 서버 비용 없음).
// 긴 변 1280px(720p) H.264 MP4 로 다시 인코딩하고, 영상 길이에 맞춰 비트레이트를 낮춰 결과가 TARGET_BYTES 안에 들어가게 한다.
// mediabunny 는 동영상을 고른 순간에만 불러온다 (위젯을 여는 방문자에게는 받지 않는다).

const MAX_DIM = 1280;
// 서버 상한 50MB 보다 조금 작게 잡는다 (컨테이너·비트레이트 오차)
const TARGET_BYTES = 44 * 1024 * 1024;
const MAX_VIDEO_BPS = 2_500_000;
// 이보다 낮으면 화면이 뭉개져 확인용으로 쓸 수 없다 → 그보다 긴 영상은 잘라 달라고 한다
const MIN_VIDEO_BPS = 500_000;
const AUDIO_BPS = 96_000;
// 이보다 작은 MP4·MOV 는 줄이지 않고 그대로 올린다 (이미 충분히 작고, 변환 시간이 아깝다)
const SKIP_BELOW = 8 * 1024 * 1024;

// 줄일 수 있는 최대 길이(초). 안내 문구에 쓴다.
// 이 길이를 넘는 영상은 보낼 부분 고르기에서 이만큼까지만 고를 수 있다.
export const MAX_VIDEO_SECONDS = Math.floor((TARGET_BYTES * 8) / (MIN_VIDEO_BPS + AUDIO_BPS));
export const MAX_VIDEO_MINUTES = Math.floor(MAX_VIDEO_SECONDS / 60);

export class VideoTooLongError extends Error {}

export type Trim = { start: number; end: number };

// 이 브라우저에서 줄이기(·자르기)를 할 수 있는지. 못 하면 자르기 화면도 띄우지 않는다.
export const canCompressVideo = () => typeof VideoEncoder !== "undefined";

// 고른 구간을 줄였을 때의 예상 크기(바이트). 아래 compressVideo 와 같은 기준.
export const estimateVideoBytes = (seconds: number) =>
  Math.min(TARGET_BYTES, (seconds * (MAX_VIDEO_BPS + AUDIO_BPS)) / 8);

// 결과가 null 이면 이 브라우저에서는 줄일 수 없다는 뜻 (원본을 올릴지 호출한 쪽이 정한다)
// trim 이 있으면 그 구간만 남긴다 (작은 영상도 다시 인코딩한다).
export async function compressVideo(
  file: File,
  { onProgress, signal, trim }: { onProgress?: (ratio: number) => void; signal?: AbortSignal; trim?: Trim } = {},
): Promise<File | null> {
  if (!trim && file.size < SKIP_BELOW && /^video\/(mp4|quicktime)$/.test(file.type)) return file;
  if (!canCompressVideo()) return null;
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const duration = trim ? trim.end - trim.start : await input.computeDuration();
    const videoBps = Math.min(MAX_VIDEO_BPS, (TARGET_BYTES * 8) / Math.max(duration, 1) - AUDIO_BPS);
    if (videoBps < MIN_VIDEO_BPS) throw new VideoTooLongError();
    const codec = await mb.getFirstEncodableVideoCodec(["avc", "hevc", "vp9"], { width: MAX_DIM, height: MAX_DIM });
    if (!codec) return null;

    const landscape = track.displayWidth >= track.displayHeight;
    const longest = Math.max(track.displayWidth, track.displayHeight);
    const output = new mb.Output({
      // 앞쪽에 목차(moov)를 두어 상담원 화면에서 다 받기 전에 재생이 시작되게 한다
      format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new mb.BufferTarget(),
    });
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: {
        ...(longest > MAX_DIM ? (landscape ? { width: MAX_DIM } : { height: MAX_DIM }) : {}),
        codec,
        // 고정 비트레이트: 화면이 복잡해도 결과 크기가 길이에 비례하게 (50MB 상한을 넘지 않도록)
        quality: new mb.Quality({ bitrate: Math.round(videoBps), bitrateMode: "constant" }),
        frameRate: 30,
        forceTranscode: true,
      },
      audio: { codec: "aac", quality: new mb.Quality(AUDIO_BPS) },
      ...(trim ? { trim } : {}),
    });
    // 소리를 인코딩하지 못하는 브라우저면 소리 없이라도 보낸다. 영상 트랙이 빠지면 포기한다.
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.isVideoTrack())) return null;
    conversion.onProgress = (p) => onProgress?.(p);
    const abort = () => void conversion.cancel();
    signal?.addEventListener("abort", abort);
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    const buffer = output.target.buffer;
    if (!buffer) return null;
    // 줄였는데 오히려 커졌으면(이미 압축이 잘 된 짧은 영상) 원본을 쓴다
    if (!trim && buffer.byteLength >= file.size && /^video\/(mp4|quicktime)$/.test(file.type)) return file;
    return new File([buffer], file.name.replace(/\.[^.]+$/, "") + ".mp4", { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}
