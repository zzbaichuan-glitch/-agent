export type MeetingReminderPrecision = 'exact' | 'period' | 'inferred';

export interface MeetingReminderCandidate {
  title: string;
  startsAt: Date;
  remindAt: Date;
  precision: MeetingReminderPrecision;
  needsConfirmation: boolean;
  matchedText: string;
}

const MEETING_PATTERN = /(?:开会|会议|例会|评审|评审会|讨论会|碰头会|同步会|站会|meeting|meet)/iu;
const DATE_PATTERN = /(?:(今天|明天|后天)|((?:20\d{2})[-年](\d{1,2})[-月](\d{1,2})日?)|(下?周)([一二三四五六日天1-7]))/u;
const CLOCK_PATTERN = /(?:(上午|早上|下午|晚上|今晚|中午)\s*)?(\d{1,2})(?:(?:[:：](\d{1,2}))|(?:[点时](\d{1,2})?分?))/u;
const PERIOD_PATTERN = /(上午|早上|下午|晚上|今晚|中午)/u;

const PERIOD_DEFAULTS: Record<string, number> = {
  上午: 9,
  早上: 9,
  下午: 15,
  晚上: 19,
  今晚: 19,
  中午: 12,
};

export function extractMeetingReminder(
  text: string,
  now = new Date(),
): MeetingReminderCandidate | null {
  const meeting = text.match(MEETING_PATTERN);
  if (!meeting || meeting.index === undefined) return null;

  const dateMatch = text.match(DATE_PATTERN);
  const timeMatch = text.match(CLOCK_PATTERN);
  const periodMatch = text.match(PERIOD_PATTERN);
  const date = resolveDate(dateMatch, now);
  const time = resolveTime(timeMatch, periodMatch);
  if (!date || !time) return null;

  const startsAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour, time.minute, 0, 0);
  if (!dateMatch && !timeMatch && !periodMatch) return null;
  if (!dateMatch && startsAt.getTime() <= now.getTime()) {
    startsAt.setDate(startsAt.getDate() + 1);
  }

  const precision: MeetingReminderPrecision = time.inferred
    ? periodMatch ? 'period' : 'inferred'
    : dateMatch ? 'exact' : 'inferred';
  const needsConfirmation = precision !== 'exact';
  const remindAt = new Date(startsAt.getTime() - (needsConfirmation ? 60 : 30) * 60_000);
  const contextStart = Math.max(0, (dateMatch?.index ?? periodMatch?.index ?? timeMatch?.index ?? meeting.index) - 32);
  const contextEnd = Math.min(text.length, contextStart + 140);

  return {
    title: buildTitle(text, meeting.index),
    startsAt,
    remindAt,
    precision,
    needsConfirmation,
    matchedText: text.slice(contextStart, contextEnd).replace(/\s+/g, ' ').trim(),
  };
}

function resolveDate(match: RegExpMatchArray | null, now: Date): Date | null {
  if (!match) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const relative = match[1];
  if (relative) {
    const delta = relative === '明天' ? 1 : relative === '后天' ? 2 : 0;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta);
  }
  if (match[2] && match[3] && match[4]) {
    return new Date(Number(match[2]), Number(match[3]) - 1, Number(match[4]));
  }
  const weekPrefix = match[5];
  const dayValue = match[6];
  if (!weekPrefix || !dayValue) return null;
  const target = chineseWeekday(dayValue);
  if (target === null) return null;
  const current = now.getDay();
  let delta = (target - current + 7) % 7;
  if (weekPrefix === '下周' || delta === 0) delta += 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta);
}

function resolveTime(
  clock: RegExpMatchArray | null,
  period: RegExpMatchArray | null,
): { hour: number; minute: number; inferred: boolean } | null {
  if (!clock && !period) return null;
  const periodName = clock?.[1] ?? period?.[1];
  const rawHour = clock?.[2];
  const rawMinute = clock?.[3] ?? clock?.[4];
  const hour = rawHour ? Number(rawHour) : periodName ? PERIOD_DEFAULTS[periodName] : null;
  if (hour === null || hour === undefined || hour > 23) return null;
  let normalizedHour = hour;
  if (periodName && ['下午', '晚上', '今晚'].includes(periodName) && hour < 12 && rawHour) normalizedHour += 12;
  if (periodName === '中午' && hour < 11 && rawHour) normalizedHour += 12;
  const minute = rawMinute ? Number(rawMinute) : 0;
  if (minute > 59) return null;
  return { hour: normalizedHour, minute, inferred: !rawHour || !rawMinute };
}

function chineseWeekday(value: string): number | null {
  const map: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  if (/^[1-7]$/.test(value)) return Number(value) % 7;
  return map[value] ?? null;
}

function buildTitle(text: string, meetingIndex: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const prefix = compact.slice(Math.max(0, meetingIndex - 28), Math.min(compact.length, meetingIndex + 52));
  return prefix || '飞书会议提醒';
}
