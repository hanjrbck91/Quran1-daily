# Quran 1/Daily

> One Page of Quran. Every Day.

One-hour personal MVP. No login, no ads, no payments, no tracking. Static frontend + Google Sheets backend via Apps Script.

## Run locally

Any static file server works (fetch calls require http(s), not file://):

```bash
npx serve .
```

Open the printed URL (e.g. http://localhost:3000) on desktop, or on your phone if it's on the same Wi-Fi (use your computer's LAN IP instead of localhost).

## Deploy the Google Sheets backend

Do this under the `hadhilnjrbrototype@gmail.com` Google account:

1. Go to sheets.google.com, create a new blank spreadsheet named e.g. "Quran 1/Daily Log".
2. Extensions → Apps Script.
3. Delete the default `Code.gs` content and paste in the contents of `apps-script/Code.gs` from this repo.
4. Click Deploy → New deployment.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click Deploy, authorize the script (it's your own account/script, safe to allow).
6. Copy the **Web app URL** it gives you (ends in `/exec`).
7. Open `app.js` in this project and paste that URL into `SHEET_ENDPOINT` at the top of the file.
8. Reload the app. The sheet auto-creates a "Readings" tab with headers on the first submission.

Because Apps Script web apps don't return CORS headers by default, the frontend posts with `mode: "no-cors"` (fire-and-forget). To verify logging worked, just check the Sheet directly after completing a page — a new row should appear within a couple of seconds.

## Deploy the frontend (so you can open it on your phone)

Simplest path: GitHub Pages.

1. Create a new GitHub repo (e.g. `quran1-daily`) under your account.
2. Push this folder's contents to it.
3. In the repo Settings → Pages, set source to the `main` branch, root folder.
4. Your app will be live at `https://<username>.github.io/quran1-daily/`.
5. Open that URL on your phone → Add to Home Screen.

Any other static host (Netlify, Vercel, Cloudflare Pages) works the same way — just point it at this folder.

## What's stored where

- **Google Sheet** (durable log): timestamp, date, anonymous deviceId, page number, duration in seconds, source (digital/physical), optional image filename.
- **Browser localStorage** (drives the UI): device id, list of completed pages (for random-page-avoidance), full reading history (drives the Progress screen), current page number. This is the source of truth for what you see in the app — the Sheet is a durable backup/log.
- **Captured physical-Quran photos**: stay in the browser only for the current session preview. They are never uploaded anywhere. Only the filename is logged.

## Known limitations (intentional, for a 1-hour MVP)

- Progress stats are computed from localStorage, not the Sheet — clearing browser data resets your visible progress (the Sheet log itself is untouched).
- No login means progress doesn't sync across devices/browsers.
- No CORS read-back from Apps Script, so the app can't display "confirmed logged" status — check the Sheet directly the first time to confirm it's wired up.
- Arabic text quality/font depends on the visiting device having a decent Arabic-capable serif font installed; no custom font is bundled to keep this a zero-build static app.
