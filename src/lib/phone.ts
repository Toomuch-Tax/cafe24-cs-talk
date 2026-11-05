// 휴대폰 형식 (위젯·서버 공용, 순수 로직). 하이픈은 있어도 없어도 되고, 저장은 010-1234-5678 형태로.
export const PHONE = /^01[016789]-?\d{3,4}-?\d{4}$/;

export const formatPhone = (v: string) => {
  const d = v.replace(/\D/g, "");
  return `${d.slice(0, 3)}-${d.slice(3, -4)}-${d.slice(-4)}`;
};
