const API = 'https://www.googleapis.com/calendar/v3';
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export class CalendarError extends Error {
  constructor(message, status) { super(message); this.name = 'CalendarError'; this.status = status; }
}

export async function requestJson(url, token, fetcher = fetch) {
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const messages = {
      401: 'Your Google session has expired. Connect Google Calendar again.',
      403: 'Google denied calendar access. Check the Calendar API is enabled and read access was granted.',
      429: 'Google is receiving too many requests. Please wait before refreshing.',
    };
    throw new CalendarError(messages[response.status] || 'Google Calendar could not be reached. Please try again.', response.status);
  }
  return response.json();
}

export async function listPages(url, token, fetcher = fetch) {
  const result = [];
  let pageToken;
  const seen = new Set();
  do {
    const pageUrl = new URL(url);
    if (pageToken) pageUrl.searchParams.set('pageToken', pageToken);
    const data = await requestJson(pageUrl.toString(), token, fetcher);
    if (!Array.isArray(data.items)) throw new CalendarError('Google returned an incomplete calendar response. Please try again.', 502);
    result.push(...data.items);
    pageToken = data.nextPageToken;
    if (pageToken && seen.has(pageToken)) throw new CalendarError('Google returned repeated pages. Please try again.', 502);
    seen.add(pageToken);
  } while (pageToken);
  return result;
}

export async function readAccount(token, fetcher = fetch) {
  return requestJson('https://www.googleapis.com/oauth2/v2/userinfo', token, fetcher);
}

export async function readSnapshot(token, range, fetcher = fetch) {
  const calendars = (await listPages(`${API}/users/me/calendarList?maxResults=250`, token, fetcher))
    .filter(calendar => calendar.accessRole === 'owner' && !calendar.deleted)
    .map(calendar => ({ id: calendar.id, name: calendar.summaryOverride || calendar.summary || 'Clinic calendar', primary: Boolean(calendar.primary) }));
  if (!calendars.length) throw new CalendarError('No clinic calendars are available for this account.', 403);
  const batches = await Promise.all(calendars.map(async calendar => {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendar.id)}/events`);
    url.search = new URLSearchParams({
      timeMin: range.timeMin, timeMax: range.timeMax,
      singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime',
      timeZone: 'Asia/Kuala_Lumpur', maxResults: '2500',
    }).toString();
    const events = await listPages(url.toString(), token, fetcher);
    return events.filter(event => event.status !== 'cancelled').map(event => ({ ...event, calendarId: calendar.id, calendarName: calendar.name }));
  }));
  // Only replace the previous snapshot after every calendar and page succeeds.
  // Full replacement reflects new, edited, moved and deleted events.
  return { calendars, events: batches.flat() };
}
