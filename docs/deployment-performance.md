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

1. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID` and an `AUTH_SECRET` of at least 32 random characters. The IT System Health dashboard checks these, plus `DATABASE_URL` (shown as Production or Staging) and the receipt photo storage settings.
2. In Google Cloud Console → APIs & Services → Google Sheets API → Quotas, request higher read and write limits per user. It is free, and the single most effective step for many users.
3. Watch database size: since the move to Supabase the IT dashboard shows the database size against the Free plan's 500 MB and the largest tables. (Before that it showed the workbook's cells against Google's 10 million cell limit.) Delete unused empty rows and columns. Receipt photos are stored in the `Receipt Photos` tab at up to 80 KB each (about 107,000 characters across up to four cells); only their small details are read for lists, and the image only when someone views it. If photo volume grows large, move them to a separate spreadsheet file.
4. Each Vercel server instance keeps its own cache. For very large teams, a shared cache (for example Upstash Redis) would let instances share reads; the cache class is the only place that would change.
5. Watch **IT → System Health → Schema** after every deploy: anything missing means a migration was not run on that database.

## Dashboard loading (October 7, 2026)

The executive analytics (`lib/executive-analytics.ts`) used to read every Sales and Collections row ever saved. They now read Sales and Collections only from the earliest date the view uses (previous period, the year's targets and the 12-month trend), and Collections only the 9 columns the figures need (`readSheetRows(..., { only })` leaves the others blank in place, so position-based code is unchanged). The Finance dashboard calls it with `financeOnly`: only the selected period's sales and collections, and no members, enrollments or programs. Measured on staging: Finance 7.8 s → about 1.5 s on a cold start; executive month-to-date about 7 s → 6 s, year-to-date about 6 s → 4.3 s; figures identical (checked against the Gross Sales breakdown). Further gains for the executive view would come from summing in the database instead of reading 60,000 collections.

## Account calculations at scale

Status, MAM and Statement of Account look up each account's payments through `paymentsByEnrollment` (`lib/account-rules.ts`) instead of scanning every payment for every account. With 11,372 accounts and 55,792 payments this took the account report from 35 s to about 1 s. Never pass the full payment list to `accountState` inside a loop over accounts. A 12-month MAM range is still about 7 s because every account is recalculated for every month.


## Dashboards and the workspace switch (October 8, 2026)

- **Switching workspace** (sidebar) now always opens that workspace's dashboard. While it loads, a bar runs at the top and the page says "Opening the … dashboard..." with the old content dimmed; before, the previous workspace's dashboard stayed on screen until the new one arrived, so the switch looked like it did nothing (`components/app-shell.tsx`, `useTransition` around the refresh / navigation).
- **Remittance summary** (Remittances page and Finance dashboard): the receipt-photo index is read together with the ledger instead of after it, one database round trip less.
- **Measuring:** `scripts/time-dashboards.mts` (read-only, timings and table sizes only) times each dashboard's data cold and warm: `npx tsx --tsconfig tsconfig.json scripts/time-dashboards.mts` on staging, `npm run prod -- npx tsx --tsconfig tsconfig.json scripts/time-dashboards.mts` on production. Staging from this PC: Finance about 0.3 s warm (about 2 s on a cold start), executive month-to-date 3.5–4 s. Staging has no recent remittance activity, so production's numbers decide the next step.
