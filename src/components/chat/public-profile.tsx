"use client";

import { createContext, useContext } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";
import { SUPPORT_NAME } from "@/lib/brand";

// 고객에게 보이는 답변 주체(이름·로고). 상담원 답변과 AI 답변이 모두 이 하나로 보인다.
// 값은 설정 → 고객 노출 정보에서 바꾸고, 위젯은 세션 응답·이메일 링크 화면은 스레드 응답으로 받는다.
export type PublicProfile = { name: string; avatarUrl: string | null };
export const DEFAULT_PUBLIC_PROFILE: PublicProfile = { name: SUPPORT_NAME, avatarUrl: null };

const Ctx = createContext<PublicProfile>(DEFAULT_PUBLIC_PROFILE);
export const PublicProfileProvider = Ctx.Provider;
export const usePublicProfile = () => useContext(Ctx);

const SIZES = {
  xs: "size-5 rounded-md",
  sm: "size-6 rounded-lg",
  md: "size-[30px] rounded-[10px]",
  lg: "size-16 rounded-[18px]",
} as const;
const MARK_TEXT = { xs: "text-[7.5px]", sm: "text-[9px]", md: "text-[11px]", lg: "text-[22px]" } as const;

// 로고가 없으면 기본 브랜드 마크
export function ProfileAvatar({
  size = "sm",
  profile,
  className,
}: {
  size?: keyof typeof SIZES;
  profile?: PublicProfile;
  className?: string;
}) {
  const fromCtx = usePublicProfile();
  const p = profile ?? fromCtx;
  if (!p.avatarUrl) return <BrandMark className={cn(SIZES[size], MARK_TEXT[size], className)} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 설정에서 올린 작은 로고 (CDN 캐시되는 API 응답)
    <img src={p.avatarUrl} alt="" aria-hidden className={cn("shrink-0 bg-panel-3 object-cover edge", SIZES[size], className)} />
  );
}
