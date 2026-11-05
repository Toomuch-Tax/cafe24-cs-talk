"use client";

// 올린 이미지를 size px 정사각형(가운데 기준 자르기)으로 줄여 data URL 로 만든다. 투명 배경은 유지.
// webp 를 못 만드는 브라우저(구형 사파리)는 png 로.
export async function toAvatarDataUrl(file: File, size = 256, quality = 0.9) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const s = Math.min(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  bmp.close();
  const webp = canvas.toDataURL("image/webp", quality);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}
