"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { GoogleG } from "@/components/ui/google-g";
import { Input } from "@/components/ui/input";
import { Notice, type Tone } from "@/components/ui/notice";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type Options = { google: boolean; password: boolean; domains: string[] };

// 구글 로그인 콜백이 돌려보낸 이유 (?error=)
const GOOGLE_ERROR: Record<string, [Tone, string]> = {
  pending: ["info", "접속 요청을 보냈어요. 관리자가 승인하면 같은 구글 계정으로 다시 로그인해주세요."],
  disabled: ["error", "비활성화된 계정이에요. 관리자에게 문의해주세요."],
  domain: ["error", "회사 구글 계정으로만 로그인할 수 있어요. 다른 계정을 골라주세요."],
  cancelled: ["warning", "구글 로그인을 취소했어요."],
  expired: ["warning", "로그인 시간이 지났어요. 다시 시도해주세요."],
  rate_limited: ["warning", "로그인 시도가 너무 많아요. 5분 후 다시 시도해주세요."],
  google_not_configured: ["warning", "구글 로그인이 아직 설정되지 않았어요."],
  google_failed: ["error", "구글 로그인에 실패했어요. 잠시 후 다시 시도해주세요."],
};

export function LoginForm() {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<[Tone, string] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("error");
    const t = code ? setTimeout(() => setNotice(GOOGLE_ERROR[code] ?? GOOGLE_ERROR.google_failed), 0) : undefined;
    api<Options>("/api/auth/options")
      .then((o) => {
        setOptions(o);
        if (!o.google) setShowPassword(true);
      })
      .catch(() => setOptions({ google: false, password: true, domains: [] }));
    return () => clearTimeout(t);
  }, []);

  const next = () => safeNext(new URLSearchParams(location.search).get("next"));
  const domains = options?.domains.map((d) => `@${d}`).join(", ");

  return (
    <div className="glass flex w-full max-w-sm flex-col gap-3 rounded-[24px] p-7 float">
      <BrandMark />
      <h1 className="mt-4 text-[22px] font-bold tracking-[-0.025em]">CS-Talk</h1>
      <p className="-mt-2 mb-3 text-sm text-muted-foreground">
        {options?.google ? `회사 구글 계정(${domains})으로 로그인하세요.` : "상담원 계정으로 로그인하세요."}
      </p>

      {notice && <Notice tone={notice[0]}>{notice[1]}</Notice>}

      {options?.google && (
        <a
          href={`/api/auth/google?next=${encodeURIComponent(next())}`}
          className="flex h-11 items-center justify-center gap-2.5 rounded-xl bg-foreground text-sm font-semibold text-background transition-opacity hover:opacity-90"
        >
          <span className="grid size-6 place-items-center rounded-full bg-white">
            <GoogleG className="size-4" />
          </span>
          Google 계정으로 로그인
        </a>
      )}

      {options?.google && options.password && (
        <button
          type="button"
          aria-expanded={showPassword}
          onClick={() => setShowPassword((v) => !v)}
          className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-3 hover:text-foreground"
        >
          이메일·비밀번호로 로그인
          <ChevronDown className={cn("size-3.5 transition-transform", showPassword && "rotate-180")} />
        </button>
      )}

      {options?.password && showPassword && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setLoading(true);
            setError(null);
            try {
              await api("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
              });
              router.replace(next());
            } catch (err) {
              setError(
                err instanceof ApiError && err.status === 429
                  ? "로그인 시도가 너무 많아요. 5분 후 다시 시도해주세요."
                  : err instanceof ApiError && err.code === "password_login_disabled"
                    ? "비밀번호 로그인이 꺼져 있어요. 구글 계정으로 로그인해주세요."
                    : "이메일 또는 비밀번호가 맞지 않아요.",
              );
              setLoading(false);
            }
          }}
        >
          <Input
            name="email"
            type="email"
            placeholder="이메일"
            autoComplete="username"
            aria-label="이메일"
            className="h-10 rounded-xl"
            required
          />
          <Input
            name="password"
            type="password"
            placeholder="비밀번호"
            autoComplete="current-password"
            aria-label="비밀번호"
            className="h-10 rounded-xl"
            required
          />
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            type="submit"
            variant={options.google ? "outline" : "default"}
            disabled={loading}
            className="mt-1 h-10 rounded-xl"
          >
            {loading ? "로그인 중…" : "로그인"}
          </Button>
        </form>
      )}
    </div>
  );
}

// 로그인 후 돌아갈 주소: 같은 사이트의 경로만 허용 (//evil.com, 탭·줄바꿈·역슬래시를 끼운 외부 주소 차단)
function safeNext(next: string | null) {
  if (!next) return "/inbox";
  try {
    const u = new URL(next, location.origin);
    if (u.origin !== location.origin || /^\/[/\\]/.test(u.pathname)) return "/inbox";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/inbox";
  }
}
