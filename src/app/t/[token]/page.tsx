import type { Metadata } from "next";
import { Suspense } from "react";
import { ThreadClient } from "./thread-client";
import { SUPPORT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${SUPPORT_NAME} · 내 문의`, robots: { index: false, follow: false } };

// 답변 이메일의 "답변 확인하고 이어서 문의하기" 링크
export default function ThreadPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">불러오는 중…</div>}>
      <ThreadClient />
    </Suspense>
  );
}
