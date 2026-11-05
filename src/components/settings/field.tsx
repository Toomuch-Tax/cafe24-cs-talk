import { cn } from "@/lib/utils";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
        {hint && <span className="ml-2 font-normal text-ink-3">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

// 켜기/끄기. 설명이 함께 있는 한 줄 설정에 쓴다.
export function SwitchRow({
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex items-start gap-4", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
          checked ? "bg-foreground" : "bg-panel-3 edge",
        )}
      >
        <span
          className={cn(
            "absolute top-1 left-1 size-4 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
            checked && "translate-x-4",
          )}
        />
      </button>
    </label>
  );
}

// 둘 중 하나 고르기 (설명 있는 카드형 라디오)
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  disabled,
  name,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; title: string; description: string; badge?: string }[];
  disabled?: boolean;
  name: string;
}) {
  return (
    <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-2xl p-4 transition-colors edge",
              on ? "bg-raised outline-2 -outline-offset-1 outline-foreground outline-solid" : "bg-panel-2 hover:bg-panel-3",
              disabled && "pointer-events-none opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={on}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            <span className="flex items-center gap-2 text-sm font-semibold">
              {o.title}
              {o.badge && (
                <span className="rounded-full bg-signal-soft px-1.5 py-px text-[10px] font-semibold text-signal-text">
                  {o.badge}
                </span>
              )}
            </span>
            <span className="text-xs leading-relaxed text-ink-3">{o.description}</span>
          </label>
        );
      })}
    </div>
  );
}
