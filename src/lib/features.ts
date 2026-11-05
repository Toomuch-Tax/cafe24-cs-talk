import type { WidgetEnv } from "./widget-token";

// 테스트 스킨에서만 켜는 기능 목록. 새 기능은 여기에 'test' 로 추가하고,
// 충분히 검증되면 'live' 로 바꾼다 (코드 분기는 그대로 두고 값만 바꾸면 전체 공개).
export const FEATURES = {
  // 문의 남기기·내 문의 이어쓰기·AI 대화 사진 첨부 (2026-10-21 운영 버킷 비공개 확인, 2026-10-24 전체 공개)
  attachments: "live",
  // 비회원 답변 메일: 문의 폼에서 이메일을 받는다 (발신 도메인 인증·테스트 발송 확인 후 live)
  replyEmail: "test",
  // 비회원 문의에서 주문번호가 없는 주문 관련 유형일 때만 이름·휴대폰을 받아 고객 정보에 저장 (2026-10-26 주문번호 칸에 '모르는데'가 남은 건을 보고 전체 공개)
  guestContact: "live",
  // AI 와 여러 번 주고받기 + 담당자 참여
  aiChat: "live",
  // 비회원에게 로그인·회원가입 권하기: 문의 남기기 직전 선택, 비회원 주문 조회 로그인 카드, 접수 완료 회원가입 안내
  loginNudge: "live",
  // 주문·배송 조회에 들어온 비회원에게 먼저 보여주는 로그인 권유 전체 화면
  ordersGate: "test",
} as const satisfies Record<string, WidgetEnv>;

export type FeatureName = keyof typeof FEATURES;

export const isFeatureOn = (name: FeatureName, env: WidgetEnv) =>
  (FEATURES[name] as WidgetEnv) === "live" || env === "test";
