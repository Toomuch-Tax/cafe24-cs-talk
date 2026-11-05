import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAgent } from "@/lib/auth";
import { Cafe24Error, cafe24Get, cafe24Request } from "@/lib/cafe24/client";
import { appOrigin } from "@/lib/cafe24/origin";
import { handle, HttpError, json, parseBody } from "@/lib/http";
import { TEST_SKIN_NO } from "@/lib/brand";

type ScriptTag = {
  script_no: number;
  client_id: string;
  src: string;
  display_location: string[];
  exclude_path?: string[];
  skin_no?: number[];
  created_date?: string;
  updated_date?: string;
};

const isNotFound = (err: unknown) => err instanceof Cafe24Error && err.status === 404;

// Cafe24 목록 API 는 삭제 직후에도 지운 스크립트를 한동안 돌려준다(2026-10-18 운영 로그로 확인).
// 그래서 목록에 있는 우리 스크립트는 단건 조회로 실제로 남아 있는지 한 번 더 확인한다.
const ourTags = async () => {
  const { scripttags } = await cafe24Get<{ scripttags: ScriptTag[] }>("/scripttags?shop_no=1");
  const listed = scripttags.filter((t) => t.client_id === process.env.CAFE24_CLIENT_ID);
  const alive = await Promise.all(
    listed.map((t) =>
      cafe24Get(`/scripttags/${t.script_no}?shop_no=1`).then(
        () => true,
        (err) => {
          if (isNotFound(err)) return false;
          throw err;
        },
      ),
    ),
  );
  return listed.filter((_, i) => alive[i]);
};

// 이미 지워진 스크립트를 다시 지우는 건 성공으로 본다
const deleteTag = (scriptNo: number) =>
  cafe24Request("DELETE", `/scripttags/${scriptNo}?shop_no=1`).catch((err) => {
    if (!isNotFound(err)) throw err;
  });

// 테스트 스킨: 이 스킨에만 test 스크립트를 설치한다 (<쇼핑몰>/skin-skin<번호> 로 접근하는 화면, 번호는 src/lib/brand.ts)
const TEST_SKIN_CODE = `skin${TEST_SKIN_NO}`;

// ScriptTag 의 skin_no 는 폴더/미리보기 주소의 번호(skinNN)가 아니라 Cafe24 테마의 skin_no 다.
// 테마 목록에서 skin_code 로 찾는다 ("Theme code is not valid" 방지).
const testSkinNumber = async () => {
  const { themes } = await cafe24Get<{ themes: { skin_no: number; skin_code: string }[] }>("/themes?shop_no=1");
  const theme = themes.find((t) => t.skin_code === TEST_SKIN_CODE);
  if (!theme) throw new HttpError(404, "test_skin_not_found");
  return theme.skin_no;
};

type Mode = "live" | "test" | "legacy";
const modeOf = (src: string): Mode => {
  const mode = new URL(src).searchParams.get("mode");
  return mode === "test" ? "test" : mode === "preview" ? "legacy" : "live";
};

// 쇼핑몰에 위젯이 설치돼 있는지 / 어떤 모드인지
export const GET = handle(async (request: NextRequest) => {
  await requireAgent(request);
  const tags = await ourTags();
  return json({
    installed: tags.length > 0,
    testSkinNo: TEST_SKIN_NO,
    tags: tags.map((t) => ({
      scriptNo: t.script_no,
      src: t.src,
      mode: modeOf(t.src),
      // 설치 문제 진단용 원본 값
      displayLocation: t.display_location,
      skinNo: t.skin_no ?? null,
      excludePath: t.exclude_path ?? null,
      updatedDate: t.updated_date ?? null,
    })),
  });
});

const Body = z.object({ mode: z.enum(["live", "test"]) });
const MODE_NAME = { live: "전체 공개", test: `테스트 (${TEST_SKIN_CODE})`, legacy: "예전 테스트 모드" } as const;

// 설치 또는 갱신. live: 모든 스킨(테스트 스킨 미리보기는 제외), test: 테스트 스킨에만.
// live 와 test 는 별개 스크립트라 따로 설치·제거한다.
export const POST = handle(async (request: NextRequest) => {
  const me = await requireAdmin(request);
  const { mode } = await parseBody(request, Body);
  const src = new URL("/widget.js", appOrigin(request));
  src.searchParams.set("cid", process.env.CAFE24_CLIENT_ID!);
  if (mode === "test") src.searchParams.set("mode", "test");
  else src.searchParams.set("testskin", String(TEST_SKIN_NO));

  const request_ = {
    src: src.toString(),
    display_location: ["all"],
    ...(mode === "test" ? { skin_no: [await testSkinNumber()] } : {}),
  };
  const tags = await ourTags();
  const same = tags.filter((t) => modeOf(t.src) === mode);
  // 예전 '테스트 모드'(preview) 스크립트와 같은 모드의 중복본은 정리한다
  for (const t of tags) {
    if (modeOf(t.src) === "legacy" || (modeOf(t.src) === mode && t !== same[0])) await deleteTag(t.script_no);
  }
  if (same.length) {
    await cafe24Request("PUT", `/scripttags/${same[0].script_no}`, {
      shop_no: 1,
      request: request_,
    });
  } else {
    await cafe24Request("POST", "/scripttags", {
      shop_no: 1,
      request: request_,
    });
  }
  await audit(me, {
    area: "widget",
    action: same.length ? "widget.update" : "widget.install",
    title: `위젯 ${same.length ? "다시 설치" : "설치"} — ${MODE_NAME[mode]}`,
    changes: [
      ...(same.length ? [] : [{ label: "위젯", before: "설치 안 됨", after: "설치됨" }]),
      { label: "적용 스킨", after: mode === "test" ? `${TEST_SKIN_CODE} 만` : `모든 스킨 (${TEST_SKIN_CODE} 미리보기 제외)` },
    ],
  });
  return json({ ok: true, mode });
});

// ?mode=live|test 로 하나만, 없으면 전부 제거
export const DELETE = handle(async (request: NextRequest) => {
  const me = await requireAdmin(request);
  const only = new URL(request.url).searchParams.get("mode");
  const removed = new Set<Mode>();
  for (const t of await ourTags()) {
    if (!only || modeOf(t.src) === only || modeOf(t.src) === "legacy") {
      await deleteTag(t.script_no);
      removed.add(modeOf(t.src));
    }
  }
  for (const m of removed) {
    await audit(me, {
      area: "widget",
      action: "widget.remove",
      title: `위젯 제거 — ${MODE_NAME[m]}`,
      changes: [{ label: "위젯", before: "설치됨", after: "제거됨" }],
    });
  }
  return json({ ok: true });
});
