import type { Metadata } from "next";
import { WidgetClient } from "@/components/widget/widget-client";
import { SUPPORT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: SUPPORT_NAME };

export default function WidgetPage() {
  return <WidgetClient />;
}
