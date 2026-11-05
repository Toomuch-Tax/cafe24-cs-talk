"use client";

import dynamic from "next/dynamic";

// window/postMessage 에 의존하므로 서버 렌더링하지 않는다
export const WidgetClient = dynamic(() => import("./widget-app").then((m) => m.WidgetApp), { ssr: false });
