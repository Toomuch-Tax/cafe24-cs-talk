"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/inbox/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/client/api";
import { Field } from "./field";

const MIN = 8;

// 내 비밀번호 바꾸기. 구글로만 들어오던 계정은 현재 비밀번호 없이 새로 만든다.
export function PasswordSettings({ email }: { email: string }) {
  const [state, setState] = useState<{ hasPassword: boolean; passwordLogin: boolean } | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ hasPassword: boolean; passwordLogin: boolean }>("/api/auth/password")
      .then(setState)
      .catch((err) => toast.error("비밀번호 정보를 불러오지 못했어요.", err));
  }, []);

  if (!state) return null;
  const { hasPassword } = state;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < MIN) return setError(`새 비밀번호는 ${MIN}자 이상으로 써주세요.`);
    if (next !== confirm) return setError("새 비밀번호 두 칸이 서로 달라요.");
    setSaving(true);
    try {
      await api("/api/auth/password", {
        method: "PUT",
        body: JSON.stringify({ current: hasPassword ? current : undefined, next }),
      });
      setState({ ...state, hasPassword: true });
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(hasPassword ? "비밀번호를 바꿨어요." : "비밀번호를 만들었어요.");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "wrong_current"
          ? "현재 비밀번호가 맞지 않아요."
          : err instanceof ApiError && err.code === "same_password"
            ? "지금 쓰는 비밀번호와 다른 비밀번호로 정해주세요."
            : err instanceof ApiError && err.status === 429
              ? "시도가 너무 많아요. 5분 후 다시 해주세요."
              : "비밀번호를 저장하지 못했어요. 잠시 후 다시 해주세요.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={hasPassword ? "비밀번호 변경" : "비밀번호 만들기"}
      hint={
        hasPassword
          ? "이메일·비밀번호로 로그인할 때 쓰는 비밀번호예요."
          : "지금은 구글로만 들어와요. 비밀번호를 만들면 이메일·비밀번호로도 로그인할 수 있어요."
      }
    >
      <form className="flex max-w-sm flex-col gap-4" onSubmit={submit}>
        {/* 비밀번호 관리자가 어느 계정의 비밀번호인지 알 수 있게 */}
        <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
        {hasPassword && (
          <Field label="현재 비밀번호">
            <Input
              type="password"
              autoComplete="current-password"
              aria-label="현재 비밀번호"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="h-10 rounded-xl"
              required
            />
          </Field>
        )}
        <Field label="새 비밀번호" hint={`${MIN}자 이상`}>
          <Input
            type="password"
            autoComplete="new-password"
            aria-label="새 비밀번호"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="h-10 rounded-xl"
            required
          />
        </Field>
        <Field label="새 비밀번호 확인">
          <Input
            type="password"
            autoComplete="new-password"
            aria-label="새 비밀번호 확인"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-10 rounded-xl"
            required
          />
        </Field>
        {error && (
          <Notice tone="error" size="sm">
            {error}
          </Notice>
        )}
        {!state.passwordLogin && (
          <Notice tone="info" size="sm">
            지금은 관리자가 비밀번호 로그인을 꺼 두어서 구글로만 들어올 수 있어요. 켜지면 이 비밀번호를 쓸 수 있어요.
          </Notice>
        )}
        <Button type="submit" disabled={saving} className="self-start rounded-xl px-4">
          {saving ? "저장 중…" : hasPassword ? "비밀번호 변경" : "비밀번호 만들기"}
        </Button>
      </form>
    </Card>
  );
}
