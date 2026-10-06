export const TIME_ZONE = 'Asia/Kuala_Lumpur';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function dateKey(value = new Date()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(key, count) {
  const date = new Date(`${key}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + count);
  return dateKey(date);
}

export function monthRange(month) {
  const [year, number] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = dateKey(new Date(Date.UTC(year, number, 1)));
  return { start, end, timeMin: `${start}T00:00:00+08:00`, timeMax: `${end}T00:00:00+08:00` };
}

export function shiftMonth(month, count) {
  const [year, number] = month.split('-').map(Number);
  return dateKey(new Date(Date.UTC(year, number - 1 + count, 1))).slice(0, 7);
}

export function monthCells(month) {
  const range = monthRange(month);
  const dayOfWeek = new Date(`${range.start}T12:00:00+08:00`).getUTCDay();
  const offset = (dayOfWeek + 6) % 7;
  const first = addDays(range.start, -offset);
  const days = Math.round((new Date(range.timeMax) - new Date(range.timeMin)) / 86400000);
  return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => addDays(first, i));
}

export function eventDates(event, start, end) {
  if (event.status === 'cancelled' || !event.start) return [];
  const allDay = Boolean(event.start.date);
  let first = allDay ? event.start.date : dateKey(event.start.dateTime);
  const lastExclusive = allDay
    ? (event.end?.date || addDays(first, 1))
    : addDays(dateKey(new Date(new Date(event.end?.dateTime || event.start.dateTime).getTime() - 1)), 1);
  if (lastExclusive <= first) return first >= start && first < end ? [first] : [];
  first = first < start ? start : first;
  const result = [];
  for (let day = first; day < lastExclusive && day < end; day = addDays(day, 1)) result.push(day);
  return result;
}

export function groupEvents(events, start, end) {
  const groups = new Map();
  const seen = new Set();
  for (const event of events) {
    const key = `${event.calendarId}:${event.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const day of eventDates(event, start, end)) {
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(event);
    }
  }
  for (const appointments of groups.values()) appointments.sort((a, b) => {
    if (Boolean(a.start.date) !== Boolean(b.start.date)) return a.start.date ? -1 : 1;
    return (a.start.date ? a.start.date.localeCompare(b.start.date) : new Date(a.start.dateTime) - new Date(b.start.dateTime))
      || String(a.summary || '').localeCompare(String(b.summary || ''));
  });
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
}

export function formatDay(key, options = {}) {
  return new Intl.DateTimeFormat('en-MY', { timeZone: TIME_ZONE, ...options }).format(new Date(`${key}T12:00:00+08:00`));
}

export function eventTime(event, day) {
  if (event.start.date) return 'All day';
  const time = value => new Intl.DateTimeFormat('en-MY', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));
  const start = dateKey(event.start.dateTime) < day ? 'Continues' : time(event.start.dateTime);
  const end = event.end?.dateTime;
  return end ? `${start} – ${dateKey(new Date(new Date(end).getTime() - 1)) > day ? 'continues' : time(end)}` : start;
}
