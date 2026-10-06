import { CONFIG } from './config.js';
import { dateKey, addDays, monthRange, monthCells, shiftMonth, groupEvents, formatDay, eventTime } from './calendar.js';
import { SCOPES, readAccount, readSnapshot } from './google-calendar.js';
import { assignCalendarColours } from './calendar-colours.js';

const $ = id => document.getElementById(id);
const storageKey = 'inocare-google-web-client-id';
let savedClientId = '';
try { savedClientId = localStorage.getItem(storageKey) || ''; } catch { /* Configuration still works without storage. */ }
const state = {
  month: dateKey().slice(0, 7), selectedDate: dateKey(), view: 'day',
  token: '', expiry: 0, expiryTimer: null, sequence: 0, loading: false,
  events: null, loadedMonth: null, calendars: [], selectedCalendars: new Set(),
  lastSuccess: null, lastAttempt: 0, retryAfter: 0, demo: false,
};

function element(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [key, value] of Object.entries(options)) {
    if (key !== 'class' && key !== 'text') node.setAttribute(key, String(value));
  }
  node.append(...children);
  return node;
}

function notice(message = '', info = false) {
  $('notice').hidden = !message;
  $('notice').className = info ? 'notice info' : 'notice';
  $('notice').textContent = message;
}

function viewGroups() {
  const range = monthRange(state.month);
  return groupEvents((state.events || []).filter(event => state.selectedCalendars.has(event.calendarId)), range.start, range.end);
}

function hasData() { return state.events !== null && state.loadedMonth === state.month; }

function colourCalendar(node, calendarId) {
  const calendar = state.calendars.find(item => item.id === calendarId);
  if (calendar) {
    node.style.setProperty('--calendar-colour', calendar.colour);
    node.style.setProperty('--calendar-tint', calendar.tint);
  }
  return node;
}

function render() {
  const groups = viewGroups();
  const ready = hasData();
  const today = dateKey();
  $('month-title').textContent = formatDay(`${state.month}-01`, { month: 'long', year: 'numeric' });
  $('today-label').textContent = today.slice(0, 7) === state.month
    ? formatDay(today, { day: 'numeric', month: 'short' }) : 'Open the current month';
  $('selected-label').textContent = formatDay(state.selectedDate, { day: 'numeric', month: 'short', year: 'numeric' });
  $('month-label').textContent = formatDay(`${state.month}-01`, { month: 'long', year: 'numeric' });
  $('today-count').textContent = ready && today.slice(0, 7) === state.month ? (groups.get(today)?.length || 0) : '—';
  $('selected-count').textContent = ready ? (groups.get(state.selectedDate)?.length || 0) : '—';
  $('month-count').textContent = ready
    ? new Set([...groups.values()].flat().map(event => `${event.calendarId}:${event.id}`)).size : '—';
  $('refresh-button').disabled = !state.token || state.loading;
  $('disconnect-button').hidden = !state.token && !state.demo;
  $('connect-panel').hidden = Boolean(state.token) || state.demo;
  $('calendar-filters').hidden = !state.calendars.length;
  $('calendar-range-status').textContent = state.loading ? 'Loading this month…' : ready
    ? `${state.demo ? 'Sample' : 'Google Calendar'} · ${state.selectedCalendars.size} calendars selected`
    : state.token ? 'This month has not loaded yet' : 'Connect to load appointments';
  $('appointments-title').textContent = state.view === 'month'
    ? formatDay(`${state.month}-01`, { month: 'long', year: 'numeric' })
    : formatDay(state.selectedDate, { weekday: 'long', day: 'numeric', month: 'long' });
  $('day-view').setAttribute('aria-pressed', String(state.view === 'day'));
  $('month-view').setAttribute('aria-pressed', String(state.view === 'month'));
  renderCalendar(groups, ready);
  renderAppointments(groups, ready);
}

