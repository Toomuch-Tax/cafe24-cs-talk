import type { NextConfig } from "next";

// 위젯 iframe 을 띄울 수 있는 쇼핑몰 도메인만 허용 (clickjacking 방지)
const widgetAncestors = (process.env.WIDGET_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .join(" ");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/widget",
        headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${widgetAncestors}` }],
      },
      {
        // 위젯 이외의 화면(인박스 등)은 iframe 삽입 금지
        source: "/((?!widget).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/widget.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, s-maxage=3600" }],
      },
    ];
  },
};

export default nextConfig;
