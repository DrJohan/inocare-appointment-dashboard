import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, eventDates, groupEvents, monthRange, monthCells, shiftMonth, eventTime } from '../calendar.js';
import { readSnapshot, listPages } from '../google-calendar.js';

test('Malaysia dates and month navigation handle UTC boundaries and leap years', () => {
  assert.equal(dateKey('2026-10-05T16:30:00Z'), '2026-10-06');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(monthRange('2024-02').end, '2024-03-01');
  const cells = monthCells('2026-10');
  assert.equal(cells[0], '2026-09-28');
  assert.equal(cells.length, 35);
});

test('all-day exclusive ends, midnight ends and multi-day appointments', () => {
  const start = '2026-10-01', end = '2026-11-01';
  assert.deepEqual(eventDates({ start: { date: '2026-10-06' }, end: { date: '2026-10-08' } }, start, end), ['2026-10-06', '2026-10-07']);
  assert.deepEqual(eventDates({ start: { dateTime: '2026-10-06T23:00:00+08:00' }, end: { dateTime: '2026-10-07T00:00:00+08:00' } }, start, end), ['2026-10-06']);
  assert.deepEqual(eventDates({ start: { dateTime: '2026-09-30T23:00:00+08:00' }, end: { dateTime: '2026-10-02T01:00:00+08:00' } }, start, end), ['2026-10-01', '2026-10-02']);
  assert.deepEqual(eventDates({ status: 'cancelled', start: { date: '2026-10-06' } }, start, end), []);
  assert.equal(eventTime({ start: { date: '2026-10-06' } }, '2026-10-06'), 'All day');
});

test('appointments sort by actual instant, deduplicate per calendar and preserve distinct recurring instances', () => {
  const events = [
    { id: 'late', calendarId: 'a', start: { dateTime: '2026-10-06T03:00:00Z' }, end: { dateTime: '2026-10-06T04:00:00Z' } },
    { id: 'early', calendarId: 'a', start: { dateTime: '2026-10-06T09:00:00+08:00' }, end: { dateTime: '2026-10-06T09:30:00+08:00' } },
    { id: 'recurring_1', recurringEventId: 'recurring', calendarId: 'a', start: { date: '2026-10-06' }, end: { date: '2026-10-07' } },
    { id: 'recurring_2', recurringEventId: 'recurring', calendarId: 'a', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } },
  ];
  const groups = groupEvents([...events, events[0]], '2026-10-01', '2026-11-01');
  assert.deepEqual(groups.get('2026-10-06').map(event => event.id), ['recurring_1', 'early', 'late']);
  assert.equal(groups.get('2026-10-07')[0].id, 'recurring_2');
});

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('reads every event page, expands recurrence and excludes subscribed holiday calendars', async () => {
  const calls = [];
  const fetcher = async (input, options) => {
    const url = new URL(input); calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer fake-test-token');
    assert.equal(options.cache, 'no-store');
    if (url.pathname.endsWith('calendarList')) return json({ items: [{ id: 'clinic', summary: 'Clinic', accessRole: 'owner', primary: true }, { id: 'holiday', accessRole: 'reader' }] });
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.equal(url.searchParams.get('showDeleted'), 'false');
    assert.equal(url.searchParams.get('timeZone'), 'Asia/Kuala_Lumpur');
    assert.equal(url.searchParams.get('timeMin'), '2026-10-01T00:00:00+08:00');
    return url.searchParams.has('pageToken')
      ? json({ items: [{ id: 'second' }, { id: 'deleted', status: 'cancelled' }] })
      : json({ items: [{ id: 'first' }], nextPageToken: 'page-2' });
  };
  const snapshot = await readSnapshot('fake-test-token', monthRange('2026-10'), fetcher);
  assert.deepEqual(snapshot.events.map(event => event.id), ['first', 'second']);
  assert.equal(snapshot.calendars.length, 1);
  assert.equal(calls.length, 3);
});

test('snapshots replace additions, edits and deletions instead of merging old events', async () => {
  let phase = 0;
  const fetcher = async url => url.includes('calendarList')
    ? json({ items: [{ id: 'clinic', accessRole: 'owner' }] })
    : json({ items: phase === 0 ? [{ id: 'removed' }, { id: 'edited', summary: 'Before' }] : [{ id: 'edited', summary: 'After' }, { id: 'new' }] });
  const first = await readSnapshot('fake', monthRange('2026-10'), fetcher);
  phase = 1;
  const second = await readSnapshot('fake', monthRange('2026-10'), fetcher);
  assert.equal(first.events.length, 2);
  assert.deepEqual(second.events.map(event => event.id), ['edited', 'new']);
  assert.equal(second.events[0].summary, 'After');
});

test('partial failures and malformed pages never produce a misleading successful empty snapshot', async () => {
  const failing = async url => url.includes('calendarList')
    ? json({ items: [{ id: 'good', accessRole: 'owner' }, { id: 'bad', accessRole: 'owner' }] })
    : url.includes('/bad/') ? json({}, 503) : json({ items: [] });
  await assert.rejects(readSnapshot('fake', monthRange('2026-10'), failing), /could not be reached/);
  await assert.rejects(listPages('https://example.com', 'fake', async () => json({})), /incomplete/);
  await assert.rejects(listPages('https://example.com', 'fake', async () => json({ items: [], nextPageToken: 'same' })), /repeated/);
});
