import { cn } from "@/lib/utils";

// 상태·유형 표시용 작은 알약. 색은 신호(tone)가 있을 때만 쓴다.
export function Chip({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & {
  tone?: "neutral" | "signal" | "warn" | "late" | "ok";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-panel-3 text-muted-foreground",
        tone === "signal" && "bg-signal-soft text-signal-text",
        tone === "warn" && "bg-warn/15 text-warn-text",
        tone === "late" && "bg-late/15 text-late-text",
        tone === "ok" && "bg-ok/15 text-ok-text",
        className,
      )}
      {...props}
    />
  );
}
