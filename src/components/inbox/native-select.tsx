import { cn } from "@/lib/utils";

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 appearance-none rounded-xl border-0 bg-panel-3 bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2212%22%20height=%2212%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%238b8fa3%22%20stroke-width=%222%22%3E%3Cpath%20d=%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')] bg-[length:12px] bg-[position:right_10px_center] bg-no-repeat pr-7 pl-3 text-[13px] text-foreground outline-none edge transition-colors hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50 [&>option]:bg-popover",
        className,
      )}
      {...props}
    />
  );
}
