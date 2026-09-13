# Quran 1/Daily

> One Page of Quran. Every Day.

Personal MVP. No login, no ads, no payments, no tracking. Static frontend + Google Sheets backend via Apps Script. **Google Sheets is the source of truth for reading history/progress** — the app is built to be used from a phone, so nothing important lives in laptop localStorage.

## Run locally

Any static file server works (fetch calls require http(s), not file://):

```bash
npx serve .
```

Open the printed URL on desktop, or on your phone if it's on the same Wi-Fi (use your computer's LAN IP instead of localhost).

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

### Backend contract (one `/exec` URL, two capabilities)

- **`POST` a completed reading** — body: `{timestamp,date,deviceId,page,durationSeconds,source,imageFilename}` → appends a row, responds `{ok:true}`. The frontend `await`s this and only marks the page complete once `ok:true` comes back; on failure it shows "Retry Save".
- **`GET ?deviceId=XYZ`** — returns `{ok:true, entries:[...]}` containing *only that device's* rows (server-side filtered, so no device can see another device's reading history). This is what the frontend uses to compute completed pages, weekly/monthly/lifetime stats, and days-returned — every time the app loads and every time Progress is opened.

Both requests use plain `fetch` with `Content-Type: text/plain` on POST (no custom headers) — this keeps them as CORS "simple requests" so the browser doesn't need a preflight, and Apps Script's response can actually be read back cross-origin. No `mode: "no-cors"` fire-and-forget anymore, since we now need to confirm the save and read history back.

## Deploy the frontend (so you can open it on your phone)

Already pushed to GitHub. Turn on Pages:

1. Repo Settings → Pages → Source: `main` branch, root folder.
2. App goes live at `https://hanjrbck91.github.io/Quran1-daily/`.
3. Open that URL on your phone → Add to Home Screen.

Any other static host (Netlify, Vercel, Cloudflare Pages) works the same way — just point it at this folder.

## What's stored where

- **Google Sheet (source of truth)**: timestamp, date, anonymous deviceId, page number, duration in seconds, source (digital/physical), optional image filename. Completed pages, weekly/monthly/lifetime stats, and days-returned are all computed from this on every load — not from any local cache.
- **Browser localStorage (device only, harmless)**: just the anonymous device id, so the phone recognizes itself across visits/reloads. No reading history, no progress, no completed-pages list is kept locally anymore.
- **Captured physical-Quran photos**: stay in the browser only, for the current session's preview. Never uploaded anywhere — only the filename is logged to the Sheet.

## Anonymous device ID

Generated once per browser on first visit (`dev_<timestamp>_<random>`), stored in localStorage, sent with every reading. No name, email, or Google account info is ever collected. A different phone/browser gets a different ID and only ever sees its own rows (the backend filters by `deviceId` server-side before responding).

## Verified test flow

1. Fresh browser/device → new anonymous ID generated.
2. Random page fetched, history fetched from backend (empty for a new ID).
3. Start Reading → timer runs on timestamps.
4. Page Complete → POSTs to Apps Script, waits for `{ok:true}` before showing "complete" feedback.
5. Reload → same device ID persists, backend GET returns the saved row, that page is excluded from the next random pick, Progress shows 1 page / correct minutes / 1 day returned.
6. Clearing localStorage (≈ opening on a different device) generates a new ID with zero history — completely isolated from the first device's rows.

This was tested end-to-end against a local mock of the Apps Script contract (same request/response shape) since deploying to the real `hadhilnjrbrototype@gmail.com` Apps Script requires interactive Google login. Once you paste in the real `/exec` URL, the same flow runs against the actual Sheet.

## Known limitations (intentional, for an MVP)

- No login means there's no way to recover your device ID if you clear site data or switch phones — it's a new, empty history at that point.
- Progress/history requests re-fetch the whole per-device row set from the Sheet each time (fine at personal-MVP scale of a few hundred rows; would need pagination or Apps Script caching if this ever needed to scale to many users or years of daily rows).
- Arabic text quality/font depends on the visiting device having a decent Arabic-capable serif font installed; no custom font is bundled to keep this a zero-build static app.
- Apps Script cold starts can take a second or two on the first request after idling — the UI shows "Loading your progress…" / "Saving…" during this.
