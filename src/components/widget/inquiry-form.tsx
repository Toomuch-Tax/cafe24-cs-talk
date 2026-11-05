"use client";

import { ArrowUp, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { api, ApiError, newClientId } from "@/lib/client/api";
import { DONT_KNOW_ORDER, normalizeOrderId } from "@/lib/order-id";
import { PHONE } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { AttachmentStrip, attachmentSummary, FilePicker, useAttachments, widgetUpload } from "./attachments";
import { useFeature } from "./env";
import { MAX_VIDEO_MINUTES } from "./video-compress";
import { categoryOf, composeInquiryBody, INQUIRY_CATEGORIES, type InquiryField } from "./inquiry-fields";
import { Chip } from "@/components/ui/chip";
import { guestChosen, LoginChoice, loginWorthAsking, shopLinks } from "./login-nudge";
import { statusTone, type CustomerOrder, type InquiryPrefill } from "./order-status";

const EMAIL_KEY = "cstalk_email";
const savedEmail = () => {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
};

type Step = { sub?: string } & (
  | { id: "category"; ask: string }
  | { id: "order"; ask: string }
  | { id: string; ask: string; field: InquiryField }
  | { id: "free"; ask: string; required: boolean }
  | { id: "photos"; ask: string }
  | { id: "contact"; ask: string }
  | { id: "email"; ask: string }
  | { id: "confirm"; ask: string }
);

const SKIP = "";

// 입력하는 대로 010-1234-5678 형태로
const typePhone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, -4)}-${d.slice(-4)}`;
};

// "상품명" → "상품명을 알려주세요." / 선택 항목은 "반품 사유를 골라주세요." (받침 유무로 을/를)
const fieldAsk = (f: InquiryField) => {
  if (f.ask) return f.ask;
  if (f.label.endsWith("?")) return f.label;
  const last = f.label.charCodeAt(f.label.length - 1);
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${f.label}${hasFinal ? "을" : "를"} ${f.kind === "choice" ? "골라주세요" : "알려주세요"}.`;
};

