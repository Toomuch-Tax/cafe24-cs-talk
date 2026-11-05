import { getStoredAvatar } from "@/lib/profile";

// 고객에게 보이는 로고. 주소에 ?v=<내용 해시> 가 붙어 있어 CDN 에 오래 캐시해도 바뀌면 새 주소가 된다.
export async function GET(request: Request) {
  const avatar = await getStoredAvatar();
  if (!avatar) return new Response(null, { status: 404 });
  const fresh = new URL(request.url).searchParams.get("v") === avatar.v;
  return new Response(Buffer.from(avatar.data, "base64"), {
    headers: {
      "content-type": avatar.type,
      "x-content-type-options": "nosniff",
      "cache-control": fresh ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=60, s-maxage=60",
    },
  });
}
