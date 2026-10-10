# Dayong System

The Dayong System runs the company's daily operations: member enrollments (New Sales) and payments (Collections), Clearing and remittance approval, staff incentives and Fidelity, company finance and vendor bills, employees, attendance, leave and payroll, and the reports, MAM, SOA and dashboards built from those records.

It is a [Next.js](https://nextjs.org) app on a [Supabase](https://supabase.com) PostgreSQL database (via [Drizzle](https://orm.drizzle.team)), deployed on Vercel. Pages update live when another user saves (Supabase Realtime). Receipt photos are stored in Supabase.

## Documentation

| Read this | When you need it |
| --- | --- |
| [System guide](docs/system-guide.md) | How every feature works: workflows, formulas, permissions, setup and known limits. Start here. |
| [Documentation index](docs/README.md) | Latest changes and the topic documents. |
| [Code reference](docs/code-reference.md) | Every page, API, library, component and maintenance script (regenerated with `node scripts/generate-code-reference.mjs`). |
| [Project context](docs/project-context.md) | The owner's business decisions and what is done, in progress and still to do. |
| [Migration plan](docs/supabase-migration-plan.md) | The move from Google Sheets to Supabase (finished October 9, 2026: Google is disconnected) and the database migrations. |

Topic documents: [role-based access](docs/access-control.md), [CRUD policy](docs/crud-policy.md), [finance](docs/finance.md), [operational reports](docs/reports.md), [payroll](docs/payroll.md), [encoder tracking](docs/encoder-tracking.md), and the [original specification](docs/dayong-system-specification.md) (historical; the system guide describes the current code).

## Daily flow at a glance

1. **Clearing:** the entry clerk checks a MAS's receipts and bank slips and lists them in Clearing. That time counts as when the cash was received.
2. **Encoding:** in New Sales or Collections the clerk picks the person **From Clearing**; Branch, MAS and Date Remitted fill in. A batch is saved only for someone cleared.
3. **My Entries:** the clerk attaches the receipt photos; entries with photos go for remittance approval on their own.
4. **Remittances:** an approver approves or returns them. The Clearing line follows along (Waiting for encoding → Waiting for receipt → For approval → Approved) and leaves the page after 11:59 PM once approved.

## Getting started

Requirements: Node.js (v24 is used in development) and npm.

```bash
npm install
cp .env.example .env.local   # then fill in the values (ask the administrator)
npm run dev                   # http://localhost:3000
```

`.env.example` lists every variable. Locally, `.env.local` points at the **staging** Supabase project, so you can test freely. Production values never go in `.env.local`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` | Production build; run it (and `npm test`) before committing. |
| `npm test` | All automated tests (`scripts/test-*.mjs` / `.cjs`). |
| `npm run lint` | ESLint. |
| `npm run db:generate` | Create a migration from changes to `db/schema.ts`. |
| `npm run db:migrate` | Apply migrations to the database in `.env.local` (staging). |
| `npm run prod -- <command>` | Run one command against **production**, e.g. `npm run prod -- npm run db:migrate`. Production values live in `.env.prod-scripts` (never committed); the script refuses values that are not the production project. |

Maintenance and data-repair scripts are in `scripts/` and listed in the [code reference](docs/code-reference.md). Scripts that change data run as a dry run first and write only with `--apply`; run them on staging, then `npm run prod -- node scripts/<name>.mjs`, then add `--apply`. Recent examples: `move-program-accounts.mjs` (move or merge accounts between programs, driven by `config/program-moves.json`) and `fix-impossible-doi.mjs` (replace DOIs such as 1943 with the OR or remittance date).

## Deploying

1. **Schema changes:** migrate production **before** pushing code that uses new tables or columns: `npm run prod -- npm run db:migrate`. IT → System Health lists any missing column or unapplied migration.
2. Push to `main`; Vercel builds and deploys it.
3. **Environment:** every variable in `.env.example` must be set in the Vercel **Production** environment. The `GOOGLE_*` variables are no longer needed (Google Sheets was disconnected on October 9, 2026) and can be removed from Vercel. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are public by design (live updates). Environment changes take effect only after a new deployment, so redeploy after adding or changing a value.

## Conventions

- Update the matching document in `docs/` with every change, and regenerate the code reference.
- Member personal data is private: scripts print IDs, codes and counts, not member details.
- Every data change is recorded in the Audit Log; script corrections also add a summary to Record Corrections.