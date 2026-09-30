# Deployment and performance

Google Sheets is the database, so speed with many users depends on how few Google requests the app makes. Google allows a limited number of read requests per minute (by default 60 per minute for one service account, 300 per minute per project) and returns HTTP 429 above that.

## How reads stay fast (`lib/google-sheets.ts`, `lib/sheets-read-cache.ts`)

- **Cached per range for 60 seconds, shared by every user on a server.** Two pages that both need Programs share one copy, and a batch read only fetches the ranges it does not already have, in one Google request.
- **Saves clear only the sheets they wrote** (plus the Audit Log), so one person encoding does not empty everyone else's cache. Structural changes (new sheets, deleted rows) clear everything.
- **Parallel identical reads share one request.**
- **Stale fallback:** if Google refuses or fails a read, a copy up to 10 minutes old is served instead of an error page.
- **Backoff:** reads retry 429 and 5xx errors with exponential backoff; writes retry only 429, which Google rejects before applying anything.
- **Always-fresh reads** are limited to where they matter: every read inside a save (validation must see current data), sign-in, and password changes (`readingFresh`). Permissions travel in the signed session, so Users and Roles are cached like everything else.

## Safe concurrent saves

New Sales and Collections validate against the latest data and then write. `withWriteLock` runs these saves one at a time per server, so two batches for the same account cannot both pass validation. Generated member numbers always increase and are checked against existing members.

## Measured (production build, one laptop serving and generating the load)

| Simultaneous users | Requests | Failures | Median (warm cache) | 95th percentile |
| --- | --- | --- | --- | --- |
| 60 | 228 | none | ~0.3 s | ~1.2 s |
| 150 | 565 | none | ~0.6 s | ~2.6 s |

## Checklist for going live

1. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID` and an `AUTH_SECRET` of at least 32 random characters. The IT System Health dashboard checks these.
2. In Google Cloud Console → APIs & Services → Google Sheets API → Quotas, request higher read and write limits per user. It is free, and the single most effective step for many users.
3. Keep the workbook lean: the IT dashboard shows the cell count against Google's 10 million cell limit and the largest tabs. Delete unused empty rows and columns.
4. Each Vercel server instance keeps its own cache. For very large teams, a shared cache (for example Upstash Redis) would let instances share reads; the cache class is the only place that would change.
5. Watch **IT → System Health → Google API Usage**: rising retries or failures mean the quota is close.
