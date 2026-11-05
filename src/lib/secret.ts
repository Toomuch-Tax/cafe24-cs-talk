// 서명 키가 비어 있거나 짧으면 요청을 처리하지 않는다 (빈 키로 서명된 토큰은 누구나 위조 가능)
export function secretKey(name: "SESSION_SECRET" | "WIDGET_TOKEN_SECRET") {
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error(`${name} is missing or too short`);
  return new TextEncoder().encode(value);
}
