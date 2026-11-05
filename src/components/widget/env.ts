"use client";

import { createContext, useContext } from "react";
import { type FeatureName, isFeatureOn } from "@/lib/features";
import type { WidgetEnv } from "@/lib/widget-token";

export const WidgetEnvContext = createContext<WidgetEnv>("live");

// 위젯 하위 컴포넌트에서 미공개 기능 노출 여부를 확인한다
export const useFeature = (name: FeatureName) => isFeatureOn(name, useContext(WidgetEnvContext));
