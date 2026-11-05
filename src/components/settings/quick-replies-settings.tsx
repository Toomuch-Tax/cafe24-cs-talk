"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/inbox/app-shell";
import type { QuickReply } from "@/components/inbox/conversation-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/client/api";

type Draft = { shortcut: string; title: string; body: string };
const EMPTY: Draft = { shortcut: "", title: "", body: "" };

// 단축어 중복은 DB 제약 위반(500)으로 온다
const dupHint = (err: unknown) =>
  err instanceof ApiError && err.status === 500 ? { description: "같은 단축어가 이미 있는지 확인해주세요." } : undefined;

function ReplyFields({ value, onChange, rows = 6 }: { value: Draft; onChange: (d: Draft) => void; rows?: number }) {
  return (
    <>
      <div className="flex gap-2">
        <Input
          placeholder="단축어 (예: 배송)"
          className="w-40 font-mono"
          value={value.shortcut}
          onChange={(e) => onChange({ ...value, shortcut: e.target.value })}
        />
        <Input placeholder="제목" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      </div>
      <Textarea
        placeholder={"답변 내용\n건마다 바꿀 부분은 {상품명} ({컬러}/{사이즈}) 처럼 중괄호로 감싸면, 답변 창에서 Tab 으로 빈칸을 옮겨 다니며 채울 수 있어요."}
        rows={rows}
        value={value.body}
        onChange={(e) => onChange({ ...value, body: e.target.value })}
      />
    </>
  );
}

const filled = (d: Draft) => Boolean(d.shortcut.trim() && d.title.trim() && d.body.trim());

export function QuickRepliesSettings() {
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [newReply, setNewReply] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setQuickReplies((await api<{ quickReplies: QuickReply[] }>("/api/inbox/quick-replies")).quickReplies);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load().catch((err) => toast.error("빠른 답변을 불러오지 못했어요.", err)), 0);
    return () => clearTimeout(t);
  }, [load]);

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/api/inbox/quick-replies/${editing.id}`, { method: "PUT", body: JSON.stringify(editing.draft) });
      toast.success(`/${editing.draft.shortcut.trim()} 빠른 답변을 수정했어요.`);
      setEditing(null);
      load();
    } catch (err) {
      toast.error("빠른 답변을 수정하지 못했어요.", err, dupHint(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="빠른 답변" hint="답변 입력창에서 /단축어 로 불러와요. 고객 자동응답(FAQ)과는 별개예요.">
      {quickReplies.length > 0 && (
        <ul className="mb-4 flex flex-col divide-y overflow-hidden rounded-2xl bg-panel-2 edge">
          {quickReplies.map((q) =>
            editing?.id === q.id ? (
              <li key={q.id} className="flex flex-col gap-2 px-4 py-3">
                <ReplyFields value={editing.draft} onChange={(draft) => setEditing({ id: q.id, draft })} rows={8} />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl px-4"
                    disabled={!filled(editing.draft) || saving}
                    onClick={saveEdit}
                  >
                    저장
                  </Button>
                  <Button variant="ghost" size="sm" className="text-ink-3" disabled={saving} onClick={() => setEditing(null)}>
                    취소
                  </Button>
                </div>
              </li>
            ) : (
              <li key={q.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <span className="font-mono text-signal-text">/{q.shortcut}</span> · {q.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground">{q.body}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-ink-3"
                  onClick={() => setEditing({ id: q.id, draft: { shortcut: q.shortcut, title: q.title, body: q.body } })}
                >
                  수정
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-ink-3"
                  onClick={async () => {
                    try {
                      await api(`/api/inbox/quick-replies/${q.id}`, { method: "DELETE" });
                      toast.success(`/${q.shortcut} 빠른 답변을 삭제했어요.`);
                      if (editing?.id === q.id) setEditing(null);
                      load();
                    } catch (err) {
                      toast.error("빠른 답변을 삭제하지 못했어요.", err);
                    }
                  }}
                >
                  삭제
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <ReplyFields value={newReply} onChange={setNewReply} />
        <Button
          variant="outline"
          className="self-start rounded-xl px-4"
          disabled={!filled(newReply)}
          onClick={async () => {
            try {
              await api("/api/inbox/quick-replies", { method: "POST", body: JSON.stringify(newReply) });
              toast.success(`/${newReply.shortcut} 빠른 답변을 추가했어요.`);
              setNewReply(EMPTY);
              load();
            } catch (err) {
              toast.error("빠른 답변을 추가하지 못했어요.", err, dupHint(err));
            }
          }}
        >
          추가
        </Button>
      </div>
    </Card>
  );
}
