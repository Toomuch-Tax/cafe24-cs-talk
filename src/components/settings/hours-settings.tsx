"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/inbox/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Field } from "./field";

type Hours = {
  timezone: string;
  days: number[];
  start: string;
  end: string;
  lunch?: { start: string; end: string } | null;
};
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function HoursSettings({ isAdmin }: { isAdmin: boolean }) {
  const [hours, setHours] = useState<Hours | null>(null);

  useEffect(() => {
    api<{ businessHours: Hours }>("/api/inbox/settings")
      .then((s) => setHours(s.businessHours))
      .catch((err) => toast.error("영업 시간을 불러오지 못했어요.", err));
  }, []);

  if (!hours) return null;
  return (
    <Card
      title="영업 시간"
      hint={isAdmin ? "답변 지연 경고와 '영업일 기준' 안내 계산에 쓰여요." : "관리자만 수정할 수 있어요."}
    >
      <fieldset disabled={!isAdmin} className="flex flex-col gap-5">
        <Field label="영업일">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = hours.days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setHours({ ...hours, days: on ? hours.days.filter((x) => x !== i) : [...hours.days, i] })
                  }
                  className={cn(
                    "size-9 rounded-full text-[13px] font-semibold transition-colors disabled:opacity-50",
                    on ? "bg-foreground text-background" : "bg-panel-3 text-ink-3 edge hover:text-foreground",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="운영 시간">
            <div className="flex items-center gap-2">
              <Input
                type="time"
                className="num"
                value={hours.start}
                onChange={(e) => setHours({ ...hours, start: e.target.value })}
              />
              <span className="text-ink-3">–</span>
              <Input
                type="time"
                className="num"
                value={hours.end}
                onChange={(e) => setHours({ ...hours, end: e.target.value })}
              />
            </div>
          </Field>
          <Field label="점심 시간">
            <div className="flex items-center gap-2">
              <Input
                type="time"
                className="num"
                value={hours.lunch?.start ?? ""}
                onChange={(e) =>
                  setHours({ ...hours, lunch: { start: e.target.value, end: hours.lunch?.end ?? "13:30" } })
                }
              />
              <span className="text-ink-3">–</span>
              <Input
                type="time"
                className="num"
                value={hours.lunch?.end ?? ""}
                onChange={(e) =>
                  setHours({ ...hours, lunch: { start: hours.lunch?.start ?? "12:30", end: e.target.value } })
                }
              />
            </div>
          </Field>
        </div>
        {isAdmin && (
          <Button
            className="self-start rounded-xl px-4"
            onClick={async () => {
              try {
                await api("/api/inbox/settings", { method: "PUT", body: JSON.stringify({ businessHours: hours }) });
                toast.success("영업 시간을 저장했어요.");
              } catch (err) {
                toast.error("영업 시간을 저장하지 못했어요.", err);
              }
            }}
          >
            저장
          </Button>
        )}
      </fieldset>
    </Card>
  );
}
