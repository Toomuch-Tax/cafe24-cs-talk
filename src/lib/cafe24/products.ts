import { captureError } from "../errors";
import { cafe24Get } from "./client";

// AI 가 사이즈·재입고 질문에 답할 때 쓰는 상품 정보 (mall.read_product).
// Cafe24 응답 필드는 버전에 따라 달라질 수 있어 방어적으로 읽고, 실패하면 상품 정보 없이 진행한다.

export type ProductContext = {
  productNo: number;
  name: string;
  soldOut: boolean | null;
  summary: string | null;
  sizeGuide: string | null;
  options: { label: string; available: boolean | null }[];
};

// https://<쇼핑몰>/product/<slug>/<product_no>/category/... → product_no
export function productNoFromUrl(url: string | null | undefined) {
  if (!url) return null;
  const m = url.match(/\/product\/[^/?#]+\/(\d+)/) ?? url.match(/[?&]product_no=(\d+)/);
  return m ? Number(m[1]) : null;
}

const strip = (html: unknown) =>
  typeof html === "string" ? html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() : "";

// 사이즈 가이드(HTML 표) → "SIZE | 허리 | 총장" 형태의 줄 텍스트
function tableToText(html: unknown) {
  if (typeof html !== "string" || !html.includes("<")) return null;
  const text = html
    .replace(/<\/(th|td)>/gi, " | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").replace(/(\s*\|\s*)+$/, "").replace(/^(\s*\|\s*)+/, "").trim())
    .filter((l) => l.replace(/[|\s]/g, "").length > 0)
    .join("\n");
  return text.slice(0, 1500) || null;
}

type RawVariant = {
  options?: { name?: string; value?: string }[] | null;
  display?: string;
  selling?: string;
  quantity?: number;
  inventories?: { quantity?: number; use_inventory?: string } | null;
};

export async function productContext(productNo: number): Promise<ProductContext | null> {
  try {
    const { product } = await cafe24Get<{ product: Record<string, unknown> }>(`/products/${productNo}?shop_no=1`);
    // 없는(삭제된) 상품은 빈 객체가 온다
    if (!product || !product.product_name) return null;
    let variants: RawVariant[] = [];
    try {
      ({ variants } = await cafe24Get<{ variants: RawVariant[] }>(`/products/${productNo}/variants?shop_no=1&embed=inventories`));
    } catch (err) {
      captureError({ source: "external", where: "cafe24 product variants", area: "ai", err });
      variants = [];
    }
    const options = (variants ?? [])
      .filter((v) => v.display !== "F")
      .map((v) => {
        const label = (v.options ?? []).map((o) => o.value).filter(Boolean).join(" / ") || "기본";
        const qty = v.inventories?.quantity ?? v.quantity;
        const tracked = v.inventories?.use_inventory !== "F";
        const available = v.selling === "F" ? false : typeof qty === "number" && tracked ? qty > 0 : null;
        return { label, available };
      });
    const soldOutFlag = product.sold_out;
    return {
      productNo,
      name: String(product.product_name ?? ""),
      soldOut: soldOutFlag === "T" ? true : soldOutFlag === "F" ? false : null,
      summary: strip(product.summary_description || product.simple_description).slice(0, 600) || null,
      sizeGuide: tableToText((product.size_guide as { use?: string; description?: unknown } | null)?.description),
      options,
    };
  } catch (err) {
    captureError({ source: "external", where: "cafe24 product", area: "ai", err });
    return null;
  }
}

export function describeProduct(p: ProductContext) {
  const lines = [`상품명: ${p.name}`];
  if (p.summary) lines.push(`요약: ${p.summary}`);
  if (p.sizeGuide) lines.push(`실측 사이즈표 (cm):\n${p.sizeGuide}`);
  if (p.options.length) {
    lines.push(
      "옵션별 온라인 재고: " +
        p.options.map((o) => `${o.label}=${o.available === true ? "구매 가능" : o.available === false ? "품절" : "확인 불가"}`).join(", "),
    );
  } else if (p.soldOut !== null) {
    lines.push(`온라인 재고: ${p.soldOut ? "품절" : "구매 가능"}`);
  }
  return lines.join("\n");
}