function renderCalendar(groups, ready) {
  const focusedDate = document.activeElement?.dataset?.date;
  const fragment = document.createDocumentFragment();
  for (const day of monthCells(state.month)) {
    const events = ready ? groups.get(day) || [] : [];
    const outside = day.slice(0, 7) !== state.month;
    const selected = day === state.selectedDate;
    const button = element('button', {
      type: 'button', class: `day-cell${outside ? ' outside' : ''}${selected ? ' selected' : ''}${day === dateKey() ? ' today' : ''}`,
      'data-date': day, 'aria-pressed': selected, tabindex: selected ? '0' : '-1',
      'aria-label': `${formatDay(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${ready && !outside ? `, ${events.length} appointments` : ''}`,
    }, element('span', { class: 'day-number', text: Number(day.slice(-2)) }));
    if (day === dateKey()) button.setAttribute('aria-current', 'date');
    for (const event of events.slice(0, 2)) button.append(colourCalendar(element('span', { class: 'day-event', text: event.summary || 'Untitled appointment', 'aria-hidden': 'true' }), event.calendarId));
    if (events.length) {
      const swatches = element('span', { class: 'day-calendar-swatches', 'aria-hidden': 'true' });
      for (const id of new Set(events.map(event => event.calendarId))) swatches.append(colourCalendar(element('span', { class: 'calendar-swatch' }), id));
      button.append(swatches);
    }
    if (events.length) button.append(element('span', { class: 'day-count', text: `${events.length} appt${events.length === 1 ? '' : 's'}`, 'aria-hidden': 'true' }));
    button.addEventListener('click', () => selectDate(day));
    button.addEventListener('keydown', event => {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (!(event.key in offsets)) return;
      event.preventDefault();
      selectDate(addDays(day, offsets[event.key]));
      $('calendar-grid').querySelector(`[data-date="${state.selectedDate}"]`)?.focus();
    });
    fragment.append(button);
  }
  $('calendar-grid').replaceChildren(fragment);
  if (focusedDate) $('calendar-grid').querySelector(`[data-date="${focusedDate}"]`)?.focus();
}