export function InquiryForm({
  token,
  prefill,
  defaultEmail,
  pageUrl,
  emailEnabled,
  attachmentsEnabled = false,
  member = false,
  shopOrigin = null,
  onDone,
}: {
  token: string;
  prefill: InquiryPrefill;
  defaultEmail: string | null;
  pageUrl: string | null;
  emailEnabled: boolean;
  attachmentsEnabled?: boolean;
  // 서버가 확인한 로그인 회원이면 주문번호 대신 최근 주문을 골라서 받는다
  member?: boolean;
  shopOrigin?: string | null;
  onDone: (conversationId: string, emailGiven: boolean) => void;
}) {
  const validPrefill = INQUIRY_CATEGORIES.some((c) => c.value === prefill.category) && prefill.category !== "etc";
  const fromAi = prefill.fromAi ?? null;
  // 미리 채울 유형별 칸 (그 유형에 있는 칸만)
  const prefilledFields = (value: string) => {
    const out: Record<string, string> = {};
    for (const f of categoryOf(value).fields) {
      const v = prefill.fields?.[f.key]?.trim();
      if (v) out[`f:${f.key}`] = v;
    }
    return out;
  };
  // 대화처럼 한 단계씩 묻고, 답한 단계는 done 에 쌓인다 (SKIP = 건너뜀)
  const [done, setDone] = useState<Record<string, string>>(() => ({
    ...(validPrefill ? { category: prefill.category, ...prefilledFields(prefill.category) } : {}),
    ...(validPrefill && prefill.orderRef ? { order: prefill.orderRef } : {}),
    ...(validPrefill && prefill.body ? { free: prefill.body } : {}),
  }));
  const [editing, setEditing] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [email, setEmail] = useState(defaultEmail || savedEmail());
  // 비회원 연락처 (이름·휴대폰). 회원은 쇼핑몰 정보로 확인되니 묻지 않는다.
  // 비회원도 주문을 찾아야 하는 유형에서 주문번호를 건너뛴 때만 묻는다 (아래 needContact)
  const askContact = useFeature("guestContact") && !member;
  // 비회원이 주문 관련 문의를 시작하면 첫 질문 전에 로그인하고 남길지 묻는다 (login-nudge.tsx A). 비회원을 고른 기기는 다시 묻지 않는다
  const links = shopLinks(shopOrigin, pageUrl);
  const nudgeOn = useFeature("loginNudge");
  const [askLogin, setAskLogin] = useState(
    () => nudgeOn && !member && links !== null && loginWorthAsking(prefill.category) && !guestChosen(),
  );
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 재시도해도 문의가 두 번 접수되지 않도록 같은 ID 를 쓴다
  const [clientMessageId] = useState(newClientId);
  const canAttach = useFeature("attachments") && attachmentsEnabled;
  const photos = useAttachments(useMemo(() => (canAttach ? widgetUpload(token) : null), [canAttach, token]));
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // AI 대화에서 고른 사진은 사진 단계에 미리 담아 둔다 (개발 모드의 effect 두 번 실행에도 한 번)
  const prefillPhotos = useRef(prefill.photos ?? null);
  useEffect(() => {
    if (!canAttach || !prefillPhotos.current?.length) return;
    photos.add(prefillPhotos.current);
    prefillPhotos.current = null;
  }, [canAttach, photos]);

  const category = done.category ?? "etc";
  const cat = categoryOf(category);
  const hasRequired = cat.fields.some((f) => f.required);
  // 주문번호가 있으면 상담원이 주문 조회로 주문자 이름·휴대폰을 볼 수 있으니 묻지 않는다
  const needContact = askContact && cat.needsOrder && done.order === SKIP;

  // 회원 주문 고르기: 주문 단계에 처음 왔을 때만 한 번 불러온다 (실패·없음이면 주문번호 입력으로)
  const [orders, setOrders] = useState<CustomerOrder[] | "error" | null>(null);
  const [manualOrder, setManualOrder] = useState(false);
  const [pickedOrder, setPickedOrder] = useState<CustomerOrder | null>(null);
  const [pickedItems, setPickedItems] = useState<number[]>([]);
  const [manualItem, setManualItem] = useState(false);
  const orderPick = member && !manualOrder && orders !== "error" && (orders === null || orders.length > 0);

  const steps: Step[] = useMemo(() => {
    const list: Step[] = [
      {
        id: "category",
        ask: fromAi ? "담당자에게 이어서 문의를 남길게요. 어떤 문의인가요?" : "어떤 문의를 남기실 건가요?",
      },
    ];
    if (cat.needsOrder)
      list.push(
        orderPick
          ? { id: "order", ask: "어느 주문인가요?", sub: "최근 주문이에요." }
          : {
              id: "order",
              ask: "주문번호를 알려주세요.",
              sub: askContact ? "모르시면 건너뛰어도 돼요. 주문하신 분 성함과 휴대폰으로 찾아드릴게요." : "모르시면 건너뛰어도 돼요.",
            },
      );
    // 주문을 골랐으면 상품은 그 주문 상품 중에서 고른다
    const itemPick = Boolean(pickedOrder) && !manualItem && done.order === pickedOrder?.orderId;
    for (const f of cat.fields) {
      if (f.prefillOnly && !prefill.fields?.[f.key]?.trim()) continue;
      list.push(
        f.key === "item" && itemPick && (pickedOrder?.items.length ?? 0) > 1
          ? { id: `f:${f.key}`, ask: fieldAsk({ ...f, kind: "choice" }), sub: "여러 개 고를 수 있어요.", field: f }
          : f.key === "item" && itemPick
            ? { id: `f:${f.key}`, ask: fieldAsk({ ...f, kind: "choice" }), field: f }
            : { id: `f:${f.key}`, ask: fieldAsk(f), field: f },
      );
    }
    list.push({
      id: "free",
      ask: hasRequired || fromAi ? "더 알려주실 내용이 있나요?" : cat.hint,
      sub: cat.hintSub,
      // AI 에 남긴 질문이 본문이 되므로 자유 입력은 선택
      required: !hasRequired && !fromAi,
    });
    if (canAttach)
      list.push({
        id: "photos",
        ask:
          category === "defect"
            ? "상품 전체, 문제 부위를 가까이, 상품 라벨(택) 사진을 올려주세요."
            : "첨부할 사진·동영상이 있나요?",
        sub: category === "defect" ? "사진이나 짧은 동영상이 있으면 다시 여쭙지 않고 바로 확인할 수 있어요." : `최대 4개 · 동영상은 1개, ${MAX_VIDEO_MINUTES}분 이내`,
      });
    if (needContact) list.push({ id: "contact", ask: "주문을 찾을 수 있게, 주문하신 분의 성함과 휴대폰 번호를 알려주세요." });
    if (emailEnabled)
      list.push({
        id: "email",
        ask: "답변을 메일로도 받으시겠어요?",
        sub: "쇼핑몰에서 답변을 확인하지 않으시면 알려드려요. 선택이에요.",
      });
    list.push({ id: "confirm", ask: "이대로 접수할까요?" });
    return list;
  }, [cat, hasRequired, canAttach, category, askContact, needContact, emailEnabled, fromAi, orderPick, pickedOrder, manualItem, done.order, prefill.fields]);

  const firstUndone = steps.find((s) => s.id !== "confirm" && done[s.id] === undefined);
  const current = (editing && steps.find((s) => s.id === editing)) || firstUndone || steps[steps.length - 1];
  const currentIdx = steps.findIndex((s) => s.id === current.id);

  useEffect(() => {
    if (!member || current.id !== "order" || orders !== null) return;
    api<{ orders: CustomerOrder[] }>("/api/widget/orders", { token })
      .then((r) => setOrders(r.orders))
      .catch(() => setOrders("error"));
  }, [member, current.id, orders, token]);

  const answer = (id: string, value: string, extra?: Record<string, string>) => {
    setDone((cur) => {
      const next = { ...cur, [id]: value, ...extra };
      // 유형을 바꾸면 유형별 질문 답은 지운다
      if (id === "category" && cur.category !== value) {
        for (const k of Object.keys(next)) if (k.startsWith("f:") || k === "order") delete next[k];
        Object.assign(next, prefilledFields(value));
      }
      return next;
    });
    if (id === "category" && done.category !== value) {
      setPickedOrder(null);
      setPickedItems([]);
      setManualItem(false);
    }
    setEditing(null);
    setInput("");
    setError(null);
    setOrderWrong(false);
  };

  const itemLabel = (i: CustomerOrder["items"][number]) => [i.name, i.option].filter(Boolean).join(" · ");
  // 주문을 고르면 그 주문의 상품을 다음 질문 선택지로 쓰고, 배송 상태로 '상품을 받으셨나요?'를 미리 채운다
  const chooseOrder = (o: CustomerOrder) => {
    const extra: Record<string, string> = {};
    if (cat.fields.some((f) => f.key === "received")) {
      if (o.items.every((i) => /배송완료|구매확정/.test(i.status))) extra["f:received"] = "받았어요";
      else if (o.items.some((i) => /배송중|배송 중|출고|준비/.test(i.status))) extra["f:received"] = "아직 못 받았어요";
    }
    if (pickedOrder?.orderId !== o.orderId) {
      setPickedItems(o.items.length === 1 ? [0] : []);
      setManualItem(false);
      setDone((cur) => {
        const next = { ...cur };
        delete next["f:item"];
        delete next["f:received"];
        return next;
      });
    }
    setPickedOrder(o);
    answer("order", o.orderId, extra);
  };

  const display = (s: Step) => {
    const v = done[s.id];
    if (v === undefined) return null;
    if (s.id === "category") return categoryOf(v).label;
    if (s.id === "photos") return photos.ids.length ? attachmentSummary(photos.items) : "첨부 없음";
    if (v === SKIP) return s.id === "order" ? "주문번호 모름" : "건너뛰기";
    if (s.id === "contact")
      return (
        <>
          {contactName.trim()}
          <span className="block font-mono text-[12.5px]">{contactPhone}</span>
        </>
      );
    if (s.id === "order" && pickedOrder?.orderId === v)
      return (
        <>
          <span className="block font-mono text-[11px] opacity-60">{v}</span>
          {pickedOrder.items[0]?.name}
          {pickedOrder.items.length > 1 && ` 외 ${pickedOrder.items.length - 1}개`}
        </>
      );
    if (s.id === "f:item" && pickedOrder && !manualItem) return v.split(", ").join("\n");
    return v;
  };

  const answers = useMemo(() => {
    const a: Record<string, string> = {};
    for (const f of cat.fields) a[f.key] = done[`f:${f.key}`] ?? "";
    return a;
  }, [cat, done]);
  const body = [composeInquiryBody(cat, answers, done.free ?? ""), fromAi ? `AI에게 한 질문: ${fromAi.question}` : ""]
    .filter(Boolean)
    .join("\n\n");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // 이메일은 선택: 건너뛰면 보내지 않는다
      const givenEmail = emailEnabled && done.email ? done.email : null;
      const r = await api<{ conversationId: string }>("/api/widget/inquiries", {
        method: "POST",
        token,
        body: JSON.stringify({
          clientMessageId,
          category,
          orderRef: done.order?.trim() || null,
          body,
          email: givenEmail,
          aiAnswerId: fromAi?.answerId ?? null,
          name: needContact ? contactName.trim() : null,
          phone: needContact ? contactPhone : null,
          pageUrl,
          attachments: photos.ids,
        }),
      });
      if (givenEmail) {
        try {
          localStorage.setItem(EMAIL_KEY, givenEmail);
        } catch {}
      }
      onDone(r.conversationId, Boolean(givenEmail));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "문의를 너무 많이 남겼어요. 잠시 후 다시 시도해주세요."
          : err instanceof ApiError && err.code === "invalid_attachment"
            ? "첨부한 사진·동영상을 다시 올려주세요."
            : err instanceof ApiError && err.code === "invalid_body"
              ? needContact
                ? "연락처와 문의 내용을 확인해주세요."
                : "이메일과 문의 내용을 확인해주세요."
              : "접수하지 못했어요. 잠시 후 다시 시도해주세요.",
      );
      setBusy(false);
    }
  };

  const sendText = (id: string, min = 1) => {
    const v = input.trim();
    if (v.length >= min) answer(id, v);
  };
  // 주문번호 칸: 형식이 맞을 때만 받고, "모르는데" 같은 답은 건너뛰기로 본다 (그래야 연락처 단계로 이어진다)
  const [orderWrong, setOrderWrong] = useState(false);
  const sendOrder = () => {
    const v = input.trim();
    const id = normalizeOrderId(v);
    if (id) answer("order", id);
    else if (DONT_KNOW_ORDER.test(v)) answer("order", SKIP);
    else setOrderWrong(true);
  };
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const phoneOk = PHONE.test(contactPhone);
  const contactOk = contactName.trim().length > 0 && phoneOk;

  // 칩을 고르면 고른 칩만 남기고 나머지를 지운 뒤(160ms) 답으로 넘긴다
  const [picked, setPicked] = useState<{ id: string; value: string } | null>(null);
  const pick = (id: string, value: string) => {
    if (picked) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return answer(id, value);
    setPicked({ id, value });
    window.setTimeout(() => {
      setPicked(null);
      answer(id, value);
    }, 200);
  };

  // 현재 질문이 화면 밖이면 필요한 만큼만 스크롤하고, 입력칸이면 포커스
  const currentRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => {
      currentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      fieldRef.current?.focus({ preventScroll: true });
    }, 180);
    return () => window.clearTimeout(id);
  }, [current.id]);

  const chipClass = (selected: boolean, leaving: boolean) =>
    cn(
      "h-[34px] rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.96]",
      selected ? "bg-foreground text-background" : "bg-raised text-foreground edge hover:bg-card",
      leaving && !selected && "scale-95 opacity-0",
    );
  const skipClass = "h-[34px] px-2 text-[13px] text-ink-3 transition-colors hover:text-foreground";
  // 새로 나타나는 요소: 아래에서 살짝 올라오기 (prefers-reduced-motion 이면 globals.css 가 끈다)
  const rise = "animate-in fade-in slide-in-from-bottom-1.5 fill-mode-both duration-300 ease-out";

  const choices = (id: string, options: { value: string; label: string }[], skippable: boolean, label: string) => (
    <div className="flex max-w-[92%] flex-wrap justify-end gap-1.5" role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const selected = picked?.id === id ? picked.value === o.value : done[id] === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => pick(id, o.value)}
            className={cn(chipClass(selected, picked?.id === id), rise)}
            style={{ animationDelay: `${160 + i * 30}ms` }}
          >
            {o.label}
          </button>
        );
      })}
      {skippable && (
        <button type="button" onClick={() => answer(id, SKIP)} className={cn(skipClass, rise)} style={{ animationDelay: `${160 + options.length * 30}ms` }}>
          건너뛰기
        </button>
      )}
    </div>
  );

  // 말풍선 모양 입력칸 + 안쪽 보내기 버튼
  const field = (id: string, opts: { multiline?: boolean; placeholder?: string; mono?: boolean; type?: string; min?: number; skippable?: boolean; note?: React.ReactNode }) => {
    const min = opts.min ?? 1;
    const value = id === "email" ? email : input;
    const ok = id === "email" ? emailOk : value.trim().length >= min;
    return (
      <>
        <form
          className={cn(
            "flex w-[88%] items-end rounded-2xl border border-input bg-card transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25",
            rise,
          )}
          style={{ animationDelay: "140ms" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (id === "email") {
              if (emailOk) answer("email", email.trim());
            } else if (id === "order") sendOrder();
            else sendText(id, min);
          }}
        >
          {opts.multiline ? (
            <textarea
              ref={fieldRef}
              value={value}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
              }}
              placeholder={opts.placeholder}
              rows={3}
              maxLength={3000}
              className="max-h-40 min-h-20 flex-1 resize-none bg-transparent py-2.5 pr-1.5 pl-3.5 text-[14px] leading-relaxed outline-none [field-sizing:content] placeholder:text-ink-3"
            />
          ) : (
            <input
              ref={fieldRef}
              type={opts.type ?? "text"}
              value={value}
              onChange={(e) => {
                if (id === "email") setEmail(e.target.value);
                else setInput(e.target.value);
                setOrderWrong(false);
              }}
              placeholder={opts.placeholder}
              maxLength={200}
              autoComplete={id === "email" ? "email" : "off"}
              className={cn(
                "h-10 min-w-0 flex-1 bg-transparent pr-1.5 pl-3.5 text-[14px] outline-none placeholder:text-ink-3",
                opts.mono && "font-mono text-[13.5px]",
              )}
            />
          )}
          <button
            type="submit"
            aria-label="보내기"
            disabled={!ok}
            className="m-1 grid size-8 shrink-0 place-items-center rounded-xl bg-foreground text-background transition-[opacity,transform] active:scale-[0.92] disabled:opacity-25"
          >
            <ArrowUp className="size-4" strokeWidth={2.2} />
          </button>
        </form>
        {opts.note}
        {opts.skippable && (
          <button type="button" onClick={() => answer(id, SKIP)} className={cn(skipClass, rise)} style={{ animationDelay: "200ms" }}>
            건너뛰기
          </button>
        )}
      </>
    );
  };

  // 비회원 연락처: 이름·휴대폰 두 칸을 한 카드에, 보내기는 휴대폰 칸 안쪽
  const contactForm = () => {
    const phoneWrong = contactPhone.replace(/\D/g, "").length >= 10 && !phoneOk;
    const row = "flex items-center";
    const label = "w-[52px] shrink-0 pl-3.5 text-xs text-ink-3";
    const inputClass = "h-10 min-w-0 flex-1 bg-transparent pr-1.5 text-[14px] outline-none placeholder:text-ink-3";
    return (
      <>
        <form
          className={cn(
            "flex w-[88%] flex-col rounded-2xl border border-input bg-card transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25",
            rise,
          )}
          style={{ animationDelay: "140ms" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (contactOk) answer("contact", "set");
          }}
        >
          <div className={row}>
            <label htmlFor="cstalk-contact-name" className={label}>
              이름
            </label>
            <input
              id="cstalk-contact-name"
              ref={fieldRef}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="홍길동"
              maxLength={50}
              autoComplete="name"
              className={inputClass}
            />
          </div>
          <div className={cn(row, "border-t border-border")}>
            <label htmlFor="cstalk-contact-phone" className={label}>
              휴대폰
            </label>
            <input
              id="cstalk-contact-phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(typePhone(e.target.value))}
              placeholder="010-0000-0000"
              inputMode="tel"
              autoComplete="tel"
              className={cn(inputClass, "font-mono text-[13.5px]")}
            />
            <button
              type="submit"
              aria-label="보내기"
              disabled={!contactOk}
              className="m-1 grid size-8 shrink-0 place-items-center rounded-xl bg-foreground text-background transition-[opacity,transform] active:scale-[0.92] disabled:opacity-25"
            >
              <ArrowUp className="size-4" strokeWidth={2.2} />
            </button>
          </div>
        </form>
        {phoneWrong && <p className="text-right text-[11.5px] text-late-text">휴대폰 번호를 확인해주세요.</p>}
        <p className={cn("max-w-[88%] text-right text-[11.5px] text-ink-3", rise)} style={{ animationDelay: "180ms" }}>
          주문 확인과 문의 답변에만 써요.
        </p>
      </>
    );
  };

  // 회원: 최근 주문 카드 (주문 조회 화면 카드를 고르기용으로 줄인 것)
  const orderCards = () => {
    if (orders === null || orders === "error")
      return (
        <div className="flex w-[88%] flex-col gap-1.5" aria-label="주문 불러오는 중">
          {[0, 1].map((i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-panel-3" />
          ))}
        </div>
      );
    const leaving = picked?.id === "order";
    return (
      <>
        <div className="flex w-[88%] flex-col gap-1.5" role="radiogroup" aria-label="주문 고르기">
          {orders.map((o, i) => {
            const first = o.items[0];
            const selected = leaving ? picked.value === o.orderId : done.order === o.orderId;
            return (
              <button
                key={o.orderId}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  if (picked) return;
                  setPicked({ id: "order", value: o.orderId });
                  window.setTimeout(() => {
                    setPicked(null);
                    chooseOrder(o);
                  }, 220);
                }}
                className={cn(
                  "flex w-full flex-col gap-1.5 rounded-2xl px-3.5 pt-2.5 pb-3 text-left transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.98]",
                  selected ? "bg-foreground text-background" : "bg-raised edge hover:bg-card",
                  leaving && !selected && "scale-[0.97] opacity-0",
                  rise,
                )}
                style={{ animationDelay: `${140 + i * 40}ms` }}
              >
                <span className={cn("flex items-center gap-1.5 text-[11px]", selected ? "text-background/60" : "text-ink-3")}>
                  {first && (
                    <Chip tone={statusTone(first.status)}>
                      <span className="size-1.5 rounded-full bg-current" />
                      {first.status}
                    </Chip>
                  )}
                  <span className="font-mono">{o.orderId}</span>
                  <span className="num ml-auto">{o.orderDate.slice(5).replace("-", ". ")}.</span>
                </span>
                <span className="text-[13.5px] leading-snug font-semibold">
                  {first?.name}
                  <span className={cn("font-normal", selected ? "text-background/60" : "text-muted-foreground")}>
                    {o.items.length > 1 ? ` 외 ${o.items.length - 1}개` : first?.option ? ` · ${first.option}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            setManualOrder(true);
            setInput(done.order ?? "");
          }}
          className={cn(skipClass, rise, leaving && "opacity-0")}
          style={{ animationDelay: `${140 + orders.length * 40}ms` }}
        >
          목록에 없어요 · 직접 입력
        </button>
      </>
    );
  };

  // 고른 주문의 상품 (여러 개 고를 수 있음)
  const itemChips = (o: CustomerOrder) => (
    <>
      <div className="flex max-w-[92%] flex-wrap justify-end gap-1.5" role="group" aria-label="상품 고르기">
        {o.items.map((it, i) => {
          const on = pickedItems.includes(i);
          return (
            <button
              key={i}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => setPickedItems((cur) => (on ? cur.filter((x) => x !== i) : [...cur, i]))}
              className={cn(chipClass(on, false), "h-auto min-h-[34px] py-1.5 text-left whitespace-normal", rise)}
              style={{ animationDelay: `${160 + i * 30}ms` }}
            >
              {itemLabel(it)}
            </button>
          );
        })}
      </div>
      <div className={cn("flex items-center gap-1", rise)} style={{ animationDelay: `${160 + o.items.length * 30}ms` }}>
        <button
          type="button"
          onClick={() => {
            setManualItem(true);
            setInput("");
          }}
          className={skipClass}
        >
          직접 입력
        </button>
        <button
          type="button"
          disabled={pickedItems.length === 0}
          onClick={() => answer("f:item", pickedItems.map((i) => itemLabel(o.items[i])).join(", "))}
          className={cn(chipClass(true, false), "disabled:opacity-40")}
        >
          {pickedItems.length ? `${pickedItems.length}개 선택 · 다음` : "상품을 골라주세요"}
        </button>
      </div>
    </>
  );

  // 현재 질문 아래, 내 답이 들어갈 오른쪽 자리에 보이는 선택지·입력
  const controls = (s: Step) => {
    if (s.id === "order" && orderPick) return orderCards();
    if (s.id === "f:item" && pickedOrder && done.order === pickedOrder.orderId && !manualItem) return itemChips(pickedOrder);
    if (s.id === "category")
      return choices(
        "category",
        INQUIRY_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
        false,
        "문의 유형",
      );
    if ("field" in s && s.field.kind === "choice")
      return choices(
        s.id,
        (s.field.options ?? []).map((o) => ({ value: o, label: o })),
        !s.field.required,
        s.field.label,
      );
    if (s.id === "photos")
      return (
        <div className={cn("flex max-w-[92%] flex-col items-end gap-2", rise)} style={{ animationDelay: "140ms" }}>
          {(photos.items.length > 0 || photos.error) && (
            <AttachmentStrip state={photos} withAdd onAdd={() => fileRef.current?.click()} />
          )}
          <FilePicker state={photos} inputRef={fileRef} />
          <div className="flex gap-1.5">
            {photos.items.length === 0 && (
              <button type="button" onClick={() => fileRef.current?.click()} className={chipClass(false, false)}>
                사진·동영상 추가
              </button>
            )}
            <button
              type="button"
              disabled={photos.uploading}
              onClick={() => answer("photos", photos.ids.length ? "added" : SKIP)}
              className={photos.ids.length ? chipClass(true, false) : skipClass}
            >
              {photos.uploading ? "올리는 중…" : photos.ids.length ? "다음" : "첨부 없이 다음"}
            </button>
          </div>
        </div>
      );
    if (s.id === "contact") return contactForm();
    if (s.id === "email")
      return field("email", {
        type: "email",
        placeholder: "name@example.com",
        skippable: true,
      });
    if (s.id === "confirm")
      return (
        <div className={cn("flex w-full flex-col items-end gap-2", rise)} style={{ animationDelay: "140ms" }}>
          {error && (
            <Notice tone="error" size="sm" className="w-full">
              {error}
            </Notice>
          )}
          <Button type="button" onClick={submit} disabled={busy || photos.uploading} className="h-11 min-w-[60%] rounded-xl px-5 text-[14px]">
            {busy ? "접수 중…" : "문의 접수하기"}
          </Button>
        </div>
      );
    // 텍스트 입력 (주문번호·한 줄 항목·자유 입력)
    const isFree = s.id === "free";
    const required = isFree ? (s as { required: boolean }).required : "field" in s ? Boolean(s.field.required) : false;
    return field(s.id, {
      multiline: isFree,
      min: isFree ? 2 : 1,
      mono: s.id === "order",
      placeholder: s.id === "order" ? "예: 20261017-0000123" : "field" in s ? s.field.placeholder : isFree ? (cat.freePlaceholder ?? (hasRequired ? cat.hint : "내용을 입력하세요")) : "내용을 입력하세요",
      skippable: !required,
      note: s.id === "order" && (
        <>
          {orderWrong && (
            <p role="alert" className="w-[88%] text-right text-xs text-destructive">
              주문번호는 20261017-0000123 형식이에요. 모르시면 건너뛰기를 눌러주세요.
            </p>
          )}
          {/* 비회원에게만: 로그인하면 주문을 바로 고를 수 있다는 한 줄 */}
          {!member && links && (
            <p className={cn("text-right text-xs text-ink-3", rise)} style={{ animationDelay: "180ms" }}>
              로그인하면 주문을 바로 고를 수 있어요 ·{" "}
              <a
                href={links.login}
                target="_top"
                // 로그인하고 돌아오면 지금까지 답한 내용으로 문의를 이어간다
                onClick={() =>
                  nudgeOn &&
                  links.leave("inquiry", "login", {
                    view: "form",
                    prefill: { category, fields: prefill.fields, fromAi: prefill.fromAi ?? undefined, body: prefill.body },
                  })
                }
                className="text-signal-text underline-offset-2 hover:underline"
              >
                로그인
              </a>
            </p>
          )}
        </>
      ),
    });
  };

  const total = done.category ? steps.length : Math.max(steps.length, 6);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 진행 표시: 헤더 아래 2px 바 */}
      <div className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5" aria-hidden>
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out"
          style={{ width: `${((currentIdx + 1) / total) * 100}%` }}
        />
      </div>
      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pt-4 pb-6 [scrollbar-gutter:stable]" aria-live="polite">
        {fromAi && (
          // 방금 AI 와 나눈 대화를 그대로 이어서 보여준다 (새 대화로 넘어간 것처럼 보이지 않게)
          <div className="flex flex-col gap-2">
            <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-foreground px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-background">
              {fromAi.question}
            </p>
            {fromAi.answer && (
              <div className="flex max-w-[85%] flex-col gap-1 self-start">
                <span className="flex items-center gap-1 text-[11px] text-ink-3">
                  <Sparkles className="size-3 text-signal-text" />
                  AI 답변
                </span>
                {/* 줄 자르기는 안쪽 요소에: 패딩이 있는 요소에 걸면 넷째 줄이 패딩 영역에 비친다 */}
                <div className="rounded-2xl rounded-bl-md bg-raised px-3.5 py-2.5 text-[13px] leading-relaxed text-muted-foreground edge">
                  <p className="line-clamp-3 whitespace-pre-wrap">{fromAi.answer}</p>
                </div>
              </div>
            )}
            <p className="self-center pt-1 text-[11px] text-ink-3">위 질문도 담당자에게 함께 전달돼요</p>
          </div>
        )}
        {askLogin && links ? (
          <LoginChoice links={links} prefill={prefill} onGuest={() => setAskLogin(false)} />
        ) : steps.slice(0, Math.max(currentIdx, steps.indexOf(firstUndone ?? steps[steps.length - 1])) + 1).map((s) => {
          const isCurrent = s.id === current.id;
          const shown = s.id === "confirm" ? null : display(s);
          return (
            <div key={s.id} ref={isCurrent ? currentRef : undefined} className="flex scroll-mb-6 flex-col gap-2 [&+&]:mt-1.5">
              <p className={cn("max-w-[82%] self-start rounded-2xl rounded-bl-md bg-raised px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap edge", rise)}>
                {s.ask}
                {s.sub && (
                  <>
                    <br />
                    <span className="text-xs text-ink-3">{s.sub}</span>
                  </>
                )}
              </p>
              {s.id === "confirm" && (
                <p className={cn("max-w-[82%] self-start rounded-2xl rounded-bl-md bg-raised px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground edge", rise)}>
                  {[
                    done.order ? `주문번호: ${done.order}` : "",
                    needContact && done.contact ? `연락처: ${contactName.trim()} · ${contactPhone}` : "",
                    body,
                  ]
                    .filter(Boolean)
                    .join("\n") || "—"}
                </p>
              )}
              {isCurrent ? (
                <div className="flex flex-col items-end gap-1.5">{controls(s)}</div>
              ) : (
                shown !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(s.id);
                      setInput(done[s.id] ?? "");
                    }}
                    title="눌러서 고치기"
                    className={cn(
                      "max-w-[82%] self-end rounded-2xl rounded-br-md px-3.5 py-2.5 text-left text-[13.5px] leading-relaxed whitespace-pre-wrap",
                      "animate-in fade-in zoom-in-95 fill-mode-both origin-bottom-right duration-200 ease-out",
                      done[s.id] === SKIP ? "bg-panel-3 text-muted-foreground edge" : "bg-foreground text-background",
                    )}
                  >
                    {shown}
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
