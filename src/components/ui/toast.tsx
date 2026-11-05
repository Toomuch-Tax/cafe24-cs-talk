"use client";

import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { errorReason } from "@/lib/client/error-text";
import { cn } from "@/lib/utils";
import { TONE_TEXT, ToneIcon, type Tone } from "./notice";

// 토스트: 방금 한 작업의 결과. 운영자 콘솔(AppShell)에만 있고, 고객 위젯은 안내 문구(Notice)만 쓴다.
// 시간: 성공 3초 · 안내 4초 · 주의 6초 · 실패는 닫을 때까지. 마우스를 올리면 멈춘다(Base UI).
const manager = Toast.createToastManager<{ code?: string }>();
const TIMEOUT: Record<Tone, number> = { success: 3000, info: 4000, warning: 6000, error: 0 };

type Options = { description?: string; action?: { label: string; onClick: () => void } };

function add(tone: Tone, title: string, { description, action }: Options = {}, code?: string) {
  return manager.add({
    type: tone,
    title,
    description,
    // 되돌리기 같은 버튼이 있으면 누를 시간을 6초 이상 준다
    timeout: action && TIMEOUT[tone] ? Math.max(TIMEOUT[tone], 6000) : TIMEOUT[tone],
    priority: tone === "error" ? "high" : "low",
    actionProps: action && { children: action.label, onClick: action.onClick },
    data: { code },
  });
}

export const toast = {
  success: (title: string, opts?: Options) => add("success", title, opts),
  info: (title: string, opts?: Options) => add("info", title, opts),
  warning: (title: string, opts?: Options) => add("warning", title, opts),
  // 제목은 "[무엇을] 못 했어요", 이유·다음 행동은 오류에서 자동으로 채운다
  error: (title: string, err?: unknown, opts?: Options) => {
    const { reason, code } = errorReason(err);
    return add("error", title, { description: reason, ...opts }, err === undefined ? undefined : code);
  },
};

export function Toaster({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={manager} limit={3}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed right-6 bottom-6 z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2 outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager<{ code?: string }>();
  return toasts.map((t) => {
    const tone = (t.type ?? "info") as Tone;
    return (
      <Toast.Root
        key={t.id}
        toast={t}
        swipeDirection="right"
        className={cn(
          "float relative flex items-start gap-2.5 rounded-2xl bg-raised py-3 pr-3 pl-3.5 backdrop-blur-xl backdrop-saturate-[1.2]",
          "transition-[opacity,translate,scale,filter] duration-[260ms] ease-out",
          "data-starting-style:translate-y-2.5 data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-starting-style:blur-xs",
          "data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-ending-style:duration-[160ms]",
          "motion-reduce:translate-none motion-reduce:scale-100 motion-reduce:blur-none",
          "data-limited:hidden",
        )}
      >
        <ToneIcon tone={tone} className="mt-px size-5" />
        <Toast.Content className="min-w-0 flex-1">
          <Toast.Title className="text-[13.5px] font-semibold" />
          <Toast.Description className="mt-px text-[12.5px] leading-relaxed text-muted-foreground" />
          <Toast.Action
            className={cn(
              "mt-2 rounded-lg px-2.5 py-1 text-xs font-semibold",
              tone === "error" ? "bg-late/12" : "bg-signal-soft",
              TONE_TEXT[tone],
            )}
          />
          {t.data?.code && <p className="mt-1 font-mono text-[10.5px] text-ink-3">코드 {t.data.code}</p>}
        </Toast.Content>
        <Toast.Close
          aria-label="닫기"
          className="-mt-0.5 -mr-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] text-ink-3 hover:bg-panel-3 hover:text-foreground"
        >
          <X className="size-3.5" />
        </Toast.Close>
      </Toast.Root>
    );
  });
}
