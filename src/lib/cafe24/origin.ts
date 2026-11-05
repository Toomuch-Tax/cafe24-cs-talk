// Cafe24 개발자센터에 등록한 Redirect URI 와 정확히 같아야 하므로, 배포 주소가 여러 개여도 고정 주소를 쓴다
export function appOrigin(request: Request) {
  return process.env.APP_ORIGIN ?? new URL(request.url).origin;
}
