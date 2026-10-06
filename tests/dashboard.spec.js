import { test, expect } from '@playwright/test';

async function mockGoogle(page, options = {}) {
  let events = options.events || [{ id: 'first', summary: 'Test consultation', start: { dateTime: '2026-10-06T09:00:00+08:00' }, end: { dateTime: '2026-10-06T09:30:00+08:00' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=test' }];
  let fail = false;
  await page.clock.install({ time: new Date('2026-10-06T08:00:00+08:00') });
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `window.google = { accounts: { oauth2: { initTokenClient: o => ({ requestAccessToken: () => o.callback({ access_token: 'fictional-test-token', expires_in: ${options.expires || 3600} }) }), hasGrantedAllScopes: () => true, revoke: (t,c) => c({}) } } };` }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '' }));
  await page.route('https://www.googleapis.com/**', route => {
    const url = new URL(route.request().url());
    const json = url.pathname.endsWith('userinfo') ? { email: options.email || 'inocareklinik@gmail.com' }
      : url.pathname.endsWith('calendarList') ? { items: [{ id: 'clinic', summary: 'Main clinic', accessRole: 'owner', primary: true }] }
      : { items: events };
    return route.fulfill({ status: fail ? 503 : 200, json });
  });
  return { setEvents: next => { events = next; }, setFailure: value => { fail = value; } };
}

async function signIn(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByLabel('Google OAuth web client ID').fill('123-fictional.apps.googleusercontent.com');
  await page.getByRole('button', { name: 'Save client ID' }).click();
  await page.getByRole('button', { name: 'Connect Google Calendar', exact: true }).click();
}

test('automatic refresh reflects additions, edits and deletions; failures retain the schedule', async ({ page }) => {
  const mock = await mockGoogle(page);
  await signIn(page);
  await expect(page.locator('#appointment-list')).toContainText('Test consultation');
  mock.setEvents([{ id: 'new', summary: 'New test appointment', start: { dateTime: '2026-10-06T11:00:00+08:00' }, end: { dateTime: '2026-10-06T11:30:00+08:00' } }]);
  await page.clock.fastForward(60_000);
  await expect(page.locator('#appointment-list')).toContainText('New test appointment');
  await expect(page.locator('#appointment-list')).not.toContainText('Test consultation');
  mock.setFailure(true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('may be out of date');
  await expect(page.locator('#appointment-list')).toContainText('New test appointment');
  mock.setFailure(false); mock.setEvents([]);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#appointment-list')).toContainText('No appointments');
  await expect(page.locator('#selected-count')).toHaveText('0');
});

test('filters, date selection, whole-month view, text escaping and disconnect', async ({ page }) => {
  await mockGoogle(page, { events: [{ id: 'xss', summary: '<img src=x onerror=alert(1)>', start: { date: '2026-10-07' }, end: { date: '2026-10-08' }, htmlLink: 'javascript:alert(1)' }] });
  await signIn(page);
  await expect(page.locator('#month-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Whole month' }).click();
  await expect(page.locator('#appointment-list')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#appointment-list img')).toHaveCount(0);
  await expect(page.locator('#appointment-list a')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Main clinic' }).uncheck();
  await expect(page.locator('#appointment-list')).toContainText('No calendars selected');
  await page.getByRole('checkbox', { name: 'Main clinic' }).check();
  await page.locator('[data-date="2026-10-07"]').click();
  await page.getByRole('button', { name: 'Selected date', exact: true }).click();
  await expect(page.locator('#selected-count')).toHaveText('1');
  await page.locator('[data-date="2026-10-07"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#selected-label')).toContainText('8 Oct');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('#appointment-list')).toContainText('Connect to view appointments');
  await expect(page.locator('#month-count')).toHaveText('—');
  expect(await page.evaluate(() => Object.values(localStorage))).toEqual(['123-fictional.apps.googleusercontent.com']);
});

test('expired authorisation clears patient data and asks for reconnection', async ({ page }) => {
  await mockGoogle(page, { expires: 10 });
  await signIn(page);
  await expect(page.locator('#appointment-list')).toContainText('Test consultation');
  await page.clock.fastForward(11_000);
  await expect(page.locator('#notice')).toContainText('session has expired');
  await expect(page.locator('#appointment-list')).not.toContainText('Test consultation');
  await expect(page.getByRole('button', { name: 'Reconnect Google Calendar' })).toBeVisible();
});

test('wrong Google account cannot load clinic appointments', async ({ page }) => {
  await mockGoogle(page, { email: 'someone@example.com' });
  await signIn(page);
  await expect(page.locator('#notice')).toContainText('Please connect using inocareklinik@gmail.com');
  await expect(page.locator('#appointment-list')).not.toContainText('Test consultation');
});

test('responsive calendar and setup dialog fit narrow widths and enlarged text', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '' }));
  await page.goto('/?demo=1');
  for (const width of [320, 375, 479, 480, 481, 767, 768, 769, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('#calendar-grid')).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
});
