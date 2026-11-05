import { cn } from "@/lib/utils";

// 알림 4톤: 토스트(일시적 결과)와 안내 문구(그 자리에 남는 문제)가 같은 색·아이콘을 쓴다.
export type Tone = "success" | "info" | "warning" | "error";

export const TONE_TEXT: Record<Tone, string> = {
  success: "text-ok-text",
  info: "text-signal-text",
  warning: "text-warn-text",
  error: "text-late-text",
};
const TONE_ICON: Record<Tone, string> = {
  success: "text-ok",
  info: "text-signal",
  warning: "text-warn",
  error: "text-late",
};
const TONE_BG: Record<Tone, string> = {
  success: "bg-ok/10",
  info: "bg-signal-soft",
  warning: "bg-warn/12",
  error: "bg-late/10",
};

// 채운 도형 + 흰 기호: 색을 구분하지 못해도 모양으로 구분된다
export function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0", TONE_ICON[tone], className)}>
      {tone === "warning" ? (
        <path d="M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" fill="currentColor" />
      ) : (
        <circle cx="12" cy="12" r="10" fill="currentColor" />
      )}
      <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {tone === "success" && <path d="m8.5 12 2.5 2.5 4.5-5" strokeWidth="2.2" />}
        {tone === "error" && <path d="M12 7.5v5.5M12 16.5v.01" />}
        {tone === "warning" && <path d="M12 9v4.5M12 17v.01" />}
        {tone === "info" && <path d="M12 11v5.5M12 7.5v.01" />}
      </g>
    </svg>
  );
}

// 안내 문구: 불러오기 실패·충돌·입력 오류처럼 해결될 때까지 보여야 하는 것
export function Notice({
  tone,
  size = "default",
  action,
  className,
  children,
}: {
  tone: Tone;
  size?: "default" | "sm";
  action?: { label: string; onClick: () => void };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2 leading-relaxed",
        size === "sm" ? "text-xs" : "text-[13px]",
        TONE_BG[tone],
        TONE_TEXT[tone],
        className,
      )}
    >
      <ToneIcon tone={tone} className={cn(size === "sm" ? "mt-px size-3.5" : "mt-0.5 size-4")} />
      <div className="min-w-0 flex-1">{children}</div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 font-semibold whitespace-nowrap underline underline-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// 입력칸 바로 아래 오류
export function FieldError({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("flex items-center gap-1.5 text-xs text-late-text", className)}>
      <ToneIcon tone="error" className="size-3.5" />
      {children}
    </p>
  );
}
