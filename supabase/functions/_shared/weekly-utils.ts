export function tzOffsetMillis(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get   = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  let hour    = get('hour');
  if (hour === 24) hour = 0;
  const tzMs  = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return tzMs - date.getTime();
}

export function melbourneLocalToUtc(year: number, month: number, day: number, hh = 0, mm = 0, ss = 0, ms = 0): Date {
  const naive  = new Date(Date.UTC(year, month - 1, day, hh, mm, ss, ms));
  const offset = tzOffsetMillis(naive, 'Australia/Melbourne');
  return new Date(naive.getTime() - offset);
}

export function getPreviousWeekRange(): { weekStart: string; weekEnd: string; monLabel: string; sunLabel: string; } {
  const now    = new Date();
  const offset = tzOffsetMillis(now, 'Australia/Melbourne');
  const melb   = new Date(now.getTime() + offset);
  const dow    = melb.getUTCDay();
  const daysSinceMon = dow === 0 ? 6 : dow - 1;
  const prevMonDay   = melb.getUTCDate() - daysSinceMon - 7;
  const prevSunDay   = prevMonDay + 6;
  const weekStartUtc = melbourneLocalToUtc(melb.getUTCFullYear(), melb.getUTCMonth() + 1, prevMonDay, 0, 0, 0, 0);
  const weekEndUtc   = melbourneLocalToUtc(melb.getUTCFullYear(), melb.getUTCMonth() + 1, prevSunDay, 23, 59, 59, 999);
  const fmt = (d: Date) => d.toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short' });
  return { weekStart: weekStartUtc.toISOString(), weekEnd: weekEndUtc.toISOString(), monLabel: fmt(weekStartUtc), sunLabel: fmt(weekEndUtc) };
}
