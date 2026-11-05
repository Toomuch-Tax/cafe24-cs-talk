import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Cafe24Error, cafe24Get } from "@/lib/cafe24/client";
import { productNoFromUrl } from "@/lib/cafe24/products";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

// 상품별 정책에 붙일 상품 찾기: 상품 페이지 주소·상품 번호면 그 상품, 아니면 상품명으로 검색
type Row = { product_no: number; product_name: string; tiny_image?: string | null; small_image?: string | null; list_image?: string | null };
const FIELDS = "product_no,product_name,tiny_image,small_image,list_image";

// 고르기 편하게 썸네일을 같이 준다. Cafe24 이미지 주소는 "//..." 나 http 로 올 때가 있어 https 로 맞춘다
const image = (p: Partial<Row>) => {
  const url = p.tiny_image || p.small_image || p.list_image;
  return url ? url.replace(/^(https?:)?\/\//, "https://") : null;
};

export const GET = handle(async (request: NextRequest) => {
  const agent = await requireAdmin(request);
  await rateLimit(`policy_products:${agent.id}`, 60, 600);
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 1) throw new HttpError(400, "missing_q");
  const no = /^\d+$/.test(q) ? Number(q) : productNoFromUrl(q);
  try {
    if (no) {
      const { product } = await cafe24Get<{ product: Partial<Row> }>(`/products/${no}?shop_no=1&fields=${FIELDS}`);
      return json({ products: product?.product_name ? [{ no, name: product.product_name, image: image(product) }] : [] });
    }
    const { products } = await cafe24Get<{ products: Row[] }>(
      `/products?shop_no=1&fields=${FIELDS}&limit=20&product_name=${encodeURIComponent(q)}`,
    );
    return json({ products: (products ?? []).map((p) => ({ no: p.product_no, name: p.product_name, image: image(p) })) });
  } catch (err) {
    if (err instanceof Cafe24Error && err.status === 404) return json({ products: [] });
    throw err;
  }
});