function renderAppointments(groups, ready) {
  const list = $('appointment-list');
  const visible = state.view === 'day'
    ? new Map(groups.has(state.selectedDate) ? [[state.selectedDate, groups.get(state.selectedDate)]] : []) : groups;
  if (!ready || !visible.size) {
    const heading = !ready
      ? (state.loading ? 'Loading appointments…' : state.token ? 'Appointments unavailable' : 'Connect to view appointments')
      : !state.selectedCalendars.size ? 'No calendars selected' : 'No appointments';
    const description = !ready
      ? (state.token ? 'The calendar and list will appear after a successful refresh.' : 'Sign in with the clinic Google account to load the schedule.')
      : !state.selectedCalendars.size ? 'Choose a calendar above to show its appointments.'
      : state.view === 'day' ? 'There are no appointments on this date in the selected calendars.' : 'There are no appointments this month in the selected calendars.';
    list.replaceChildren(element('div', { class: 'empty-state' }, element('h3', { text: heading }), element('p', { text: description })));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const [day, events] of visible) {
    const section = element('section', { 'aria-label': formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' }) });
    section.append(element('div', { class: 'appointment-date' },
      element('h3', { text: formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' }) }),
      element('span', { text: `${events.length} appointment${events.length === 1 ? '' : 's'}` })));
    for (const event of events) {
      const meta = element('div', { class: 'appointment-meta' }, colourCalendar(element('span', { class: 'calendar-badge', text: event.calendarName }), event.calendarId));
      if (event.location) meta.append(element('span', { text: event.location }));
      if (event.status === 'tentative') meta.append(element('span', { text: 'Tentative' }));
      const row = colourCalendar(element('article', { class: 'appointment-row' },
        element('div', { class: 'appointment-time', text: eventTime(event, day) }),
        element('div', { class: 'appointment-content' }, element('h3', { text: event.summary || 'Untitled appointment' }), meta)), event.calendarId);
      // Provider links are accepted only on Google Calendar's HTTPS origin.
      try {
        const url = new URL(event.htmlLink);
        if (url.protocol === 'https:' && url.hostname === 'calendar.google.com') {
          row.append(element('a', { class: 'event-link', href: url.href, target: '_blank', rel: 'noopener noreferrer', text: 'Open in Calendar', 'aria-label': `Open ${event.summary || 'appointment'} in Google Calendar` }));
        }
      } catch { /* Events without a valid link are still readable. */ }
      section.append(row);
    }
    fragment.append(section);
  }
  list.replaceChildren(fragment);
}

function renderFilters() {
  const fragment = document.createDocumentFragment();
  for (const calendar of state.calendars) {
    const checkbox = element('input', { type: 'checkbox', 'data-calendar': calendar.id });
    checkbox.checked = state.selectedCalendars.has(calendar.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedCalendars.add(calendar.id);
      else state.selectedCalendars.delete(calendar.id);
      render();
    });
    fragment.append(colourCalendar(element('label', { class: 'filter-chip' }, checkbox,
      element('span', { class: 'calendar-swatch', 'aria-hidden': 'true' }),
      element('span', { text: calendar.primary ? 'Main clinic' : calendar.name })), calendar.id));
  }
  $('filter-list').replaceChildren(fragment);
}

function selectDate(day) {
  const changedMonth = day.slice(0, 7) !== state.month;
  state.selectedDate = day;
  state.month = day.slice(0, 7);
  render();
  if (changedMonth) refresh();
}

function navigateMonth(offset) {
  state.month = shiftMonth(state.month, offset);
  state.selectedDate = `${state.month}-01`;
  render();
  refresh();
}

async function refresh(manual = false) {
  if (state.demo) { loadDemo(); return; }
  if (!state.token) return;
  if (Date.now() >= state.expiry) { expire(); return; }
  if (!manual && (document.hidden || Date.now() < state.retryAfter)) return;
  if (state.loading && state.requestedMonth === state.month) return;
  const sequence = ++state.sequence;
  const requestedMonth = state.month;
  state.requestedMonth = requestedMonth;
  const token = state.token;
  state.loading = true;
  state.lastAttempt = Date.now();
  $('sync-status').textContent = 'Refreshing Google Calendar…';
  render();
  try {
    const snapshot = await readSnapshot(token, monthRange(requestedMonth));
    if (sequence !== state.sequence || token !== state.token) return;
    snapshot.calendars = assignCalendarColours(snapshot.calendars, state.calendars);
    const oldIds = new Set(state.calendars.map(calendar => calendar.id));
    for (const calendar of snapshot.calendars) if (!oldIds.has(calendar.id)) state.selectedCalendars.add(calendar.id);
    const currentIds = new Set(snapshot.calendars.map(calendar => calendar.id));
    for (const id of state.selectedCalendars) if (!currentIds.has(id)) state.selectedCalendars.delete(id);
    const filtersChanged = JSON.stringify(state.calendars) !== JSON.stringify(snapshot.calendars);
    state.calendars = snapshot.calendars;
    state.events = snapshot.events;
    state.loadedMonth = requestedMonth;
    state.lastSuccess = new Date();
    state.retryAfter = 0;
    if (filtersChanged) renderFilters();
    const time = state.lastSuccess.toLocaleTimeString('en-MY', { timeZone: CONFIG.timeZone, hour: 'numeric', minute: '2-digit', hour12: true });
    $('sync-status').textContent = `Updated ${time} · auto-refresh every minute`;
    notice();
  } catch (error) {
    if (sequence !== state.sequence || token !== state.token) return;
    if (error.status === 401) { expire(); return; }
    if (error.status === 429) state.retryAfter = Date.now() + 120_000;
    const previous = state.lastSuccess
      ? ` Last successful update: ${state.lastSuccess.toLocaleTimeString('en-MY', { timeZone: CONFIG.timeZone, hour: 'numeric', minute: '2-digit' })}. Displayed appointments may be out of date.` : '';
    notice((error.name === 'CalendarError' ? error.message : 'Could not refresh Google Calendar. Check your connection and try again.') + previous);
    $('sync-status').textContent = state.lastSuccess ? 'Refresh failed · previous schedule retained' : 'Calendar could not load';
  } finally {
    if (sequence === state.sequence) { state.loading = false; render(); }
  }
}

function clearSession() {
  const token = state.token;
  state.sequence++;
  clearTimeout(state.expiryTimer);
  Object.assign(state, { token: '', expiry: 0, loading: false, demo: false, events: null, calendars: [], loadedMonth: null, lastSuccess: null, retryAfter: 0 });
  state.selectedCalendars.clear();
  renderFilters();
  render();
  $('connect-button').disabled = false;
  $('sync-status').textContent = 'Google Calendar is not connected';
  return token;
}

function expire() {
  clearSession();
  notice('Your Google session has expired. Connect Google Calendar again to continue automatic updates.', true);
  $('connect-button').textContent = 'Reconnect Google Calendar';
}

async function connect() {
  const clientId = CONFIG.googleClientId || savedClientId;
  if (!clientId) { openSettings(); return; }
  if (!globalThis.google?.accounts?.oauth2) {
    notice('Google sign-in is still loading or was blocked. Check your connection and try again.'); return;
  }
  const oauth = google.accounts.oauth2;
  $('connect-button').disabled = true;
  notice();
  let pendingToken = '';
  const recover = message => { $('connect-button').disabled = false; notice(message); };
  try {
    const client = oauth.initTokenClient({
      client_id: clientId, scope: SCOPES, hint: CONFIG.calendarAccount, include_granted_scopes: false,
      error_callback: () => recover('Google sign-in was closed or blocked. Choose Connect Google Calendar to try again.'),
      callback: async response => {
        if (response.error || !response.access_token) { recover('Google Calendar access was not granted. Please connect again and allow read access.'); return; }
        pendingToken = response.access_token;
        try {
          if (!oauth.hasGrantedAllScopes(response, ...SCOPES.split(' '))) throw new Error('Please grant all requested read permissions to load the clinic calendars.');
          const account = await readAccount(pendingToken);
          if (String(account.email).toLowerCase() !== CONFIG.calendarAccount.toLowerCase()) throw new Error(`Please connect using ${CONFIG.calendarAccount}.`);
          clearSession();
          state.token = pendingToken;
          state.expiry = Date.now() + Math.max(1, Number(response.expires_in) || 3600) * 1000;
          state.expiryTimer = setTimeout(expire, state.expiry - Date.now());
          $('connect-button').textContent = 'Connect Google Calendar';
          notice();
          await refresh(true);
        } catch (error) {
          if (pendingToken) oauth.revoke(pendingToken, () => {});
          recover(error.name === 'CalendarError' ? error.message : error.message || 'Could not verify the clinic Google account. Try again.');
        } finally { $('connect-button').disabled = false; }
      },
    });
    client.requestAccessToken({ prompt: 'select_account' });
  } catch { recover('Google sign-in could not start. Check the web client ID and authorised website origin in Setup.'); }
}

function openSettings() {
  $('client-id').value = CONFIG.googleClientId || savedClientId;
  $('current-origin').textContent = location.origin;
  $('settings-error').hidden = true;
  $('settings-dialog').showModal();
}

function loadDemo() {
  const range = monthRange(state.month);
  const day = state.selectedDate;
  state.demo = true;
  state.calendars = assignCalendarColours([{ id: 'sample-main', name: 'Main clinic', primary: true }, { id: 'sample-specialist', name: 'Sample specialist', primary: false }], state.calendars);
  state.selectedCalendars = new Set(state.calendars.map(calendar => calendar.id));
  state.events = [
    { id: 'sample-1', summary: 'Sample consultation', start: { dateTime: `${day}T09:00:00+08:00` }, end: { dateTime: `${day}T09:30:00+08:00` }, calendarId: 'sample-main', calendarName: 'Main clinic', location: 'Sample consultation room' },
    { id: 'sample-2', summary: 'Sample follow-up', start: { dateTime: `${day}T10:00:00+08:00` }, end: { dateTime: `${day}T10:30:00+08:00` }, calendarId: 'sample-specialist', calendarName: 'Sample specialist' },
    ...[2, 4, 7, 9, 12, 15, 20, 23, 28].filter(n => addDays(range.start, n) < range.end).map((n, i) => ({ id: `sample-${i + 3}`, summary: 'Sample appointment', start: { dateTime: `${addDays(range.start, n)}T11:00:00+08:00` }, end: { dateTime: `${addDays(range.start, n)}T11:30:00+08:00` }, calendarId: 'sample-main', calendarName: 'Main clinic' })),
  ];
  state.loadedMonth = state.month;
  $('sync-status').textContent = 'Layout preview · sample data only';
  notice('PREVIEW — These are fictional sample appointments. No Google Calendar events are connected. Use Disconnect to leave the preview.', true);
  renderFilters(); render();
}

$('previous-month').addEventListener('click', () => navigateMonth(-1));
$('next-month').addEventListener('click', () => navigateMonth(1));
$('today-button').addEventListener('click', () => selectDate(dateKey()));
$('day-view').addEventListener('click', () => { state.view = 'day'; render(); });
$('month-view').addEventListener('click', () => { state.view = 'month'; render(); });
$('refresh-button').addEventListener('click', () => refresh(true));
$('settings-button').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('connect-button').addEventListener('click', connect);
$('disconnect-button').addEventListener('click', () => {
  const token = clearSession(); notice();
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
});
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  const id = $('client-id').value.trim();
  if (!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id)) {
    $('settings-error').textContent = 'Enter a Google web client ID ending in .apps.googleusercontent.com.';
    $('settings-error').hidden = false; return;
  }
  savedClientId = id;
  let persistent = true;
  try { localStorage.setItem(storageKey, id); } catch { persistent = false; }
  clearSession();
  $('settings-dialog').close();
  notice(persistent ? 'Client ID saved. Choose Connect Google Calendar to load the clinic schedule.' : 'Client ID is ready for this session. Browser storage is unavailable, so you will need to enter it again next time.', true);
});
setInterval(() => refresh(), CONFIG.refreshIntervalMs);
const refreshOnReturn = () => { if (!document.hidden && Date.now() - state.lastAttempt > 3000) refresh(); };
document.addEventListener('visibilitychange', refreshOnReturn);
window.addEventListener('focus', refreshOnReturn);
render();
if (new URLSearchParams(location.search).get('demo') === '1') loadDemo();
