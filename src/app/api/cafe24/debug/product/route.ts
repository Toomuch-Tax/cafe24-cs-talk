import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { cafe24Get } from "@/lib/cafe24/client";
import { productContext } from "@/lib/cafe24/products";
import { handle, HttpError, json } from "@/lib/http";

// 관리자 진단용: Cafe24 상품 응답의 형태(필드 이름)와 AI 에 넘어가는 상품 정보를 확인
export const GET = handle(async (request: NextRequest) => {
  await requireAdmin(request);
  const no = Number(new URL(request.url).searchParams.get("no"));
  if (!no) throw new HttpError(400, "missing_no");
  const shape = (o: unknown) =>
    o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : typeof v])) : o;
  const tryGet = async (path: string) => {
    try {
      const r = await cafe24Get<Record<string, unknown>>(path);
      return { ok: true, keys: Object.keys(r), sample: r };
    } catch (err) {
      return { ok: false, error: err instanceof HttpError ? `${err.message} ${"detail" in err ? String(err.detail) : ""}` : String(err) };
    }
  };
  const product = await tryGet(`/products/${no}?shop_no=1`);
  const variants = await tryGet(`/products/${no}/variants?shop_no=1&embed=inventories`);
  const p = product.ok ? (product.sample as { product?: unknown }).product : null;
  const v = variants.ok ? ((variants.sample as { variants?: unknown[] }).variants ?? []) : [];
  return json({
    raw: product.ok ? JSON.stringify(product.sample).slice(0, 1500) : null,
    rawVariants: variants.ok ? JSON.stringify(variants.sample).slice(0, 1500) : null,
    product: product.ok ? { keys: product.keys, productShape: shape(p) } : product,
    sizeFields: p && typeof p === "object"
      ? Object.fromEntries(
          ["size_guide", "product_material", "cloth_fabric", "additional_information", "simple_description"].map((k) => [
            k,
            JSON.stringify((p as Record<string, unknown>)[k] ?? null).slice(0, 600),
          ]),
        )
      : null,
    variants: variants.ok ? { count: v.length, first: v[0] ?? null } : variants,
    context: await productContext(no),
  });
});
