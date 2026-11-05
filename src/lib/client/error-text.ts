import { ApiError } from "./api";

// 운영자에게 보이는 실패 이유. 오류 코드는 본문에 쓰지 않고 code 로 따로 넘긴다(작은 회색 글씨로만 표시).
const REASON: Record<string, string> = {
  unauthorized: "로그인이 풀렸어요. 다시 로그인해주세요.",
  forbidden: "관리자만 바꿀 수 있어요.",
  not_found: "이미 지워졌거나 찾을 수 없어요. 새로고침해주세요.",
  invalid_body: "입력한 내용을 다시 확인해주세요.",
  invalid_json: "입력한 내용을 다시 확인해주세요.",
  rate_limited: "요청이 너무 많아요. 잠시 후 다시 시도해주세요.",
  reconnect_required: "Cafe24 연결이 끊겼어요. 설정에서 다시 연결한 뒤 시도해주세요.",
  cafe24_reconnect_required: "Cafe24 연결이 끊겼어요. 설정에서 다시 연결한 뒤 시도해주세요.",
  cafe24_not_connected: "Cafe24 가 아직 연결되지 않았어요. 설정에서 연결해주세요.",
  cannot_change_self: "내 권한·상태는 직접 바꿀 수 없어요. 다른 관리자에게 부탁해주세요.",
  last_admin: "관리자가 한 명은 남아 있어야 해요. 다른 사람을 먼저 관리자로 지정해주세요.",
  already_exists: "이미 등록된 이메일이에요.",
  domain_not_allowed: "회사 구글 계정(허용 도메인) 이메일만 등록할 수 있어요.",
  has_history: "상담 기록이 있는 계정은 삭제 대신 비활성화해주세요.",
  google_not_configured: "구글 로그인이 아직 설정되지 않았어요.",
  link_google_first: "먼저 구글 계정으로 한 번 로그인한 뒤 끌 수 있어요.",
  invalid_image: "PNG·JPG·WEBP 이미지만 올릴 수 있어요.",
  image_too_large: "이미지가 너무 커요. 더 작은 이미지를 올려주세요.",
  conflict: "다른 곳에서 이미 바뀌었어요. 새로고침해주세요.",
  internal_error: "서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.",
  request_failed: "서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.",
};

export function errorReason(err: unknown): { reason: string; code?: string } {
  if (err instanceof ApiError) {
    const key = err.code.split(":")[0];
    const code = err.detail ? `${err.code} · ${err.detail}` : err.code;
    return { reason: REASON[key] ?? "잠시 후 다시 시도해주세요.", code };
  }
  // fetch 자체가 실패 = 네트워크 문제
  if (err instanceof TypeError) return { reason: "인터넷 연결을 확인해주세요." };
  return { reason: "잠시 후 다시 시도해주세요." };
}
