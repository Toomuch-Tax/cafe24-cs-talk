"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProfileAvatar, usePublicProfile } from "@/components/chat/public-profile";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { InquiryPrefill } from "./order-status";

type AskResult = {
  decision: "answered" | "handoff" | "blocked" | "error";
  answer: string | null;
  category: string;
  answerId: string;
};

// 위젯 "AI에게 물어보기": 정책 문서 기반 즉답. 답할 수 없으면 문의 남기기로 바로 이어준다.
export function AskAi({
  token,
  question,
  pageUrl,
  onInquiry,
  onOrders,
  onUnresolved,
}: {
  token: string;
  question: string;
  pageUrl: string | null;
  onInquiry: (p: InquiryPrefill) => void;
  onOrders: () => void;
  onUnresolved?: () => void;
}) {
  const profile = usePublicProfile();
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    // 화면이 열리면 한 번만 질문한다 (개발 모드의 effect 두 번 실행에도 한 번)
    if (asked.current) return;
    asked.current = true;
    api<AskResult>("/api/widget/ask", { method: "POST", token, body: JSON.stringify({ question, pageUrl }) })
      .then((r) => {
        setResult(r);
        if (r.decision !== "answered") onUnresolved?.();
      })
      .catch(() => setResult({ decision: "error", answer: null, category: "etc", answerId: "" }))
      .finally(() => setLoading(false));
  }, [token, question, pageUrl, onUnresolved]);

  const inquiry = () =>
    onInquiry({
      category: result?.category ?? "etc",
      fromAi: { question, answer: result?.decision === "answered" ? result.answer : null, answerId: result?.answerId || null },
    });
  const sendFeedback = (helpful: boolean) => {
    setFeedback(helpful);
    if (result?.answerId) {
      api(`/api/widget/ask/${result.answerId}/feedback`, {
        method: "POST",
        token,
        body: JSON.stringify({ helpful }),
      }).catch(() => {});
    }
    if (!helpful) {
      onUnresolved?.();
      inquiry();
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-5">
      <div className="max-w-[85%] self-end rounded-[16px_4px_16px_16px] bg-bubble-customer px-3.5 py-2.5 text-sm text-bubble-customer-foreground">
        {question}
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-ink-3">
          <Sparkles className="size-3.5 animate-pulse text-signal-text" />
          답변을 찾고 있어요…
        </p>
      ) : result?.decision === "answered" && result.answer ? (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
              <ProfileAvatar size="xs" />
              {profile.name}
              <span className="rounded-full bg-panel-3 px-1.5 py-px text-[10px] font-medium text-ink-3">
                AI 답변 · 정책 안내 기준
              </span>
            </span>
            <div className="max-w-[92%] rounded-[4px_16px_16px_16px] bg-bubble-agent px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-bubble-agent-foreground edge">
              <RevealWords text={result.answer} />
            </div>
          </div>
          {feedback === null ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-panel-2 p-3 edge">
              <span className="text-xs text-muted-foreground">해결됐나요?</span>
              <div className="flex gap-2">
                <Button variant="outline" className="h-9 flex-1 rounded-xl" onClick={() => sendFeedback(true)}>
                  해결됐어요
                </Button>
                <Button variant="outline" className="h-9 flex-1 rounded-xl" onClick={() => sendFeedback(false)}>
                  문의 남길게요
                </Button>
              </div>
            </div>
          ) : (
            feedback && <p className="text-xs text-ink-3">감사합니다. 더 궁금한 점은 언제든 물어보세요.</p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-2xl bg-raised p-4 edge">
          <p className="text-sm leading-relaxed font-medium">
            {result?.decision === "error"
              ? "지금은 답변을 불러오지 못했어요."
              : "이 내용은 담당자가 직접 확인해야 정확하게 안내드릴 수 있어요."}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            문의를 남겨주시면 순서대로 답변드려요. 주문·배송 상태는 바로 조회할 수 있어요.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <Button className="h-10 rounded-xl" onClick={inquiry}>
              문의 남기기
            </Button>
            <Button variant="outline" className="h-10 rounded-xl" onClick={onOrders}>
              주문·배송 조회
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// 답변이 '만들어지는' 느낌: 단어마다 30ms 간격으로 블러가 걷힌다. 줄바꿈·공백은 그대로 둔다.
export function RevealWords({ text }: { text: string }) {
  let i = 0;
  return text.split(/(\s+)/).map((part, k) =>
    /^\s*$/.test(part) ? (
      part
    ) : (
      <span key={k} className="widget-word" style={{ animationDelay: `${Math.min(i++ * 30, 1500)}ms` }}>
        {part}
      </span>
    ),
  );
}
