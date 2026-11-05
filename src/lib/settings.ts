import { sql } from "./db";

export type BusinessHours = {
  timezone: string;
  days: number[]; // 0=일 ... 6=토
  start: string; // "10:00"
  end: string;
  lunch?: { start: string; end: string } | null;
};

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await sql<{ value: T }[]>`select value from settings where key = ${key}`;
  return row?.value ?? null;
}

export async function setSetting(key: string, value: unknown) {
  await sql`
    insert into settings (key, value, updated_at) values (${key}, ${sql.json(value as never)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function isWithinBusinessHours(hours: BusinessHours, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const minutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));

  if (!hours.days.includes(day)) return false;
  if (minutes < toMinutes(hours.start) || minutes >= toMinutes(hours.end)) return false;
  if (hours.lunch && minutes >= toMinutes(hours.lunch.start) && minutes < toMinutes(hours.lunch.end)) return false;
  return true;
}

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatBusinessHours(hours: BusinessHours) {
  const days = [...hours.days].sort();
  const weekdays = days.join(",") === "1,2,3,4,5";
  const dayText = weekdays ? "평일" : days.map((d) => DAY_LABELS[d]).join("·");
  const lunch = hours.lunch ? ` · 점심 ${hours.lunch.start}–${hours.lunch.end}` : "";
  return `${dayText} ${hours.start}–${hours.end}${lunch}`;
}

// 고객에게 보여 줄 운영 시간 문구와 지금 운영 중인지 (위젯 세션·AI 프롬프트 공통). 공휴일은 따로 계산하지 않아 문구로만 알린다
export async function businessHoursNow() {
  const hours = await getSetting<BusinessHours>("business_hours");
  if (!hours) return null;
  const holiday = hours.days.includes(0) || hours.days.includes(6) ? " · 공휴일 휴무" : " · 주말·공휴일 휴무";
  return { text: `${formatBusinessHours(hours)}${holiday}`, open: isWithinBusinessHours(hours) };
}
