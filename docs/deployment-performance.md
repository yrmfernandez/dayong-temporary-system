# Deployment and performance

Google Sheets is the database, so speed with many users depends on how few Google requests the app makes. Google allows a limited number of read requests per minute (by default 60 per minute for one service account, 300 per minute per project) and returns HTTP 429 above that.

## How reads stay fast (`lib/google-sheets.ts`, `lib/sheets-read-cache.ts`)

- **Cached per range for 60 seconds, shared by every user on a server.** Two pages that both need Programs share one copy, and a batch read only fetches the ranges it does not already have, in one Google request.
- **Saves clear only the sheets they wrote** (plus the Audit Log), so one person encoding does not empty everyone else's cache. Structural changes (new sheets, deleted rows) clear everything.
- **Parallel identical reads share one request.**
- **Stale-while-revalidate:** a copy past its 60 seconds (but under 10 minutes old) is shown at once and refreshed in the background, so a page never waits for a large sheet after its first load. Collections is about 56,000 rows (20 MB, ~5 s to download) since the legacy import.
- **Warm after a save:** when a save finishes, the ranges of the sheets it wrote that were read in the last 10 minutes are reloaded in the background, so the next page does not wait either.
- **Stale fallback:** if Google refuses or fails a read, a copy up to 10 minutes old is served instead of an error page.
- **Backoff:** reads retry 429 and 5xx errors with exponential backoff; writes retry only 429, which Google rejects before applying anything.
- **One shared range per large sheet** (`lib/sheet-ranges.ts`): the dashboard, reports, remittances, Today's Entries, Exceptions and clerk reports ask for exactly the same Collections/Sales/Remittances/Programs/Members ranges, so the cache fetches Collections once per load instead of once per module. Keep new readers on these ranges.
- **Dashboards load in parallel** and only what they show (Member programs only for the MAS dashboard). A loading layout (`app/loading.tsx`) appears at once while a server-rendered page loads.
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
3. Keep the workbook lean: the IT dashboard shows the cell count against Google's 10 million cell limit and the largest tabs. Delete unused empty rows and columns. Receipt photos are stored in the `Receipt Photos` tab at up to 80 KB each (about 107,000 characters across up to four cells); only their small details are read for lists, and the image only when someone views it. If photo volume grows large, move them to a separate spreadsheet file.
4. Each Vercel server instance keeps its own cache. For very large teams, a shared cache (for example Upstash Redis) would let instances share reads; the cache class is the only place that would change.
5. Watch **IT → System Health → Google API Usage**: rising retries or failures mean the quota is close.

## Account calculations at scale

Status, MAM and Statement of Account look up each account's payments through `paymentsByEnrollment` (`lib/account-rules.ts`) instead of scanning every payment for every account. With 11,372 accounts and 55,792 payments this took the account report from 35 s to about 1 s. Never pass the full payment list to `accountState` inside a loop over accounts. A 12-month MAM range is still about 7 s because every account is recalculated for every month.
