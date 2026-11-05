import type { NextConfig } from "next";

// 위젯 iframe 을 띄울 수 있는 쇼핑몰 도메인만 허용 (clickjacking 방지)
const widgetAncestors = (process.env.WIDGET_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .join(" ");

const nextConfig: NextConfig = {
  // 첫 화면은 인박스. 페이지에서 redirect() 하면 개발 서버가 요청마다 instant 검증 오류를 남겨서 설정으로 둔다
  async redirects() {
    return [{ source: "/", destination: "/inbox", permanent: false }];
  },
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
