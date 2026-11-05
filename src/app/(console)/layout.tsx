import { ConsoleShell } from "@/components/inbox/app-shell";

// 상담·AI 응대·정책·설정이 같은 틀(독·배경)을 함께 쓴다 → 메뉴를 옮겨도 틀은 그대로, 오른쪽 내용만 바뀐다
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
