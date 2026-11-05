"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client/report-error";

// 루트 레이아웃까지 깨졌을 때. 전역 스타일이 없으므로 인라인 스타일만 쓴다.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontWeight: 600 }}>화면을 불러오지 못했어요</p>
          <p style={{ fontSize: 14, color: "#666" }}>잠시 후 다시 시도해주세요.</p>
          <button type="button" onClick={() => retry()} style={{ marginTop: 8, padding: "8px 16px", borderRadius: 12, border: "1px solid #ddd", background: "#fff" }}>
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
