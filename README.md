# Klinik Inocare appointment dashboard

A static, GitHub Pages-compatible staff calendar for **inocareklinik@gmail.com**. A monthly calendar sits above an appointment list, with selected-date and whole-month views. Every owned calendar is discovered automatically; subscribed public holidays are excluded. Calendar filters let staff choose which schedules to show.

Each calendar has a distinct category colour, used consistently in filters, calendar entries, date markers and appointment badges. Colours remain stable during refreshes and when new calendars are added. Calendar names remain visible alongside the colours. The header uses the supplied full-colour Klinik Inocare logo.

## Automatic updates

The open, connected dashboard refreshes every 60 seconds and when you return to the tab. Each refresh replaces the displayed month with a complete Google Calendar result, including all pages and recurring instances. Newly created, changed, moved and deleted events are reflected after the next successful refresh. New owned calendars are discovered too.

Updates run **while the page is open and Google authorisation is valid**. Google browser access tokens expire; reconnect when prompted. No background jobs or server are needed. Google Calendar remains the source of truth; this dashboard requests read access only.

## One-time Google setup

1. Sign in to [Google Cloud](https://console.cloud.google.com/) using the clinic account and create a project.
2. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
3. Configure Google Auth Platform → Branding and Audience. For an external app in Testing, add **inocareklinik@gmail.com** as a test user.
4. Under Data Access, add these scopes:
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
5. Under Clients, create an OAuth client with application type **Web application**.
6. Add **https://drjohan.github.io** as an authorised JavaScript origin. Do not include `/inocare-appointment-dashboard/`. For local development, add **http://127.0.0.1:4173** and **http://localhost:4173** too. Popup token authorisation does not require a redirect URI.
7. Copy the public **client ID** (ending in `.apps.googleusercontent.com`). Do not copy or publish a client secret.
8. Either paste the ID into the dashboard's **Setup** dialog (saved on this browser), or set `googleClientId` in `config.js` to make it available to everyone using this dashboard.
9. Open the site, choose **Connect Google Calendar**, select **inocareklinik@gmail.com**, and grant the three read permissions.

If Google rejects the origin, check the exact scheme and hostname shown in Setup and allow time for Google's settings to propagate. If Google says the app is restricted, confirm the clinic account is a test user. If the app is left in Testing, Google's testing restrictions continue to apply. For a wider audience, follow Google's production/verification requirements.

Official references: [Google browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [web client ID setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [Google Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

## GitHub Pages

Upload the website files to the repository root. In **Settings → Pages**, choose **Deploy from a branch**, then **main** and **/(root)**. GitHub serves `index.html` and its relative assets without a build. `.nojekyll` disables Jekyll processing.

The source and website shell may be public on GitHub Pages. **Calendar events are never included in the repository or generated site.** Each browser must obtain a Google token, and Google enforces that account's calendar permissions. The configured account check restricts the intended interface to the clinic account; it does not replace Google's access controls.

Tokens, account profiles and appointments remain in memory. Only the public client ID is saved in browser storage. Disconnect clears the displayed appointments and revokes the current token. No API key, client secret, service account credential or patient snapshot belongs in this repository. Calendar titles and locations are rendered as plain text; event descriptions and attendee details are not displayed.

## Local preview and checks

With Node.js 20.11 or later:

```sh
npm start
npm test
```

Open `http://127.0.0.1:4173`. For a clearly labelled, fictional layout preview, use `http://127.0.0.1:4173/?demo=1`. The preview is not a live calendar connection.

## Validation limits

Automated tests cover date boundaries in Malaysia time, all-day and multi-day events, pagination, deleted events, recurrence query parameters, and failed refreshes. Browser checks use mocked Google authorisation and API responses; real sign-in and live calendar synchronisation must be verified after the Google web client ID is configured.
