import { BRAND_NAME_EN } from "@/lib/brand";
import { cn } from "@/lib/utils";

// 로고를 올리기 전 기본 마크: 브랜드 이름 첫 글자
const INITIAL = Array.from(BRAND_NAME_EN.trim())[0]?.toLowerCase() ?? "c";

export function BrandMark({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-foreground font-latin font-extrabold tracking-[-0.04em] text-background",
        size === "md" ? "size-[30px] rounded-[10px] text-[11px]" : "size-6 rounded-lg text-[9px]",
        className,
      )}
      aria-hidden
    >
      {INITIAL}
    </span>
  );
}
