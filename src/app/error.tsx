"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client/report-error";

// 화면 렌더 중 오류. 서버 오류는 instrumentation.ts 가, 브라우저 오류는 여기서 보고한다.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-base font-semibold">화면을 불러오지 못했어요</p>
      <p className="text-sm text-muted-foreground">잠시 후 다시 시도해주세요.</p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-1 rounded-xl bg-panel-3 px-4 py-2 text-sm font-semibold edge hover:bg-panel-2"
      >
        다시 시도
      </button>
    </div>
  );
}
