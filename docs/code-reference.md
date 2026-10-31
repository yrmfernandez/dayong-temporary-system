# Dayong System code reference

Generated from the repository source on 2026-10-06. Start with the [system guide](system-guide.md) for explanations and worked examples. This index covers source files, exported functions/types/constants, local dependencies, API methods, and maintenance scripts. It does not inspect credentials, dependencies in node_modules, binary assets, or the live workbook. Export names and import connections are extracted with the TypeScript parser; they are navigation aids, not a proof that every path is used at runtime.

Regenerate from the repository root with `node scripts/generate-code-reference.mjs` after changes. Update the review date in this script when performing a new review.

## Coverage

45 page routes, 76 API handlers, 147 library files, 67 component files; 654 scanned source/configuration/public-text files in total.

## Page routes

| Page | Source | Local dependencies |
| --- | --- | --- |
| `/admin-reports` | [app/admin-reports/page.tsx](../app/admin-reports/page.tsx) | `@/components/report-tabs` |
| `/attendance-reviews` | [app/attendance-reviews/page.tsx](../app/attendance-reviews/page.tsx) | `@/components/app-dialog`, `@/components/attendance-calendar`, `@/components/clock-in-location-flag`, `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/attendance-tracking` | [app/attendance-tracking/page.tsx](../app/attendance-tracking/page.tsx) | `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/attendance`, `@/lib/date-format`, `@/lib/use-live-refresh` |
| `/attendance` | [app/attendance/page.tsx](../app/attendance/page.tsx) | `@/components/attendance-calendar`, `@/components/my-attendance-history`, `@/lib/attendance`, `@/components/ui/badge`, `@/components/ui/button`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/audit` | [app/audit/page.tsx](../app/audit/page.tsx) | `@/components/clerk-report`, `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/search-select`, `@/lib/account-rules`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/branches` | [app/branches/page.tsx](../app/branches/page.tsx) | `@/components/app-dialog`, `@/components/ui/badge`, `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/select`, `@/lib/use-live-refresh` |
| `/cash-transactions` | [app/cash-transactions/page.tsx](../app/cash-transactions/page.tsx) | `@/components/app-dialog`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/clearing` | [app/clearing/page.tsx](../app/clearing/page.tsx) | `@/components/app-dialog`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/api-response`, `@/lib/clearing`, `@/lib/clearing-kinds`, `@/lib/use-live-refresh` |
| `/collections` | [app/collections/page.tsx](../app/collections/page.tsx) | `@/components/app-dialog`, `@/lib/entry-check-reminder`, `@/components/clearing-picker`, `@/lib/clearing-kinds`, `@/lib/enter-to-next`, `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/use-form-draft`, `@/lib/use-parked-drafts`, `@/components/parked-drafts`, `@/lib/remittance-deadline`, `@/lib/use-work-calendar`, `@/lib/entry-controls`, `@/components/control-total-field`, `@/lib/date-checks`, `@/components/receipt-photos-picker`, `@/components/remittance-summary`, `@/components/ui/select`, `@/lib/types`, `@/lib/remittance`, `@/lib/account-rules`, `@/lib/or-number`, `@/lib/date-format` |
| `/commissions` | [app/commissions/page.tsx](../app/commissions/page.tsx) | `@/components/cash-out-fields`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/company-reports` | [app/company-reports/page.tsx](../app/company-reports/page.tsx) | `@/components/company-reports` |
| `/employees` | [app/employees/page.tsx](../app/employees/page.tsx) | `@/components/app-dialog`, `@/lib/api-response`, `@/components/ui/button`, `@/components/ui/search-select`, `@/components/bulk-member-transfer`, `@/components/inline-panel`, `@/components/status-badge`, `@/components/one-time-password`, `@/components/nte-panel`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/entry-corrections` | [app/entry-corrections/page.tsx](../app/entry-corrections/page.tsx) | `@/components/admin-delete`, `@/components/bulk-member-transfer`, `@/components/entry-editor`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/search-select`, `@/app/programs/program-transfer`, `@/lib/api-response`, `@/lib/entry-search`, `@/lib/date-format` |
| `/exceptions` | [app/exceptions/page.tsx](../app/exceptions/page.tsx) | `@/components/entry-correction-form`, `@/components/ui/button`, `@/components/ui/card`, `@/lib/api-response`, `@/lib/exceptions`, `@/lib/use-live-refresh` |
| `/expenses` | [app/expenses/page.tsx](../app/expenses/page.tsx) | `@/components/app-dialog`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/components/receipt-photo`, `@/components/receipt-photos-picker`, `@/lib/expense-options`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/fidelity/me` | [app/fidelity/me/page.tsx](../app/fidelity/me/page.tsx) |  |
| `/fidelity` | [app/fidelity/page.tsx](../app/fidelity/page.tsx) | `@/lib/auth-server` |
| `/fully-paid` | [app/fully-paid/page.tsx](../app/fully-paid/page.tsx) | `@/components/app-dialog`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/account-rules`, `@/lib/api-response`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/history` | [app/history/page.tsx](../app/history/page.tsx) | `@/components/or-no-letter-check`, `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/input`, `@/lib/use-live-refresh` |
| `/leave-approvals` | [app/leave-approvals/page.tsx](../app/leave-approvals/page.tsx) | `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/leave-requests` | [app/leave-requests/page.tsx](../app/leave-requests/page.tsx) | `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/select`, `@/components/ui/textarea`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/login` | [app/login/page.tsx](../app/login/page.tsx) | `@/components/brand-logo`, `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label` |
| `/mam` | [app/mam/page.tsx](../app/mam/page.tsx) | `@/lib/mam-format`, `@/lib/mam-report`, `@/lib/account-rules`, `@/components/ui/button`, `@/components/ui/badge`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/search-select`, `@/lib/use-live-refresh`, `@/lib/date-format`, `@/components/mam-print`, `@/components/mam-member-card`, `@/components/mam-status`, `@/components/mas-collection-list` |
| `/mas-sales` | [app/mas-sales/page.tsx](../app/mas-sales/page.tsx) | `@/components/new-sales-form` |
| `/mas-collections` | [app/mas-collections/page.tsx](../app/mas-collections/page.tsx) | `@/components/app-dialog`, `@/components/mam-status`, `@/components/ui/*`, `@/lib/date-format`, `@/lib/mas-collection-quote`, `@/lib/remittance-deadline`, `@/lib/use-form-draft`, `@/lib/use-live-refresh`, `@/lib/use-work-calendar` |
| `/dropouts` | [app/dropouts/page.tsx](../app/dropouts/page.tsx) | `@/components/app-dialog`, `@/components/ui/*`, `@/lib/date-format`, `@/lib/use-live-refresh` |
| `/search-records` | [app/search-records/page.tsx](../app/search-records/page.tsx) | `@/components/ui/*`, `@/lib/api-response`, `@/lib/date-format`, `@/lib/record-search-options` |
| `/master-data` | [app/master-data/page.tsx](../app/master-data/page.tsx) |  |
| `/member-corrections` | [app/member-corrections/page.tsx](../app/member-corrections/page.tsx) | `@/components/or-no-letter-check`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/date-format` |
| `/members` | [app/members/page.tsx](../app/members/page.tsx) | `@/components/app-dialog`, `@/components/admin-delete`, `@/components/member-edit-form`, `@/components/inline-panel`, `@/components/ui/search-select`, `@/components/ui/input`, `@/lib/api-response`, `@/components/ui/button`, `@/components/status-badge`, `@/components/member-mam`, `@/lib/member-directory`, `@/lib/use-live-refresh`, `@/components/transfer-branch-choice`, `@/lib/date-format` |
| `/my-entries` | [app/my-entries/page.tsx](../app/my-entries/page.tsx) | `@/components/batch-editor`, `@/components/entry-details`, `@/components/metric-tile`, `@/components/receipt-photo`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/api-response`, `@/lib/report-week`, `@/lib/todays-entries`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/my-notices` | [app/my-notices/page.tsx](../app/my-notices/page.tsx) | `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/textarea`, `@/lib/api-response`, `@/lib/nte`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/new-sales` | [app/new-sales/page.tsx](../app/new-sales/page.tsx) | `@/components/new-sales-form` |
| `/` | [app/page.tsx](../app/page.tsx) | `@/components/executive-dashboard`, `@/components/finance-dashboard`, `@/components/metric-tile`, `@/components/status-badge`, `@/components/live-router-refresh`, `@/components/system-health-dashboard`, `@/components/ui/card`, `@/lib/account-rules`, `@/lib/auth`, `@/lib/auth-server`, `@/lib/dashboard-data`, `@/lib/employees`, `@/lib/executive-analytics`, `@/lib/finance-operations`, `@/lib/remittance-workflow`, `@/lib/system-health`, `@/lib/ui-preferences`, `@/lib/date-format` |
| `/payroll` | [app/payroll/page.tsx](../app/payroll/page.tsx) | `@/components/app-dialog`, `@/components/inline-panel`, `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/components/people-filter`, `@/lib/payroll-calc`, `@/lib/payslip`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/programs` | [app/programs/page.tsx](../app/programs/page.tsx) | `@/components/app-dialog`, `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/select`, `@/components/ui/textarea`, `@/lib/program-age`, `@/lib/program-payment-limit.mjs`, `@/lib/use-live-refresh`, `@/lib/program-snapshot` |
| `/remittances` | [app/remittances/page.tsx](../app/remittances/page.tsx) | `@/components/app-dialog`, `@/components/admin-delete`, `@/components/metric-tile`, `@/components/receipt-photo`, `@/components/remittance-discrepancy`, `@/components/remittance-entries`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/api-response`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/reports/daily` | [app/reports/daily/page.tsx](../app/reports/daily/page.tsx) |  |
| `/reports/monthly` | [app/reports/monthly/page.tsx](../app/reports/monthly/page.tsx) |  |
| `/reports` | [app/reports/page.tsx](../app/reports/page.tsx) | `@/components/report-tabs` |
| `/reports/weekly` | [app/reports/weekly/page.tsx](../app/reports/weekly/page.tsx) |  |
| `/reports/yearly` | [app/reports/yearly/page.tsx](../app/reports/yearly/page.tsx) |  |
| `/roles` | [app/roles/page.tsx](../app/roles/page.tsx) | `@/components/app-dialog`, `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/lib/access-control`, `@/lib/api-response`, `@/lib/page-catalog`, `@/lib/use-live-refresh` |
| `/settings` | [app/settings/page.tsx](../app/settings/page.tsx) | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/finance-settings`, `@/components/profile`, `@/components/theme-toggle`, `@/components/remittance-method-settings`, `@/lib/ui-preferences`, `@/lib/use-form-draft` |
| `/soa` | [app/soa/page.tsx](../app/soa/page.tsx) | `@/components/brand-logo`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/search-select`, `@/lib/statement-of-account`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/todays-entries` | [app/todays-entries/page.tsx](../app/todays-entries/page.tsx) | `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/api-response`, `@/lib/remittance-deadline`, `@/lib/today-mode`, `@/lib/todays-entries`, `@/components/entry-correction-form`, `@/components/entry-details`, `@/components/admin-delete`, `@/components/receipt-photo`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| `/user-accounts` | [app/user-accounts/page.tsx](../app/user-accounts/page.tsx) | `@/components/app-dialog`, `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/components/one-time-password`, `@/lib/use-live-refresh` |
| `/vendor-payables` | [app/vendor-payables/page.tsx](../app/vendor-payables/page.tsx) | `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/use-live-refresh` |

## API routes

All routes pass through the authentication proxy except the three public auth endpoints. Methods below are implemented exports; permission and validation details remain in each linked handler.

| API | Methods | Source |
| --- | --- | --- |
| `/api/admin-delete` | GET, POST | [app/api/admin-delete/route.ts](../app/api/admin-delete/route.ts) |
| `/api/attendance-calendar` | GET, POST | [app/api/attendance-calendar/route.ts](../app/api/attendance-calendar/route.ts) |
| `/api/attendance-reviews` | GET, POST | [app/api/attendance-reviews/route.ts](../app/api/attendance-reviews/route.ts) |
| `/api/attendance-sheet` | GET | [app/api/attendance-sheet/route.ts](../app/api/attendance-sheet/route.ts) |
| `/api/attendance-tracking/daily` | GET, PATCH, POST | [app/api/attendance-tracking/daily/route.ts](../app/api/attendance-tracking/daily/route.ts) |
| `/api/attendance-tracking/location` | PATCH | [app/api/attendance-tracking/location/route.ts](../app/api/attendance-tracking/location/route.ts) |
| `/api/attendance-tracking` | GET | [app/api/attendance-tracking/route.ts](../app/api/attendance-tracking/route.ts) |
| `/api/attendance/history` | GET | [app/api/attendance/history/route.ts](../app/api/attendance/history/route.ts) |
| `/api/attendance` | GET, POST | [app/api/attendance/route.ts](../app/api/attendance/route.ts) |
| `/api/audit` | GET, POST, PATCH | [app/api/audit/route.ts](../app/api/audit/route.ts) |
| `/api/audit/summary` | GET | [app/api/audit/summary/route.ts](../app/api/audit/summary/route.ts) |
| `/api/auth/login` | POST | [app/api/auth/login/route.ts](../app/api/auth/login/route.ts) |
| `/api/auth/logout` | POST | [app/api/auth/logout/route.ts](../app/api/auth/logout/route.ts) |
| `/api/auth/session` | GET | [app/api/auth/session/route.ts](../app/api/auth/session/route.ts) |
| `/api/branches/location` | PUT | [app/api/branches/location/route.ts](../app/api/branches/location/route.ts) |
| `/api/branches` | GET, POST, PUT, DELETE | [app/api/branches/route.ts](../app/api/branches/route.ts) |
| `/api/cash-transactions` | GET, POST, PATCH | [app/api/cash-transactions/route.ts](../app/api/cash-transactions/route.ts) |
| `/api/clearing/open` | GET | [app/api/clearing/open/route.ts](../app/api/clearing/open/route.ts) |
| `/api/clearing` | GET, POST, PATCH | [app/api/clearing/route.ts](../app/api/clearing/route.ts) |
| `/api/clerk-report` | GET, POST | [app/api/clerk-report/route.ts](../app/api/clerk-report/route.ts) |
| `/api/collections` | GET, POST | [app/api/collections/route.ts](../app/api/collections/route.ts) |
| `/api/commissions` | GET, POST, PATCH | [app/api/commissions/route.ts](../app/api/commissions/route.ts) |
| `/api/company-targets` | POST | [app/api/company-targets/route.ts](../app/api/company-targets/route.ts) |
| `/api/cron/nightly` | GET, POST | [app/api/cron/nightly/route.ts](../app/api/cron/nightly/route.ts) |
| `/api/dashboard/gross-sales` | GET | [app/api/dashboard/gross-sales/route.ts](../app/api/dashboard/gross-sales/route.ts) |
| `/api/employees` | GET, POST, PATCH, DELETE | [app/api/employees/route.ts](../app/api/employees/route.ts) |
| `/api/entry-corrections` | GET, PATCH, PUT | [app/api/entry-corrections/route.ts](../app/api/entry-corrections/route.ts) |
| `/api/exceptions` | GET, PATCH | [app/api/exceptions/route.ts](../app/api/exceptions/route.ts) |
| `/api/expenses` | GET, POST, PATCH | [app/api/expenses/route.ts](../app/api/expenses/route.ts) |
| `/api/fidelity` | GET, PATCH | [app/api/fidelity/route.ts](../app/api/fidelity/route.ts) |
| `/api/finance-options` | GET, POST | [app/api/finance-options/route.ts](../app/api/finance-options/route.ts) |
| `/api/fully-paid` | GET, POST | [app/api/fully-paid/route.ts](../app/api/fully-paid/route.ts) |
| `/api/history` | GET, PATCH | [app/api/history/route.ts](../app/api/history/route.ts) |
| `/api/leave-approvals` | GET, POST | [app/api/leave-approvals/route.ts](../app/api/leave-approvals/route.ts) |
| `/api/leave-requests` | GET, POST | [app/api/leave-requests/route.ts](../app/api/leave-requests/route.ts) |
| `/api/maintenance-notice` | GET, POST | [app/api/maintenance-notice/route.ts](../app/api/maintenance-notice/route.ts) |
| `/api/mam/member` | GET | [app/api/mam/member/route.ts](../app/api/mam/member/route.ts) |
| `/api/mam` | GET, POST | [app/api/mam/route.ts](../app/api/mam/route.ts) |
| `/api/mas` | GET | [app/api/mas/route.ts](../app/api/mas/route.ts) |
| `/api/member-corrections` | GET, POST | [app/api/member-corrections/route.ts](../app/api/member-corrections/route.ts) |
| `/api/member-programs/check` | GET | [app/api/member-programs/check/route.ts](../app/api/member-programs/check/route.ts) |
| `/api/members/account-status` | POST | [app/api/members/account-status/route.ts](../app/api/members/account-status/route.ts) |
| `/api/members/directory` | GET, PATCH, DELETE | [app/api/members/directory/route.ts](../app/api/members/directory/route.ts) |
| `/api/members` | GET | [app/api/members/route.ts](../app/api/members/route.ts) |
| `/api/members/standing` | GET | [app/api/members/standing/route.ts](../app/api/members/standing/route.ts) |
| `/api/members/transfer` | GET, POST | [app/api/members/transfer/route.ts](../app/api/members/transfer/route.ts) |
| `/api/my-entries/batch` | GET, POST | [app/api/my-entries/batch/route.ts](../app/api/my-entries/batch/route.ts) |
| `/api/my-entries` | GET, POST | [app/api/my-entries/route.ts](../app/api/my-entries/route.ts) |
| `/api/notifications` | GET | [app/api/notifications/route.ts](../app/api/notifications/route.ts) |
| `/api/nte/mine` | GET, PATCH | [app/api/nte/mine/route.ts](../app/api/nte/mine/route.ts) |
| `/api/nte` | GET, POST, PATCH | [app/api/nte/route.ts](../app/api/nte/route.ts) |
| `/api/payroll` | GET, POST | [app/api/payroll/route.ts](../app/api/payroll/route.ts) |
| `/api/profile` | GET | [app/api/profile/route.ts](../app/api/profile/route.ts) |
| `/api/program-categories` | GET, POST, PUT, DELETE | [app/api/program-categories/route.ts](../app/api/program-categories/route.ts) |
| `/api/program-incentives` | GET, POST | [app/api/program-incentives/route.ts](../app/api/program-incentives/route.ts) |
| `/api/programs` | GET, POST, PUT, PATCH, DELETE | [app/api/programs/route.ts](../app/api/programs/route.ts) |
| `/api/programs/transfer` | GET, POST | [app/api/programs/transfer/route.ts](../app/api/programs/transfer/route.ts) |
| `/api/receipt-photos` | GET, POST | [app/api/receipt-photos/route.ts](../app/api/receipt-photos/route.ts) |
| `/api/remittance-methods` | GET, POST | [app/api/remittance-methods/route.ts](../app/api/remittance-methods/route.ts) |
| `/api/remittances/discrepancy` | GET | [app/api/remittances/discrepancy/route.ts](../app/api/remittances/discrepancy/route.ts) |
| `/api/remittances/entries` | GET | [app/api/remittances/entries/route.ts](../app/api/remittances/entries/route.ts) |
| `/api/remittances/incentive` | PATCH | [app/api/remittances/incentive/route.ts](../app/api/remittances/incentive/route.ts) |
| `/api/remittances` | GET, POST, PATCH | [app/api/remittances/route.ts](../app/api/remittances/route.ts) |
| `/api/reports` | GET, POST | [app/api/reports/route.ts](../app/api/reports/route.ts) |
| `/api/roles` | GET, POST, PATCH, DELETE | [app/api/roles/route.ts](../app/api/roles/route.ts) |
| `/api/sale-submissions` | GET, POST, PATCH | [app/api/sale-submissions/route.ts](../app/api/sale-submissions/route.ts) |
| [app/api/collection-submissions/route.ts](../app/api/collection-submissions/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/access-control`, `@/lib/clearing`, `@/lib/day-off`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/collection-submissions` |
| `/api/collection-submissions` | GET, POST, PATCH | [app/api/collection-submissions/route.ts](../app/api/collection-submissions/route.ts) |
| [app/api/dropouts/route.ts](../app/api/dropouts/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/day-off`, `@/lib/dropouts`, `@/lib/encoder-context`, `@/lib/member-transfer` |
| `/api/dropouts` | GET, POST, PATCH | [app/api/dropouts/route.ts](../app/api/dropouts/route.ts) |
| [app/api/search-records/route.ts](../app/api/search-records/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/member-scope`, `@/lib/record-search` |
| `/api/search-records` | GET | [app/api/search-records/route.ts](../app/api/search-records/route.ts) |
| `/api/sales` | POST | [app/api/sales/route.ts](../app/api/sales/route.ts) |
| `/api/sales/validate` | POST | [app/api/sales/validate/route.ts](../app/api/sales/validate/route.ts) |
| `/api/server-time` | GET | [app/api/server-time/route.ts](../app/api/server-time/route.ts) |
| `/api/settings` | PATCH | [app/api/settings/route.ts](../app/api/settings/route.ts) |
| `/api/soa` | GET, PATCH | [app/api/soa/route.ts](../app/api/soa/route.ts) |
| `/api/todays-entries` | GET, POST, PATCH | [app/api/todays-entries/route.ts](../app/api/todays-entries/route.ts) |
| `/api/user-accounts/password` | POST | [app/api/user-accounts/password/route.ts](../app/api/user-accounts/password/route.ts) |
| `/api/user-accounts` | GET, POST, PATCH, DELETE | [app/api/user-accounts/route.ts](../app/api/user-accounts/route.ts) |
| `/api/vendor-payables` | GET, POST, PATCH | [app/api/vendor-payables/route.ts](../app/api/vendor-payables/route.ts) |
| `/api/work-calendar` | GET | [app/api/work-calendar/route.ts](../app/api/work-calendar/route.ts) |

## Libraries and business rules

| File | Exported symbols | Local imports / re-exports |
| --- | --- | --- |
| [lib/access-control.ts](../lib/access-control.ts) | `AccessContext`, `executiveRoles`, `normalizeRoleName`, `isAdministratorRole`, `itRoles`, `hrRoles`, `isFinanceFamilyRole`, `canManageAccountsFor`, `canManageEmployeesFor`, `canManageConfigurationFor`, `canCorrectEntriesFor`, `canConfirmOrWithoutLetterFor`, `defaultRoutesForRole`, `pageTicked`, `routesForRole`, `accessibleRoutes`, `canAccessPath`, `DashboardKind`, `dashboardKind` | — |
| [lib/account-data.ts](../lib/account-data.ts) | `AccountScope`, `LoadedAccount`, `AccountData`, `loadAccountData`, `accountReport`, `ProgramStanding`, `memberStanding`, `mamReport`, `memberMam`, `syncAccountStatuses`, `NewCollection`, `commitCollections` | `@/lib/account-rules`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/remittance`, `@/lib/mam-report`, `@/lib/full-payments` |
| [lib/account-deactivation.ts](../lib/account-deactivation.ts) | `DEACTIVATED`, `isDeactivated`, `setAccountActive`, `deactivationNotes` | `@/lib/db`, `@/lib/record-corrections` |
| [lib/account-rules.ts](../lib/account-rules.ts) | `AccountStatus`, `ACCOUNT_STATUSES`, `Account`, `saleNops`, `firstCollectionNop`, `PAY_THE_BALANCE_CATEGORY_ID`, `forfeitMonthsFor`, `AccountPayment`, `todayInManila`, `validDate`, `validMonth`, `monthIndex`, `monthName`, `monthCount`, `dateInMonth`, `addMonths`, `addDay`, `allocations`, `paymentsByEnrollment`, `accountState`, `COLLECTION_CHANNELS`, `CollectionChannel`, `incentiveRoleFor`, `FORFEITED_PAYMENT_DAYS`, `forfeitedPaymentsAllowed`, `PaymentInput`, `validatePayment` | `./program-payment-limit.mjs` |
| [lib/admin-delete.ts](../lib/admin-delete.ts) | `DELETE_KINDS`, `DeleteKind`, `isDeleteKind`, `canDeleteRecords`, `DeletionPlan`, `planDeletion`, `deleteRecord` | `@/lib/auth`, `@/lib/access-control`, `@/lib/db`, `@/lib/readable-id`, `@/lib/date-format` |
| [lib/api-response.ts](../lib/api-response.ts) | `readApiResponse`, `parseJsonResponse` | `@/lib/friendly-api-errors` |
| [lib/attendance-board.ts](../lib/attendance-board.ts) | `BoardCategory`, `canViewAttendanceTracking`, `canAdjustLateness`, `MARK_STATUSES`, `MarkStatus`, `isMarkStatus`, `boardCategory`, `minutesBetween`, `HistoryPeriod`, `HISTORY_PERIODS`, `isHistoryPeriod`, `periodRange`, `HistoryTotals`, `summarizeHistory`, `AttendanceHistory` | `@/lib/auth`, `@/lib/attendance-data` |
| [lib/attendance-calendar.ts](../lib/attendance-calendar.ts) | `ALL_BRANCHES`, `Holiday`, `Closure`, `validDate`, `getHolidays`, `saveHoliday`, `deleteHoliday`, `addPhilippineHolidays`, `getClosures`, `closureCovers`, `closureLabel`, `closureForBranch`, `employeeAttendanceBranches`, `declareClosure`, `removeClosure` | `@/lib/attendance-data`, `@/lib/db`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/philippine-holidays`, `@/lib/readable-id` |
| [lib/attendance-data.ts](../lib/attendance-data.ts) | `AttendanceRecord`, `sheetDateText`, `sheetTimeText`, `getAttendanceForEmployeeDate`, `addAttendanceRecord`, `getAttendanceRowsForDate`, `addAttendanceRecords`, `getAllAttendanceForRange`, `updateAttendanceRecord`, `deleteAttendanceRecords`, `getAttendanceRecordsForDate`, `getNonWorkingDayRecords`, `cancelClockInsForNonWorkingDay`, `getAttendanceRecordsForRange`, `getEmployeeAttendance`, `recordApprovedLeaveAttendance` | `@/lib/db`, `@/lib/encoder-context`, `@/lib/attendance` |
| [lib/attendance-sheet.ts](../lib/attendance-sheet.ts) | `SheetDayStatus`, `SheetDay`, `SheetSummary`, `SheetEmployee`, `PAPER_SHEET_NOTE`, `emptySummary`, `attendanceSheet`, `GridTone`, `GridCell`, `gridCell`, `sumSummaries` | `@/lib/attendance-data`, `@/lib/attendance-board`, `@/lib/attendance`, `@/lib/working-days` |
| [lib/attendance.ts](../lib/attendance.ts) | `ATTENDANCE_TIME_ZONE`, `SCHEDULED_TIME_IN`, `SCHEDULED_TIME_OUT`, `LATE_GRACE_MINUTES`, `BREAK_START`, `BREAK_END`, `timeToMinutes`, `workingMinutesBetween`, `lateMinutesFor`, `clockOutFigures`, `dayTotals`, `withDayTotals`, `WORKING_DAYS`, `AttendanceStatus`, `getPhilippineDate`, `getPhilippineTime`, `isWorkingDay`, `carriedNotRequired`, `carriedNotRequiredNote` | — |
| [lib/audit-log.ts](../lib/audit-log.ts) | `AUDIT_SHEET`, `AUDIT_HEADERS`, `AuditActor`, `AuditAction`, `AuditChanges`, `parseRange`, `planValuesUpdate`, `planValuesBatchUpdate`, `planBatchUpdate`, `diffRow`, `auditedWrite`, `resetAuditSheetCache` | — |
| [lib/auth-server.ts](../lib/auth-server.ts) | `getSessionUser`, `getRealSessionUser`, `userWithPageAccess`, `canManageAccounts`, `canManageEmployees`, `canManageConfiguration`, `canManageUsers`, `canManageAttendance` | `@/lib/access-control`, `@/lib/ui-preferences`, `@/lib/workspace-session`, `@/lib/auth` |
| [lib/auth.ts](../lib/auth.ts) | `SessionUser`, `SESSION_COOKIE`, `SESSION_SECONDS`, `sessionCookieOptions`, `sessionMaxAge`, `serializeSessionCookie`, `createSessionToken`, `verifySessionToken` | `@/lib/server-environment` |
| [lib/auto-absence.ts](../lib/auto-absence.ts) | `SYSTEM_ABSENCE_NOTE`, `isSystemAbsence`, `systemAbsences`, `closeFinishedAttendanceDays`, `closeFinishedAttendanceDaysQuietly`, `SYSTEM_ABSENCE_REVIEW_DAYS`, `systemAbsencesWaiting` | `@/lib/attendance-calendar`, `@/lib/attendance-data`, `@/lib/attendance`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/google-sheets`, `@/lib/google-sheets-data`, `@/lib/system-settings` |
| [lib/batch-edit.ts](../lib/batch-edit.ts) | `BatchKind`, `EditableBatch`, `SaleBeneficiary`, `SaleDetails`, `getReturnedBatch`, `BatchEditInput`, `saveReturnedBatch` | `@/lib/account-rules`, `@/lib/account-data`, `@/lib/admin-delete`, `@/lib/clearing`, `@/lib/clearing-kinds`, `@/lib/date-checks`, `@/lib/db`, `@/lib/duplicate-entries`, `@/lib/employees`, `@/lib/entry-batches`, `@/lib/entry-controls`, `@/lib/google-sheets-data`, `@/lib/member-records`, `@/lib/program-age`, `@/lib/or-number`, `@/lib/program-amount-lock`, `@/lib/record-corrections`, `@/lib/work-calendar`, `@/lib/working-days`, `@/lib/remittance`, `@/lib/remittance-methods`, `@/lib/remittance-deadline` |
| [lib/calculations.ts](../lib/calculations.ts) | `CollectionStatus`, `calculateTMD`, `calculateBalance`, `getNextNOP`, `getProgramBasePay`, `calculateCollectionTMD` | `./types` |
| [lib/capacity.ts](../lib/capacity.ts) | `PLAN_LABEL`, `databaseAllowance`, `storageAllowance`, `CapacityPoint`, `measureCapacity`, `capacityHistory`, `recordCapacity`, `growth` | `@/lib/db`, `@/lib/system-settings` |
| [lib/cash-count.ts](../lib/cash-count.ts) | `DENOMINATIONS`, `CashCount`, `cashCountTotal`, `formatCashCount`, `parseCashCount`, `cashCountProblem` | — |
| [lib/clearing-kinds.ts](../lib/clearing-kinds.ts) | `ClearingKind`, `ClearingCovers`, `CLEARING_COVERS`, `coveredKinds`, `DATE_REMITTED_REASON_MIN`, `handoverLabel` | — |
| [lib/clearing.ts](../lib/clearing.ts) | `ClearingStage`, `CLEARING_COVERS`, `coveredKinds`, `handoverLabel`, `ClearingCovers`, `ClearingKind`, `ClearingDecision`, `Clearing`, `withProgress`, `LIST_CLEARED`, `DayEndLine`, `getDayEndReview`, `settleDayEnd`, `getClearingPage`, `getEncodableClearings`, `AlreadyClearedError`, `addClearing`, `removeClearing`, `editClearing`, `clearedEmployee`, `clearingProblem`, `pickedClearingProblem`, `waitingBatchProblem`, `dateRemittedReasonProblem`, `clearedAt`, `pickedClearings`, `closeClearings`, `countOpenClearings` | `@/lib/db`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/clearing-kinds`, `@/lib/entry-batches`, `@/lib/readable-id`, `@/lib/remittance-deadline` |
| [lib/clerk-cash.ts](../lib/clerk-cash.ts) | `CASH_BEG_REASON_MIN`, `depositRemarksProblem`, `duplicateReferenceProblem`, `BankDeposit`, `getDeposits`, `addDeposit`, `editDeposit`, `voidDeposit`, `CashBegEdit`, `ReportNotes`, `getReportNotes`, `getCashBegEdits`, `saveCashBeg`, `saveReportNotes` | `@/lib/db`, `@/lib/encoder-context`, `@/lib/readable-id`, `@/lib/remittance-deadline` |
| [lib/clerk-report.ts](../lib/clerk-report.ts) | `COMPANY`, `weekOfMonth`, `ReportLine`, `ExpenseRow`, `buildClerkReport`, `ClerkReport`, `BranchFigures` | `@/lib/clerk-cash`, `@/lib/db`, `@/lib/daily-audit`, `@/lib/report-periods`, `@/lib/google-sheets`, `@/lib/mas-expected`, `@/lib/receipt-photos`, `@/lib/remittance-deadline`, `@/lib/todays-entries`, `@/lib/date-format`, `@/lib/turnover-variance` |
| [lib/clock-in-checks.ts](../lib/clock-in-checks.ts) | `ClockInCheck`, `readDevicePosition`, `recordClockInCheck`, `getClockInChecks`, `getClockInCheck`, `saveClockInReview` | `@/lib/db`, `@/lib/clock-in-location`, `@/lib/google-sheets-data` |
| [lib/clock-in-location.ts](../lib/clock-in-location.ts) | `DEFAULT_RADIUS_M`, `MIN_RADIUS_M`, `MAX_RADIUS_M`, `MAX_ACCURACY_ALLOWANCE_M`, `ClockInResult`, `ReviewStatus`, `DevicePosition`, `BranchLocation`, `isValidCoordinate`, `hasLocation`, `distanceMeters`, `radiusOf`, `checkClockIn`, `needsReview`, `formatDistance`, `clockInLabel`, `parseCoordinates` | — |
| [lib/company-targets.ts](../lib/company-targets.ts) | `CompanyTarget`, `periodType`, `getCompanyTargets`, `saveCompanyTarget` | `@/lib/db` |
| [lib/daily-audit.ts](../lib/daily-audit.ts) | `AUDIT_PERIODS`, `AuditPeriod`, `asAuditPeriod`, `AUDIT_RESULTS`, `AuditStatus`, `periodSpan`, `AuditFigures`, `DailyAudit`, `auditedEmployees`, `submittedPeriodFor`, `getDailyAudits`, `saveDailyAudit`, `AUDIT_DECISIONS`, `AuditDecision`, `decideDailyAudit`, `reportLockProblem`, `clerkItemDay`, `clerkAuditView`, `ClerkAuditView`, `AuditSummaryFilters`, `getAuditSummary` | `@/lib/db`, `@/lib/encoder-context`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/readable-id`, `@/lib/clerk-report`, `@/lib/turnover-variance`, `@/lib/date-format`, `@/lib/manila-date`, `@/lib/report-week`, `@/lib/report-periods` |
| [lib/dashboard-data.ts](../lib/dashboard-data.ts) | `dashboardKind`, `DashboardKind`, `getDashboardData`, `DashboardData` | `@/lib/auth`, `@/lib/account-rules`, `@/lib/access-control`, `@/lib/attendance-data`, `@/lib/google-sheets`, `@/lib/leave-data`, `@/lib/users-sheet`, `@/lib/reports`, `@/lib/remittance-workflow`, `@/lib/system-settings`, `@/lib/todays-entries`, `@/lib/sheet-ranges`, `@/lib/sheets-on-db`, `@/lib/manila-date`, `@/lib/person-scope` |
| [lib/date-checks.ts](../lib/date-checks.ts) | `REMIT_LATE_DAYS`, `ENCODE_LATE_DAYS`, `DateFacts`, `dateWarnings`, `blockingDateProblem` | `@/lib/date-format` |
| [lib/date-format.ts](../lib/date-format.ts) | `formatDate`, `formatDateTime`, `formatMonth`, `formatRange` | — |
| [lib/day-off.ts](../lib/day-off.ts) | `DAY_OFF_MESSAGE`, `isOnDayOff`, `refuseOnDayOff`, `entriesEncodedOn`, `dayOffEntriesNote` | `@/lib/attendance`, `@/lib/auth-server`, `@/lib/db` |
| [lib/db.ts](../lib/db.ts) | `schema`, `Database`, `Transaction`, `Queryable`, `getDb`, `currentDb`, `inTransaction`, `UNIQUE_VIOLATION`, `isUniqueViolation`, `encodedBy` | `@/db/schema`, `@/lib/encoder-context`, `@/lib/server-environment` |
| [lib/default-password.ts](../lib/default-password.ts) | `DEFAULT_PASSWORD`, `MIN_PASSWORD_LENGTH`, `isWeakPassword` | — |
| [lib/defaults.ts](../lib/defaults.ts) | `emptyAddress`, `emptyPersonName`, `emptyClaimant`, `emptyMember`, `emptyProgram`, `emptyBeneficiary`, `emptyNewSale` | `./types` |
| [lib/deposit-day.ts](../lib/deposit-day.ts) | `depositDayProblem` | `@/lib/daily-audit`, `@/lib/date-format` |
| [lib/duplicate-entries.ts](../lib/duplicate-entries.ts) | `entryKey`, `personKey`, `recordedApplicationNumbers`, `recordedOrNumbers`, `recordedMembersByPerson`, `newSalesDoubleEntry` | `@/lib/db`, `@/lib/program-age` |
| [lib/earned-commissions.ts](../lib/earned-commissions.ts) | `getEarnedCommissions`, `EarnedCommission` | `@/lib/employees`, `@/lib/finance-operations`, `@/lib/reports` |
| [lib/employee-accounts.ts](../lib/employee-accounts.ts) | `accountRoleIdsFor`, `createDefaultAccount` | `@/lib/google-sheets-data`, `@/lib/passwords` |
| [lib/employee-id-change.ts](../lib/employee-id-change.ts) | `changeEmployeeId` | `@/lib/db`, `@/lib/employee-id`, `@/lib/record-corrections` |
| [lib/employee-id.ts](../lib/employee-id.ts) | `EMPLOYEE_ID_PATTERN`, `EMPLOYEE_ID_INPUT_PATTERN`, `EMPLOYEE_ID_EXAMPLE`, `EMPLOYEE_ID_FORMAT_MESSAGE`, `normalizeEmployeeId`, `isEmployeeIdFormat` | — |
| [lib/employees.ts](../lib/employees.ts) | `employmentStatuses`, `EmploymentStatus`, `getEmployees`, `suggestEmployeeId`, `getNextEmployeeId`, `registerEmployee`, `updateEmployee`, `setEmployeeRoles`, `updateEmployeeStatus`, `deleteEmployee` | `@/lib/db`, `@/lib/google-sheets`, `@/lib/employee-id` |
| [lib/encoder-context.ts](../lib/encoder-context.ts) | `isEncodingRequest`, `withEncoder`, `runAsSystem`, `getEncoder`, `currentEncoder`, `encoderValues` | `@/lib/auth-server` |
| [lib/encoder-schema.ts](../lib/encoder-schema.ts) | `encoderHeaders`, `editorHeaders`, `encoderSheets`, `columnName`, `trackingHeaders`, `quotedSheet`, `getEncoderSheet` | — |
| [lib/encoder-sheets.ts](../lib/encoder-sheets.ts) | `appendEncodedRows`, `updateEncodedRow` | `@/lib/google-sheets`, `@/lib/encoder-context`, `@/lib/encoder-schema`, `@/lib/sheet-headers` |
| [lib/enter-to-next.ts](../lib/enter-to-next.ts) | `enterToNextField` | — |
| [lib/entry-batches.ts](../lib/entry-batches.ts) | `saleBatchKey`, `cashMethodNames`, `isCashMethod` | `@/lib/remittance-methods` |
| [lib/entry-check-reminder.ts](../lib/entry-check-reminder.ts) | `COLLECTION_CHECK_REMINDER`, `SALE_CHECK_REMINDER` | — |
| [lib/entry-controls.ts](../lib/entry-controls.ts) | `BACKDATE_REASON_MIN`, `needsBackdateReason`, `lateCheckDay`, `lateEntryReason`, `checkBackdate`, `controlTotalProblem`, `TURNOVER_NOTE_MAX`, `varianceLabel`, `controlTotalDifference`, `controlTotalStatus`, `isIncompleteApplicationNumber`, `INCOMPLETE_APPLICATION_MESSAGE`, `isDoiTime`, `DOI_TIME_MESSAGE`, `nextApplicationNumber` | `@/lib/remittance-deadline`, `@/lib/working-days` |
| [lib/entry-corrections.ts](../lib/entry-corrections.ts) | `correctSaleOrCollection` | `@/lib/db`, `@/lib/duplicate-entries`, `@/lib/remittance-deadline`, `@/lib/record-corrections`, `@/lib/or-number`, `@/lib/or-no-letter` |
| [lib/entry-edit.ts](../lib/entry-edit.ts) | `EditKind`, `EditAccount`, `EditableEntry`, `getEditableEntry`, `EntryEditInput`, `saveEntryEdit`, `followSlip`, `repriceCollections`, `repriceSales`, `mergeAccountInto`, `NumberingStart`, `numberingStart`, `renumber`, `PayRule`, `receiptMonthsAt`, `receiptMonthsIn` | `@/lib/account-rules`, `@/lib/account-data`, `@/lib/db`, `@/lib/duplicate-entries`, `@/lib/entry-controls`, `@/lib/google-sheets-data`, `@/lib/or-number`, `@/lib/or-no-letter`, `@/lib/program-amount-lock`, `@/lib/record-corrections`, `@/lib/remittance`, `@/lib/remittance-deadline`, `@/lib/remittance-methods` |
| [lib/entry-finance.mjs](../lib/entry-finance.mjs) | `repriceEntries` | `./remittance.ts` |
| [lib/entry-search.ts](../lib/entry-search.ts) | `SearchKind`, `isSearchKind`, `FoundEntry`, `SEARCH_LIMIT`, `searchEntries` | `@/lib/db` |
| [lib/exceptions.ts](../lib/exceptions.ts) | `EXCEPTION_CATEGORIES`, `ExceptionCategory`, `ExceptionItem`, `findExceptions` | `@/lib/db`, `@/lib/sheets-on-db`, `@/components/entry-correction-form`, `@/lib/sheet-ranges`, `@/lib/account-rules`, `@/lib/duplicate-entries`, `@/lib/google-sheets`, `@/lib/program-age`, `@/lib/program-amount-lock`, `@/lib/remittance-deadline`, `@/lib/work-calendar`, `@/lib/date-checks`, `@/lib/date-format`, `@/lib/turnover-variance` |
| [lib/executive-analytics.ts](../lib/executive-analytics.ts) | `executivePeriods`, `ExecutivePeriod`, `isExecutivePeriod`, `Ranked`, `TrendPoint`, `getExecutiveAnalytics`, `ExecutiveAnalytics` | `@/lib/account-rules`, `@/lib/sheet-ranges`, `@/lib/sheets-on-db`, `@/lib/db`, `@/lib/company-targets`, `@/lib/remittance-deadline`, `@/lib/google-sheets` |
| [lib/expense-options.ts](../lib/expense-options.ts) | `EXPENSE_ACCOUNTS`, `BURIAL_ACCOUNT`, `isOtherChoice`, `EXPENSE_ATTACHMENTS`, `EXPENSE_APPROVERS`, `choiceWithOther`, `attachmentList`, `expenseNumbers` | — |
| [lib/fidelity-cap.ts](../lib/fidelity-cap.ts) | `FIDELITY_CAP`, `fidelityStanding`, `baseWithdrawalAmount` | — |
| [lib/fidelity.ts](../lib/fidelity.ts) | `FIDELITY_CAP`, `WITHDRAWAL_TYPES`, `OPENING_TYPE`, `OLD_WITHDRAWAL_TYPE`, `getFidelityData`, `withdrawFidelity` | `@/lib/google-sheets`, `@/lib/employees`, `@/lib/readable-id`, `@/lib/db`, `@/lib/finance-data`, `@/lib/finance-operations`, `@/lib/fidelity-cap` |
| [lib/finance-access.ts](../lib/finance-access.ts) | `canUseFinance` | `@/lib/auth-server` |
| [lib/finance-data.ts](../lib/finance-data.ts) | `ExpenseRecord`, `CashLedgerEntry`, `getFinanceData`, `createExpense`, `editExpense`, `deleteExpense`, `createCashTransaction`, `voidFinanceRecord`, `cashTransactionsFor` | `@/lib/db`, `@/lib/encoder-context`, `@/lib/expense-options`, `@/lib/readable-id`, `@/lib/receipt-photos` |
| [lib/finance-operations.ts](../lib/finance-operations.ts) | `cashOutDetails`, `getCashAccounts`, `saveCashAccount`, `getVendorPayables`, `createVendorPayable`, `payVendorPayable`, `getCommissions`, `createCommission`, `payCommissionDirectly`, `payCommission` | `@/lib/db`, `@/lib/finance-data`, `@/lib/readable-id` |
| [lib/friendly-api-errors.ts](../lib/friendly-api-errors.ts) | `explainServerFailure`, `installFriendlyApiErrors`, `SYSTEM_BUSY` | — |
| [lib/full-payments.ts](../lib/full-payments.ts) | `CERTIFICATE_STATUSES`, `CertificateStatus`, `FullPaymentSource`, `parseCertificate`, `formatCertificate`, `RESERVED_KEY`, `nextCertificateNumber`, `FullPaymentInput`, `recordFullPayment`, `recordCompletedAccounts`, `setCertificateRelease`, `removeFullPayment`, `listFullPayments`, `certificatePrefixes`, `setCertificatePrefix`, `accountsToRecord` | `@/lib/account-rules`, `@/lib/db`, `@/lib/encoder-context` |
| [lib/google-sheets-data.ts](../lib/google-sheets-data.ts) | `ProgramSheetData`, `BranchSheetData`, `getBranches`, `createBranch`, `ProgramIncentiveSheetData`, `CreateProgramData`, `getProgramIncentives`, `addProgramIncentive`, `getPrograms`, `programColumns`, `assertProgramCodeFree`, `createProgram`, `LoginRole`, `LoginUserData`, `AttendanceEmployee`, `getLoginUserByEmployeeId`, `AccountRole`, `CreateEmployeeAccountData`, `getActiveAccountRoles`, `createEmployeeAccount`, `getActiveAttendanceEmployees` | `@/lib/db`, `@/lib/program-amount-lock`, `@/lib/program-incentive-store`, `@/lib/employees`, `@/lib/employee-id`, `@/lib/roles`, `@/lib/program-age`, `@/lib/remittance`, `@/lib/program-payment-limit.mjs`, `@/lib/users-sheet`, `@/lib/google-sheets` |
| [lib/google-sheets.ts](../lib/google-sheets.ts) | `GOOGLE_SHEET_ID`, `sheetsStats`, `withWriteLock`, `sheetOfRange`, `readingFresh`, `sheets` | `@/lib/sheets-read-cache`, `@/lib/encoder-context`, `@/lib/sheets-on-db` |
| [lib/gross-sales.ts](../lib/gross-sales.ts) | `GrossSalesEntry`, `getGrossSalesEntries`, `GrossSalesBreakdown`, `filterGrossSales` | `@/lib/db` |
| [lib/incentive-decision.ts](../lib/incentive-decision.ts) | `IncentiveDecision`, `INCENTIVE_DECISIONS`, `incentiveDecisions`, `decideIncentive` | `@/lib/db`, `@/lib/encoder-context`, `@/lib/entry-edit`, `@/lib/readable-id`, `@/lib/remittance-deadline`, `@/lib/work-calendar` |
| [lib/leave-data.ts](../lib/leave-data.ts) | `LeaveApprovalStatus`, `LeaveRequest`, `getLeaveRequestsForEmployee`, `addLeaveRequest`, `getAllLeaveRequests`, `updateLeaveRequestReview` | `@/lib/db` |
| [lib/lunch-break.ts](../lib/lunch-break.ts) | `isLunchBreak`, `lunchSecondsLeft`, `allowedDuringLunch`, `pageOpenDuringLunch`, `URGENT_FIX_MS`, `LUNCH_BREAK_MESSAGE` | `@/lib/attendance` |
| [lib/maintenance-notice-text.ts](../lib/maintenance-notice-text.ts) | `MaintenanceNotice`, `MAINTENANCE_MESSAGE_MAX`, `DEFAULT_MAINTENANCE_MESSAGE` | — |
| [lib/maintenance-notice.ts](../lib/maintenance-notice.ts) | `DEFAULT_MAINTENANCE_MESSAGE`, `MAINTENANCE_MESSAGE_MAX`, `MaintenanceNotice`, `getMaintenanceNotice`, `setMaintenanceNotice` | `@/lib/maintenance-notice-text`, `@/lib/system-settings` |
| [lib/mam-format.ts](../lib/mam-format.ts) | `paidInMonth` | — |
| [lib/mam-report.ts](../lib/mam-report.ts) | `MamAccount`, `monitoringMonths`, `buildMamReport` | `@/lib/account-rules` |
| [lib/manila-date.ts](../lib/manila-date.ts) | `manilaToday`, `manilaDateOf` | — |
| [lib/mas-collection.ts](../lib/mas-collection.ts) | `CLOSE_TO_FORFEIT_DAYS`, `collectionList`, `monthsLabel` | `@/lib/account-rules`, `@/lib/date-format` |
| [lib/mas-expected.ts](../lib/mas-expected.ts) | `Expected`, `duesIn`, `expectedByMas` | `@/lib/db` |
| [lib/master-data-crud.ts](../lib/master-data-crud.ts) | `lockedPayChange`, `ProgramInput`, `updateProgramRecord`, `ProgramBulkChanges`, `updateProgramsBulk`, `deleteProgramRecord`, `BranchInput`, `updateBranchRecord`, `setBranchLocation`, `deleteBranchRecord`, `getUserAccounts`, `updateUserAccount`, `resetUserPassword`, `deleteUserAccount`, `MemberRecordInput`, `getMemberRecord`, `updateMemberRecord`, `deleteMemberRecord` | `@/lib/db`, `@/lib/google-sheets-data`, `@/lib/google-sheets`, `@/lib/passwords`, `@/lib/users-sheet`, `@/lib/program-incentive-store`, `@/lib/member-records`, `@/lib/manila-date` |
| [lib/member-corrections.ts](../lib/member-corrections.ts) | `ReceiptLine`, `StatusLine`, `CorrectionResult`, `searchMembers`, `getMemberForCorrection`, `CoverageInput`, `fixCoverage`, `MoveInput`, `moveReceipts`, `MERGE_FIELDS`, `MergeField`, `MergeInput`, `mergeMembers`, `SplitInput`, `splitMember`, `programChoices`, `sharedPrograms`, `InsertInput`, `insertReceipt` | `@/lib/account-rules`, `@/lib/account-data`, `@/lib/db`, `@/lib/entry-edit`, `@/lib/duplicate-entries`, `@/lib/or-number`, `@/lib/or-no-letter`, `@/lib/record-corrections`, `@/lib/remittance-deadline`, `@/lib/date-format` |
| [lib/member-directory-data.ts](../lib/member-directory-data.ts) | `clearMemberDirectoryCache`, `loadMemberDirectory`, `DirectoryQuery`, `queryMemberDirectory` | `@/lib/db`, `@/lib/account-data`, `@/lib/account-deactivation`, `@/lib/member-directory`, `@/lib/member-scope`, `@/lib/employees`, `@/lib/google-sheets-data` |
| [lib/member-directory.ts](../lib/member-directory.ts) | `DirectoryEnrollment`, `DirectoryMember`, `DECEASED_STATUS`, `MEMBER_STATUSES`, `STANDING_FILTERS`, `Standing`, `matchesStanding`, `DirectoryFilters`, `emptyDirectoryFilters`, `MemberRecord`, `EnrollmentRecord`, `CollectorRecord`, `buildMemberDirectory`, `filterMemberDirectory` | — |
| [lib/member-records.ts](../lib/member-records.ts) | `MemberSheetData`, `MemberDetails`, `memberContactOrClaimant`, `memberColumns`, `addMember`, `updateMemberDetails`, `addBeneficiaries`, `findMemberByNumber`, `searchMembersByName`, `listMembersForMas`, `searchBranchMembers`, `similarFirstNames`, `findSameNameMembers`, `MemberProgramSheetData`, `findMemberProgramEnrollment`, `addMemberProgram`, `SaleSheetData`, `addSale`, `listMembersInBranch` | `@/lib/readable-id`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/program-age` |
| [lib/member-scope.ts](../lib/member-scope.ts) | `ownMembersScope`, `isOwnAccount` | `@/lib/auth`, `@/lib/access-control`, `@/lib/employees` |
| [lib/member-transfer.ts](../lib/member-transfer.ts) | `canTransferMembers`, `BranchMode`, `TransferCandidate`, `transferCandidates`, `transferEnrollment`, `EmployeeAccount`, `employeeAccounts`, `transferEmployeeAccounts`, `getTransferHistory`, `branchChangeOptions`, `employeeBranchOptions`, `changeEnrollmentsBranch` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/readable-id` |
| [lib/members.ts](../lib/members.ts) | `getMemberPrograms`, `getProgram`, `getMember` | `./types` |
| [lib/mock-members.ts](../lib/mock-members.ts) | `mockMembers` | `./types` |
| [lib/navigation.ts](../lib/navigation.ts) | `NavItem`, `NavSection`, `normalizeRole`, `workspaceFor`, `routeMatches`, `visibleNavigation`, `isInWorkspace`, `locatePage`, `activeHref` | `@/lib/access-control` |
| [lib/nightly-jobs.ts](../lib/nightly-jobs.ts) | `NIGHTLY_KEY`, `NightlyStep`, `NightlyRun`, `runNightlyJobs`, `lastNightlyRun` | `@/lib/account-data`, `@/lib/auto-absence`, `@/lib/capacity`, `@/lib/encoder-context`, `@/lib/exceptions`, `@/lib/manila-date`, `@/lib/system-settings` |
| [lib/dropouts.ts](../lib/dropouts.ts) | `DROPOUT_REASONS`, `searchDropoutMembers`, `requestDropout`, `listDropouts`, `approveDropout`, `rejectDropout` | `@/lib/account-deactivation`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/member-directory`, `@/lib/readable-id`, `@/lib/record-corrections`, `@/lib/remittance-deadline`, `@/lib/sale-submissions` |
| [lib/record-search.ts](../lib/record-search.ts) | `LIMIT`, `searchWords`, `phoneDigits`, `cleanQuery`, `SEARCH_TIMEOUT`, `SEARCH_TOO_SLOW`, `searchRecords`, `recordSearchOptions` | `@/lib/db`, `@/lib/record-search-options` |
| [lib/notifications.ts](../lib/notifications.ts) | `NotificationCounts`, `getNotificationCounts` | `@/lib/access-control`, `@/lib/account-rules`, `@/lib/auth`, `@/lib/auto-absence`, `@/lib/db`, `@/lib/clearing`, `@/lib/sale-submissions`, `@/lib/collection-submissions` |
| [lib/nte.ts](../lib/nte.ts) | `NTE_DAYS`, `SUSPENSION_THRESHOLD`, `Nte`, `EXPLANATION_MAX`, `listNtes`, `issueNte`, `withdrawNte`, `listMyNtes`, `acknowledgeNte`, `explainNte`, `markNteReviewed` | `@/lib/db`, `@/lib/employees`, `@/lib/readable-id`, `@/lib/remittance-deadline` |
| [lib/or-no-letter.ts](../lib/or-no-letter.ts) | `orNoLetterConfirmed`, `NO_LETTER_NOTE` | `@/lib/access-control`, `@/lib/auth-server` |
| [lib/or-number.ts](../lib/or-number.ts) | `OR_NUMBER_EXAMPLE`, `isValidOrNumber`, `isDigitsOnlyOrNumber`, `orNumberProblem`, `normalizeOrNumber`, `nextOrNumber` | — |
| [lib/page-catalog.ts](../lib/page-catalog.ts) | `pageCatalog`, `pageCatalogRoutes` | — |
| [lib/passwords.ts](../lib/passwords.ts) | `ONE_TIME_PASSWORD_HOURS`, `generateOneTimePassword`, `hashPassword`, `hashOneTimePassword`, `oneTimePasswordExpiry`, `checkPassword` | — |
| [lib/payroll-calc.ts](../lib/payroll-calc.ts) | `WORKING_DAYS_PER_YEAR`, `BaseType`, `PayProfile`, `PayrollSettings`, `defaultPayrollSettings`, `AttendanceDay`, `CommissionItem`, `PayrollLine`, `Adjustment`, `COMPANY_PROGRAM_CATEGORY`, `ADJUSTMENT_CATEGORIES`, `dailyRateOf`, `scheduledWorkingDays`, `computePayrollLine`, `lineTotals`, `runTotals` | — |
| [lib/payroll.ts](../lib/payroll.ts) | `getPayProfiles`, `savePayProfile`, `PayrollRun`, `getPayrollOverview`, `getPayrollRun`, `createPayrollRun`, `recalculatePayrollRun`, `addPayrollAdjustment`, `removePayrollAdjustment`, `approvePayrollRun`, `payPayrollRun`, `voidPayrollRun`, `deletePayrollRun`, `ProgramDeduction`, `getProgramDeductions`, `linkDeductionCollection` | `@/lib/attendance-data`, `@/lib/auto-absence`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/employees`, `@/lib/finance-data`, `@/lib/finance-operations`, `@/lib/google-sheets-data`, `@/lib/payroll-calc`, `@/lib/readable-id` |
| [lib/payslip.ts](../lib/payslip.ts) | `PAYSLIP_COMPANY`, `PayslipRow`, `Payslip`, `buildPayslip`, `payslipFileName`, `payslipPdf` | `@/lib/payroll-calc`, `@/lib/date-format` |
| [lib/person-scope.ts](../lib/person-scope.ts) | `Person`, `masScope`, `accountableScope` | — |
| [lib/philippine-holidays.ts](../lib/philippine-holidays.ts) | `HOLIDAY_TYPES`, `HolidayType`, `HolidayTemplate`, `philippineHolidays` | — |
| [lib/photo-storage.ts](../lib/photo-storage.ts) | `PHOTO_BUCKET`, `storePhoto`, `readPhoto` | — |
| [lib/privilege-guard.ts](../lib/privilege-guard.ts) | `guardAccountChange`, `guardRoleChange` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/master-data-crud`, `@/lib/roles` |
| [lib/program-age.ts](../lib/program-age.ts) | `AgeRestriction`, `readAgeRestriction`, `normalizeAgeRestriction`, `ageRestrictionCells`, `describeAgeRestriction`, `ageOn`, `isoDate`, `ageRestrictionError` | — |
| [lib/program-amount-lock.ts](../lib/program-amount-lock.ts) | `isTrue`, `amountEditableCells`, `fixedNewSaleAmount` | — |
| [lib/program-categories.ts](../lib/program-categories.ts) | `ProgramCategory`, `getProgramCategories`, `createProgramCategory`, `updateProgramCategory`, `deleteProgramCategory` | `@/lib/db`, `@/lib/readable-id` |
| [lib/program-incentive-store.ts](../lib/program-incentive-store.ts) | `StoredTier`, `validateIncentiveTiers`, `writeProgramIncentives` | `@/lib/db`, `@/lib/readable-id` |
| [lib/program-payment-limit.mjs](../lib/program-payment-limit.mjs) | `normalizeMonthlyMaximum`, `validateMonthlyMaximum` | — |
| [lib/program-snapshot.ts](../lib/program-snapshot.ts) | `ProgramSnapshotSource`, `programSnapshot` | — |
| [lib/program-transfer.ts](../lib/program-transfer.ts) | `TransferAccount`, `canMovePrograms`, `programTargets`, `programTransferOptions`, `transferProgramAccounts` | `@/lib/access-control`, `@/lib/account-rules`, `@/lib/auth-server`, `@/lib/db`, `@/lib/readable-id`, `@/lib/entry-edit`, `@/lib/encoder-context` |
| [lib/programs.ts](../lib/programs.ts) | `Program`, `getActivePrograms`, `getAllPrograms` | `./google-sheets-data` |
| [lib/rate-limit.ts](../lib/rate-limit.ts) | `retryAfter`, `recordAttempt`, `clearAttempts`, `clientIp` | — |
| [lib/readable-id.ts](../lib/readable-id.ts) | `createReadableId` | — |
| [lib/receipt-photos.ts](../lib/receipt-photos.ts) | `MAX_PHOTO_BYTES`, `ReceiptPhotoInfo`, `listReceiptPhotos`, `photosByEntry`, `getReceiptPhoto`, `saveReceiptPhoto`, `MAX_EXPENSE_PHOTOS`, `ExpensePhotoInput`, `expensePhotosFrom`, `saveExpensePhotos`, `expensePhotoIds` | `@/lib/db`, `@/lib/encoder-context`, `@/lib/photo-storage`, `@/lib/readable-id` |
| [lib/record-corrections.ts](../lib/record-corrections.ts) | `recordCorrection` | `@/lib/db`, `@/lib/readable-id` |
| [lib/remittance-deadline.ts](../lib/remittance-deadline.ts) | `REMITTANCE_CUTOFF`, `INCENTIVE_GRACE_DAYS`, `validTime`, `incentiveDeadline`, `keepsIncentive`, `manilaNow`, `manilaDateOf`, `formatDeadline` | `@/lib/date-format`, `@/lib/working-days`, `@/lib/manila-date` |
| [lib/remittance-discrepancy.ts](../lib/remittance-discrepancy.ts) | `DiscrepancyChange`, `DiscrepancyBreakdown`, `getDiscrepancyBreakdown` | `@/lib/db`, `@/lib/turnover-variance` |
| [lib/remittance-methods.ts](../lib/remittance-methods.ts) | `PaymentMethod`, `getPaymentMethods`, `findActivePaymentMethod`, `savePaymentMethod` | `@/lib/db`, `@/lib/readable-id` |
| [lib/remittance-workflow.ts](../lib/remittance-workflow.ts) | `RemittanceKind`, `SlipType`, `CashCollection`, `CashRemittance`, `forfeitsIncentive`, `amountDue`, `dateRemittedReasons`, `noIncentiveReasons`, `getRemittanceDashboard`, `RemittanceEntry`, `getRemittanceEntries`, `CASH_IN_FULL_NOTE`, `lockOutstandingRemittanceEntries`, `createCashRemittance`, `decideCashRemittance`, `undoRemittanceApproval`, `createFidelitySlip`, `editFidelitySlip`, `voidFidelitySlip`, `receivedAtOf`, `submitReadyEntries`, `submitCashAfterSave`, `resubmitReturned` | `@/lib/db`, `@/lib/sheets-on-db`, `@/lib/readable-id`, `@/lib/encoder-context`, `@/lib/remittance-deadline`, `@/lib/work-calendar`, `@/lib/cash-count`, `@/lib/receipt-photos`, `@/lib/clearing`, `@/lib/entry-batches`, `@/lib/incentive-decision`, `@/lib/date-format`, `@/lib/turnover-variance` |
| [lib/remittance.ts](../lib/remittance.ts) | `IncentiveTier`, `tiersForBranch`, `SaleIncentiveSetting`, `SaleProgram`, `normalizeSaleIncentive`, `calculateSaleIncentive`, `REACTIVATION_RATE`, `calculateRemittance`, `NO_INCENTIVE_REASON_MIN`, `noIncentiveReasonOf`, `withoutIncentive` | `./program-payment-limit.mjs` |
| [lib/report-periods.ts](../lib/report-periods.ts) | `PeriodKind`, `ClerkPeriod`, `isPeriodKind`, `spanText`, `monthName`, `monthOfMost`, `clerkPeriods`, `periodContaining`, `nextWeekStart`, `weeksAfterLastMonthly`, `monthlyProblem`, `ReportSpan`, `PeriodView`, `periodView`, `submitPeriod`, `resubmitPeriod`, `returnPeriod` | `@/lib/db`, `@/lib/encoder-context`, `@/lib/date-format`, `@/lib/readable-id`, `@/lib/remittance-deadline` |
| [lib/report-remarks.ts](../lib/report-remarks.ts) | `getReportRemarks`, `addReportRemark` | `@/lib/db`, `@/lib/readable-id` |
| [lib/report-week.ts](../lib/report-week.ts) | `monthEnd`, `reportWeek` | — |
| [lib/reports.ts](../lib/reports.ts) | `ReportLine`, `ReportSummary`, `buildOperationalReport` | `@/lib/db`, `@/lib/sheets-on-db`, `@/lib/google-sheets`, `@/lib/sheet-ranges`, `@/lib/manila-date`, `@/lib/person-scope` |
| [lib/roles.ts](../lib/roles.ts) | `RoleRecord`, `parsePageAccess`, `getRoles`, `createRole`, `updateRole`, `deleteRole` | `@/lib/db`, `@/lib/google-sheets`, `@/lib/encoder-context`, `@/lib/access-control`, `@/lib/page-catalog` |
| [lib/save-queue.ts](../lib/save-queue.ts) | `oldestPendingSave`, `onSaveQueueChange`, `installSaveQueue` | — |
| [lib/sale-submissions.ts](../lib/sale-submissions.ts) | `MAX_SUBMISSION_SALES`, `SaleSubmission`, `masProfile`, `listMySubmissions`, `submitSales`, `reviewBranches`, `listForReview`, `reviewableSubmission`, `markSubmissionSaved`, `returnSubmission` | `@/lib/access-control`, `@/lib/auth`, `@/lib/db`, `@/lib/employees`, `@/lib/encoder-context`, `@/lib/google-sheets-data`, `@/lib/readable-id`, `@/lib/remittance-deadline` |
| [lib/collection-submissions.ts](../lib/collection-submissions.ts) | `MAX_SUBMISSION_ENTRIES`, `SubmittedCollection`, `CollectionSubmission`, `myCollectionAccounts`, `listMyCollectionSubmissions`, `submitCollections`, `listCollectionsForReview`, `reviewableCollectionSubmission`, `markCollectionSubmissionRemitted`, `markCollectionSubmissionSaved`, `rejectCollectionSubmission` | `@/lib/account-rules`, `@/lib/account-data`, `@/lib/clearing`, `@/lib/clearing-kinds`, `@/lib/auth`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/mas-collection-quote`, `@/lib/readable-id`, `@/lib/remittance`, `@/lib/remittance-deadline`, `@/lib/sale-submissions`, `@/lib/work-calendar` |
| [lib/mas-collection-quote.ts](../lib/mas-collection-quote.ts) | `MAX_SUBMISSION_MONTHS`, `QuoteAccount`, `masCollectionQuote` | `@/lib/account-rules`, `@/lib/remittance` |
| [lib/server-environment.ts](../lib/server-environment.ts) | `RequiredServerVariable`, `readServerVariable`, `getMissingServerVariables`, `ServerConfigurationError`, `assertServerConfiguration`, `getAuthSecret` | — |
| [lib/session-account.ts](../lib/session-account.ts) | `SESSION_RECHECK_MS`, `passwordStamp`, `sessionFor`, `recheckSession` | `@/lib/auth`, `@/lib/google-sheets-data` |
| [lib/sheet-headers.ts](../lib/sheet-headers.ts) | `canonicalHeader`, `headerMatches` | — |
| [lib/sheet-ranges.ts](../lib/sheet-ranges.ts) | `COLLECTIONS_RANGE`, `SALES_RANGE`, `REMITTANCES_RANGE`, `REMITTANCE_LINKS_RANGE`, `PROGRAMS_RANGE`, `MEMBERS_RANGE` | — |
| [lib/sheet-rows.ts](../lib/sheet-rows.ts) | `deleteRowsWhere`, `deleteRowsById` | `@/lib/google-sheets` |
| [lib/sheets-on-db.ts](../lib/sheets-on-db.ts) | `SHEET_TITLES`, `tableOf`, `isDatabaseSheet`, `countSheetRows`, `columnLetters`, `parseA1`, `sheetsOnDb`, `readSheetRows`, `readSheetRowsNumbered`, `appendSheetRows` | `@/lib/db` |
| [lib/sheets-read-cache.ts](../lib/sheets-read-cache.ts) | `BUSY`, `SheetsReadCache`, `KeyedLock` | — |
| [lib/statement-of-account.ts](../lib/statement-of-account.ts) | `listStatementAccounts`, `getStatementOfAccount`, `setCollectionHead`, `StatementOfAccount` | `@/lib/account-rules`, `@/lib/account-data`, `@/lib/db`, `@/lib/system-settings`, `@/lib/manila-date` |
| [lib/system-health.ts](../lib/system-health.ts) | `IntegrityItem`, `IntegrityIssue`, `getSystemHealth`, `SystemHealth` | `@/db/migrations/meta/_journal.json`, `@/lib/db`, `@/lib/google-sheets`, `@/lib/users-sheet`, `@/lib/server-environment`, `@/lib/capacity`, `@/lib/maintenance-notice`, `@/lib/manila-date`, `@/lib/nightly-jobs` |
| [lib/system-settings.ts](../lib/system-settings.ts) | `isTodayMode`, `TODAY_MODE_LABELS`, `TODAY_MODES`, `TodayMode`, `getSetting`, `saveSetting`, `getTodayMode`, `setTodayMode` | `@/lib/db`, `@/lib/today-mode` |
| [lib/theme.ts](../lib/theme.ts) | `ThemePreference`, `THEME_KEY`, `themeBootScript`, `readTheme`, `resolveTheme`, `applyTheme`, `setTheme`, `watchTheme` | — |
| [lib/today-mode.ts](../lib/today-mode.ts) | `TODAY_MODES`, `TodayMode`, `TODAY_MODE_LABELS`, `isTodayMode` | — |
| [lib/todays-entries.ts](../lib/todays-entries.ts) | `DayEntry`, `getEntriesForDay`, `getEntriesForRange` | `@/lib/google-sheets`, `@/lib/sheet-ranges`, `@/lib/sheets-on-db`, `@/lib/remittance-deadline`, `@/lib/work-calendar`, `@/lib/date-checks`, `@/lib/receipt-photos`, `@/lib/entry-batches`, `@/lib/today-mode`, `@/lib/person-scope`, `@/lib/date-format` |
| [lib/turnover-variance.ts](../lib/turnover-variance.ts) | `TURNOVER_NOTE_MAX`, `varianceLabel`, `TurnoverVariance`, `recordTurnoverVariance`, `openVarianceFor`, `varianceOfSlip`, `variancesOfSlips`, `linkVarianceToSlip`, `decideVariance`, `reopenVariance`, `clerkTurnover`, `openVariances` | `@/lib/db`, `@/lib/readable-id`, `@/lib/encoder-context`, `@/lib/remittance-deadline`, `@/lib/entry-controls` |
| [lib/types.ts](../lib/types.ts) | `Address`, `PersonName`, `Claimant`, `Beneficiary`, `Member`, `Program`, `ProgramEnrollment`, `NewSale`, `Collection` | — |
| [lib/ui-preferences.ts](../lib/ui-preferences.ts) | `IndicatorStyle`, `TableDensity`, `preferenceKeys`, `ACTIVE_ROLE_COOKIE`, `writeActiveRoleCookie`, `readPreference`, `writePreference`, `removePreference`, `onPreferencesChange`, `readIndicator`, `readDensity` | — |
| [lib/use-form-draft.ts](../lib/use-form-draft.ts) | `useFormDraft`, `clearFormDrafts` | `@/lib/use-parked-drafts` |
| [lib/use-live-refresh.ts](../lib/use-live-refresh.ts) | `useLiveRefresh` | — |
| [lib/use-parked-drafts.ts](../lib/use-parked-drafts.ts) | `ParkedDraft`, `useParkedDrafts`, `clearParkedDrafts` | — |
| [lib/use-work-calendar.ts](../lib/use-work-calendar.ts) | `useDeclaredNonWorkingDays` | `@/lib/working-days` |
| [lib/users-sheet.ts](../lib/users-sheet.ts) | `USERS_RANGE`, `UserColumns`, `UserRecord`, `userColumns`, `readUserRows`, `loadUsers`, `userCell`, `assertUsernameColumnRemoved` | `@/lib/google-sheets`, `@/lib/encoder-schema`, `@/lib/sheet-headers` |
| [lib/utils.ts](../lib/utils.ts) | `cn` | — |
| [lib/work-calendar.ts](../lib/work-calendar.ts) | `declaredNonWorkingDays`, `loadWorkCalendar` | `@/lib/db`, `@/lib/google-sheets-data`, `@/lib/working-days` |
| [lib/working-days.ts](../lib/working-days.ts) | `DeclaredDay`, `WorkCalendar`, `isWorkingDay`, `nextWorkingDay`, `previousWorkingDay` | — |
| [lib/workspace-session.ts](../lib/workspace-session.ts) | `sessionForWorkspace` | `@/lib/access-control` |

## Components and UI connections

| File | Exported symbols | Local imports / re-exports |
| --- | --- | --- |
| [components/admin-delete.tsx](../components/admin-delete.tsx) | `AdminDeletePanel` | `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/admin-delete` |
| [components/app-dialog.tsx](../components/app-dialog.tsx) | `confirmDialog`, `promptDialog`, `alertDialog`, `AppDialogHost` | `@/components/ui/button`, `@/components/ui/input` |
| [components/save-queue-notice.tsx](../components/save-queue-notice.tsx) | `SaveQueueNotice` | `@/lib/save-queue` |
| [components/app-shell.tsx](../components/app-shell.tsx) | `ShellUser`, `AppShell` | `@/components/clearing-day-end`, `@/components/lunch-break-screen`, `@/components/save-queue-notice`, `@/lib/save-queue`, `@/components/sidebar`, `@/components/topbar`, `@/lib/access-control`, `@/lib/workspace-session`, `@/lib/navigation`, `@/lib/friendly-api-errors`, `@/lib/maintenance-notice-text`, `@/lib/use-live-refresh`, `@/lib/ui-preferences` |
| [components/attendance-calendar.tsx](../components/attendance-calendar.tsx) | `AttendanceCalendar` | `@/components/app-dialog`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/philippine-holidays`, `@/lib/date-format` |
| [components/batch-editor.tsx](../components/batch-editor.tsx) | `BatchEditor` | `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/api-response`, `@/lib/batch-edit`, `@/lib/entry-controls` |
| [components/brand-logo.tsx](../components/brand-logo.tsx) | `BrandLogo` | — |
| [components/bulk-member-transfer.tsx](../components/bulk-member-transfer.tsx) | `BulkMemberTransfer` | `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/components/transfer-branch-choice`, `@/lib/member-transfer` |
| [components/cash-out-fields.tsx](../components/cash-out-fields.tsx) | `CashOut`, `manilaToday`, `cashOutReady`, `CashOutFields` | `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select` |
| [components/clearing-day-end.tsx](../components/clearing-day-end.tsx) | `ClearingDayEndPrompt` | `@/components/ui/button`, `@/lib/clearing` |
| [components/clearing-picker.tsx](../components/clearing-picker.tsx) | `ClearingPicker` | `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/api-response`, `@/lib/clearing`, `@/lib/clearing-kinds`, `@/lib/use-live-refresh` |
| [components/clerk-report.tsx](../components/clerk-report.tsx) | `ClerkReport` | `@/components/app-dialog`, `@/components/brand-logo`, `@/components/entry-details`, `@/components/receipt-photo`, `@/components/receipt-photos-picker`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/input`, `@/lib/api-response`, `@/lib/clerk-report`, `@/lib/daily-audit`, `@/lib/report-periods`, `@/lib/expense-options`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| [components/clock-in-location-flag.tsx](../components/clock-in-location-flag.tsx) | `LocationCheck`, `ClockInLocationFlag` | `@/components/app-dialog`, `@/components/ui/button`, `@/lib/clock-in-location` |
| [components/company-reports.tsx](../components/company-reports.tsx) | `CompanyReports` | `@/components/metric-tile`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/api-response`, `@/lib/report-week`, `@/lib/reports`, `@/lib/use-live-refresh`, `@/lib/date-format` |
| [components/company-targets.tsx](../components/company-targets.tsx) | `CompanyTargets` | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label` |
| [components/control-total-field.tsx](../components/control-total-field.tsx) | `ControlTotalField` | `@/components/ui/input`, `@/components/ui/label`, `@/lib/entry-controls` |
| [components/entry-correction-form.tsx](../components/entry-correction-form.tsx) | `CorrectableEntry`, `EntryCorrectionForm` | `@/components/or-no-letter-check`, `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/api-response` |
| [components/entry-details.tsx](../components/entry-details.tsx) | `EntryDetails` | `@/components/receipt-photo`, `@/components/ui/button`, `@/lib/todays-entries` |
| [components/entry-editor.tsx](../components/entry-editor.tsx) | `EntryEditor` | `@/components/or-no-letter-check`, `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/api-response`, `@/lib/entry-edit`, `@/lib/date-format` |
| [components/executive-charts.tsx](../components/executive-charts.tsx) | `Legend`, `RevenueTrend`, `Columns`, `RankRow`, `RankBars`, `Change`, `ShareBar` | — |
| [components/executive-dashboard.tsx](../components/executive-dashboard.tsx) | `ExecutiveDashboard` | `@/components/company-targets`, `@/components/print-button`, `@/components/executive-charts`, `@/components/status-badge`, `@/components/ui/card`, `@/lib/executive-analytics`, `@/components/gross-sales-drilldown`, `@/lib/date-format` |
| [components/finance-dashboard.tsx](../components/finance-dashboard.tsx) | `FinanceDashboard` | `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/card`, `@/lib/executive-analytics`, `@/lib/remittance-workflow`, `@/lib/finance-operations`, `@/components/gross-sales-drilldown`, `@/lib/date-format` |
| [components/finance-settings.tsx](../components/finance-settings.tsx) | `FinanceSettings` | `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/api-response` |
| [components/gross-sales-drilldown.tsx](../components/gross-sales-drilldown.tsx) | `GrossSalesDrilldown` | `@/components/executive-charts`, `@/components/ui/input`, `@/lib/gross-sales`, `@/lib/date-format`, `@/lib/use-live-refresh` |
| [components/inline-panel.tsx](../components/inline-panel.tsx) | `InlinePanel`, `InlineRow` | `@/lib/utils` |
| [components/live-router-refresh.tsx](../components/live-router-refresh.tsx) | `LiveRouterRefresh` | `@/lib/use-live-refresh` |
| [components/lunch-break-screen.tsx](../components/lunch-break-screen.tsx) | `LunchBreakScreen` | `@/lib/lunch-break` |
| [components/maintenance-notice-panel.tsx](../components/maintenance-notice-panel.tsx) | `MaintenanceNoticePanel` | `@/components/ui/button`, `@/components/ui/card`, `@/lib/maintenance-notice-text`, `@/lib/date-format` |
| [components/mam-member-card.tsx](../components/mam-member-card.tsx) | `MamMemberCard` | `@/components/mam-status`, `@/components/ui/badge`, `@/lib/date-format`, `@/lib/mam-report` |
| [components/mam-print.tsx](../components/mam-print.tsx) | `MamPrint` | `@/components/brand-logo`, `@/lib/mam-report`, `@/lib/date-format` |
| [components/mam-status.tsx](../components/mam-status.tsx) | `mamStatusClass` | — |
| [components/mas-collection-list.tsx](../components/mas-collection-list.tsx) | `MasCollectionList` | `@/components/mam-status`, `@/components/metric-tile`, `@/components/ui/badge`, `@/components/ui/card`, `@/lib/date-format`, `@/lib/mas-collection` |
| [components/member-edit-form.tsx](../components/member-edit-form.tsx) | `MemberEditForm` | `@/components/ui/button`, `@/lib/api-response`, `@/lib/member-directory`, `@/lib/master-data-crud`, `@/lib/manila-date` |
| [components/member-mam.tsx](../components/member-mam.tsx) | `MemberMam` | `@/components/status-badge`, `@/lib/mam-format`, `@/lib/date-format`, `@/lib/use-live-refresh` |
| [components/metric-tile.tsx](../components/metric-tile.tsx) | `MetricTile` | `@/components/status-badge` |
| [components/my-attendance-history.tsx](../components/my-attendance-history.tsx) | `MyAttendanceHistory` | `@/lib/attendance-board`, `@/lib/date-format`, `@/lib/use-live-refresh` |
| [components/new-sales-form.tsx](../components/new-sales-form.tsx) | `NewSalesForm` | `@/components/app-dialog`, `@/lib/entry-check-reminder`, `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/account-rules`, `@/lib/account-data`, `@/lib/program-amount-lock`, `@/lib/use-work-calendar`, `@/components/control-total-field`, `@/lib/entry-controls`, `@/lib/date-checks`, `@/lib/remittance-deadline`, `@/lib/use-form-draft`, `@/components/remittance-summary`, `@/lib/remittance`, `@/components/ui/select`, `@/components/ui/separator`, `@/components/ui/textarea`, `@/lib/types`, `@/lib/use-live-refresh`, `@/components/clearing-picker`, `@/components/parked-drafts`, `@/components/receipt-photos-picker`, `@/lib/use-parked-drafts`, `@/lib/clearing-kinds`, `@/lib/enter-to-next`, `@/lib/date-format` |
| [components/nightly-jobs-panel.tsx](../components/nightly-jobs-panel.tsx) | `NightlyJobsPanel` | `@/components/ui/button`, `@/components/ui/card`, `@/lib/nightly-jobs`, `@/lib/date-format` |
| [components/nte-panel.tsx](../components/nte-panel.tsx) | `NtePanel` | `@/components/app-dialog`, `@/lib/use-live-refresh`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/search-select`, `@/lib/api-response`, `@/lib/nte`, `@/lib/date-format` |
| [components/one-time-password.tsx](../components/one-time-password.tsx) | `IssuedPassword`, `OneTimePasswordNotice` | `@/components/ui/button`, `@/lib/date-format` |
| [components/or-no-letter-check.tsx](../components/or-no-letter-check.tsx) | `OrNoLetterCheck` | `@/lib/access-control`, `@/lib/or-number`, `@/lib/ui-preferences` |
| [components/parked-drafts.tsx](../components/parked-drafts.tsx) | `ParkedDrafts` | `@/components/app-dialog`, `@/components/ui/button`, `@/lib/date-format` |
| [components/people-filter.tsx](../components/people-filter.tsx) | `FilterPerson`, `NO_BRANCH`, `usePeopleFilter` | `@/components/ui/button`, `@/components/ui/input`, `@/lib/ui-preferences` |
| [components/print-button.tsx](../components/print-button.tsx) | `PrintButton` | `@/components/ui/button` |
| [components/profile.tsx](../components/profile.tsx) | `Profile`, `permissionLabels`, `initials`, `Avatar`, `useProfile`, `ProfileDetails`, `ProfileMenu` | `@/components/status-badge`, `@/lib/utils`, `@/lib/ui-preferences`, `@/lib/use-form-draft`, `@/lib/date-format` |
| [components/receipt-photo.tsx](../components/receipt-photo.tsx) | `compressReceiptPhoto`, `ReceiptPhotoUpload`, `ReceiptPhotoView` | `@/components/ui/button` |
| [components/receipt-photos-picker.tsx](../components/receipt-photos-picker.tsx) | `PickedPhoto`, `ReceiptPhotosPicker`, `uploadBatchPhotos` | `@/components/receipt-photo` |
| [components/remittance-discrepancy.tsx](../components/remittance-discrepancy.tsx) | `RemittanceDiscrepancy` | `@/lib/api-response`, `@/lib/remittance-discrepancy`, `@/lib/date-format`, `@/lib/use-live-refresh` |
| [components/remittance-entries.tsx](../components/remittance-entries.tsx) | `RemittanceEntries` | `@/components/app-dialog`, `@/components/receipt-photo`, `@/components/status-badge`, `@/lib/api-response`, `@/lib/remittance-workflow`, `@/lib/date-format`, `@/lib/use-live-refresh` |
| [components/remittance-method-settings.tsx](../components/remittance-method-settings.tsx) | `RemittanceMethodSettings` | `@/components/inline-panel`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/api-response` |
| [components/remittance-summary.tsx](../components/remittance-summary.tsx) | `RemittanceSummary` | — |
| [components/report-tabs.tsx](../components/report-tabs.tsx) | `ReportTabs` | `@/components/clerk-report` |
| [components/sidebar.tsx](../components/sidebar.tsx) | `Sidebar`, `initials` | `@/components/app-shell`, `@/components/app-dialog`, `@/components/brand-logo`, `@/components/profile`, `@/lib/use-form-draft`, `@/components/theme-toggle`, `@/lib/navigation`, `@/lib/ui-preferences` |
| [components/status-badge.tsx](../components/status-badge.tsx) | `Tone`, `toneForStatus`, `StatusBadge` | — |
| [components/system-health-dashboard.tsx](../components/system-health-dashboard.tsx) | `SystemHealthDashboard` | `@/components/status-badge`, `@/components/ui/card`, `@/lib/system-health`, `@/components/maintenance-notice-panel`, `@/components/nightly-jobs-panel`, `@/lib/date-format` |
| [components/theme-toggle.tsx](../components/theme-toggle.tsx) | `useThemePreference`, `ThemeToggle` | `@/lib/theme` |
| [components/topbar-clock.tsx](../components/topbar-clock.tsx) | `TopbarClock` | — |
| [components/topbar.tsx](../components/topbar.tsx) | `Topbar` | `@/components/app-shell`, `@/components/profile`, `@/components/theme-toggle`, `@/components/topbar-clock`, `@/lib/navigation` |
| [components/transfer-branch-choice.tsx](../components/transfer-branch-choice.tsx) | `BranchChoice`, `noBranchChoice`, `branchesOutside`, `branchChoiceReady`, `TransferBranchChoice` | `@/components/ui/search-select` |
| [components/ui/badge.tsx](../components/ui/badge.tsx) | `Badge`, `badgeVariants` | — |
| [components/ui/button.tsx](../components/ui/button.tsx) | `Button`, `buttonVariants` | — |
| [components/ui/card.tsx](../components/ui/card.tsx) | `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardAction`, `CardDescription`, `CardContent` | — |
| [components/ui/input.tsx](../components/ui/input.tsx) | `Input` | — |
| [components/ui/label.tsx](../components/ui/label.tsx) | `Label` | — |
| [components/ui/search-select.tsx](../components/ui/search-select.tsx) | `SearchSelectOption`, `SearchSelect` | `@/lib/utils` |
| [components/ui/select.tsx](../components/ui/select.tsx) | `Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator`, `SelectTrigger`, `SelectValue` | `@/lib/utils` |
| [components/ui/separator.tsx](../components/ui/separator.tsx) | `Separator` | — |
| [components/ui/textarea.tsx](../components/ui/textarea.tsx) | `Textarea` | — |

## API dependencies

| File | Exported symbols | Local imports / re-exports |
| --- | --- | --- |
| [app/api/admin-delete/route.ts](../app/api/admin-delete/route.ts) | `GET`, `POST` | `@/lib/day-off`, `@/lib/auth-server`, `@/lib/admin-delete`, `@/lib/encoder-context` |
| [app/api/attendance-calendar/route.ts](../app/api/attendance-calendar/route.ts) | `GET`, `POST` | `@/lib/attendance-calendar`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/google-sheets-data` |
| [app/api/attendance-reviews/route.ts](../app/api/attendance-reviews/route.ts) | `GET`, `POST` | `@/lib/day-off`, `@/lib/encoder-context`, `@/lib/auto-absence`, `@/lib/employees`, `@/lib/attendance-data`, `@/lib/attendance`, `@/lib/attendance-calendar`, `@/lib/auth-server`, `@/lib/attendance-board`, `@/lib/google-sheets-data`, `@/lib/clock-in-checks` |
| [app/api/attendance-sheet/route.ts](../app/api/attendance-sheet/route.ts) | `GET` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/attendance`, `@/lib/attendance-board`, `@/lib/attendance-data`, `@/lib/attendance-sheet`, `@/lib/auto-absence`, `@/lib/employees`, `@/lib/payroll`, `@/lib/work-calendar` |
| [app/api/attendance-tracking/daily/route.ts](../app/api/attendance-tracking/daily/route.ts) | `GET`, `PATCH`, `POST` | `@/lib/day-off`, `@/lib/auth-server`, `@/lib/auto-absence`, `@/lib/encoder-context`, `@/lib/attendance-calendar`, `@/lib/attendance-data`, `@/lib/db`, `@/lib/attendance-board`, `@/lib/attendance`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/clock-in-checks`, `@/lib/date-format` |
| [app/api/attendance-tracking/location/route.ts](../app/api/attendance-tracking/location/route.ts) | `PATCH` | `@/lib/auth-server`, `@/lib/attendance`, `@/lib/attendance-board`, `@/lib/attendance-data`, `@/lib/clock-in-checks`, `@/lib/clock-in-location`, `@/lib/encoder-context`, `@/lib/date-format` |
| [app/api/attendance-tracking/route.ts](../app/api/attendance-tracking/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/attendance-board`, `@/lib/attendance-data`, `@/lib/employees`, `@/lib/google-sheets-data` |
| [app/api/attendance/history/route.ts](../app/api/attendance/history/route.ts) | `GET` | `@/lib/attendance`, `@/lib/attendance-data`, `@/lib/attendance-board`, `@/lib/auth-server` |
| [app/api/attendance/route.ts](../app/api/attendance/route.ts) | `GET`, `POST` | `@/lib/encoder-context`, `@/lib/auto-absence`, `@/lib/attendance-data`, `@/lib/attendance-calendar`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/clock-in-checks`, `@/lib/clock-in-location`, `@/lib/attendance`, `@/lib/auth-server` |
| [app/api/audit/route.ts](../app/api/audit/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/daily-audit`, `@/lib/report-periods`, `@/lib/encoder-context` |
| [app/api/audit/summary/route.ts](../app/api/audit/summary/route.ts) | `GET` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/daily-audit` |
| [app/api/auth/login/route.ts](../app/api/auth/login/route.ts) | `POST` | `@/lib/auth`, `@/lib/default-password`, `@/lib/passwords`, `@/lib/google-sheets`, `@/lib/google-sheets-data`, `@/lib/rate-limit`, `@/lib/session-account`, `@/lib/sheets-read-cache`, `@/lib/server-environment` |
| [app/api/auth/logout/route.ts](../app/api/auth/logout/route.ts) | `POST` | `@/lib/auth` |
| [app/api/auth/session/route.ts](../app/api/auth/session/route.ts) | `GET` | `@/lib/auth-server` |
| [app/api/branches/location/route.ts](../app/api/branches/location/route.ts) | `PUT` | `@/lib/attendance-board`, `@/lib/access-control`, `@/lib/auth-server`, `@/lib/clock-in-location`, `@/lib/encoder-context`, `@/lib/master-data-crud` |
| [app/api/branches/route.ts](../app/api/branches/route.ts) | `GET`, `POST`, `PUT`, `DELETE` | `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/attendance-board`, `@/lib/master-data-crud`, `@/lib/google-sheets-data` |
| [app/api/cash-transactions/route.ts](../app/api/cash-transactions/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/finance-data` |
| [app/api/clearing/open/route.ts](../app/api/clearing/open/route.ts) | `GET` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/clearing` |
| [app/api/clearing/route.ts](../app/api/clearing/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/day-off`, `@/lib/access-control`, `@/lib/auth-server`, `@/lib/clearing`, `@/lib/encoder-context` |
| [app/api/clerk-report/route.ts](../app/api/clerk-report/route.ts) | `GET`, `POST` | `@/lib/day-off`, `@/lib/access-control`, `@/lib/auth-server`, `@/lib/clerk-report`, `@/lib/daily-audit`, `@/lib/employees`, `@/lib/remittance-deadline`, `@/lib/report-remarks`, `@/lib/clerk-cash`, `@/lib/deposit-day`, `@/lib/encoder-context`, `@/lib/finance-data`, `@/lib/google-sheets-data`, `@/lib/receipt-photos`, `@/lib/remittance-workflow`, `@/lib/report-periods` |
| [app/api/collections/route.ts](../app/api/collections/route.ts) | `GET`, `POST` | `@/lib/day-off`, `@/lib/clearing`, `@/lib/or-number`, `@/lib/remittance-workflow`, `@/lib/readable-id`, `@/lib/remittance-deadline`, `@/lib/entry-controls`, `@/lib/turnover-variance`, `@/lib/work-calendar`, `@/lib/date-checks`, `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/db`, `@/lib/account-data`, `@/lib/account-rules`, `@/lib/remittance-methods`, `@/lib/remittance`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/duplicate-entries` |
| [app/api/commissions/route.ts](../app/api/commissions/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/earned-commissions`, `@/lib/encoder-context`, `@/lib/finance-operations` |
| [app/api/company-targets/route.ts](../app/api/company-targets/route.ts) | `POST` | `@/lib/auth-server`, `@/lib/company-targets`, `@/lib/encoder-context` |
| [app/api/cron/nightly/route.ts](../app/api/cron/nightly/route.ts) | `maxDuration`, `GET`, `POST` | `@/lib/auth-server`, `@/lib/access-control`, `@/lib/nightly-jobs` |
| [app/api/dashboard/gross-sales/route.ts](../app/api/dashboard/gross-sales/route.ts) | `GET` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/gross-sales` |
| [app/api/employees/route.ts](../app/api/employees/route.ts) | `GET`, `POST`, `PATCH`, `DELETE` | `@/lib/auth-server`, `@/lib/member-transfer`, `@/lib/employee-id-change`, `@/lib/encoder-context`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/master-data-crud`, `@/lib/employee-accounts`, `@/lib/privilege-guard` |
| [app/api/entry-corrections/route.ts](../app/api/entry-corrections/route.ts) | `GET`, `PATCH`, `PUT` | `@/lib/day-off`, `@/lib/access-control`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/entry-corrections`, `@/lib/or-no-letter`, `@/lib/entry-edit`, `@/lib/entry-search`, `@/lib/admin-delete`, `@/lib/employees`, `@/lib/google-sheets-data` |
| [app/api/exceptions/route.ts](../app/api/exceptions/route.ts) | `GET`, `PATCH` | `@/lib/day-off`, `@/lib/access-control`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/entry-corrections`, `@/lib/or-no-letter`, `@/lib/exceptions` |
| [app/api/expenses/route.ts](../app/api/expenses/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/day-off`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/finance-data`, `@/lib/receipt-photos` |
| [app/api/fidelity/route.ts](../app/api/fidelity/route.ts) | `GET`, `PATCH` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/fidelity`, `@/lib/encoder-context` |
| [app/api/finance-options/route.ts](../app/api/finance-options/route.ts) | `GET`, `POST` | `@/lib/encoder-context`, `@/lib/finance-access`, `@/lib/finance-operations`, `@/lib/google-sheets-data` |
| [app/api/fully-paid/route.ts](../app/api/fully-paid/route.ts) | `GET`, `POST` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/full-payments`, `@/lib/db` |
| [app/api/history/route.ts](../app/api/history/route.ts) | `GET`, `PATCH` | `@/lib/day-off`, `@/lib/sheets-on-db`, `@/lib/access-control`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/google-sheets`, `@/lib/entry-corrections`, `@/lib/or-no-letter`, `@/lib/encoder-schema`, `@/lib/audit-log` |
| [app/api/leave-approvals/route.ts](../app/api/leave-approvals/route.ts) | `GET`, `POST` | `@/lib/db`, `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/leave-data`, `@/lib/attendance-data`, `@/lib/employees` |
| [app/api/leave-requests/route.ts](../app/api/leave-requests/route.ts) | `GET`, `POST` | `@/lib/readable-id`, `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/leave-data` |
| [app/api/maintenance-notice/route.ts](../app/api/maintenance-notice/route.ts) | `GET`, `POST` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/maintenance-notice` |
| [app/api/mam/member/route.ts](../app/api/mam/member/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/member-scope`, `@/lib/account-data` |
| [app/api/mam/route.ts](../app/api/mam/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/member-scope`, `@/lib/encoder-context`, `@/lib/account-data`, `@/lib/mam-report`, `@/lib/account-rules`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/member-records` |
| [app/api/mas/route.ts](../app/api/mas/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/employees` |
| [app/api/member-corrections/route.ts](../app/api/member-corrections/route.ts) | `GET`, `POST` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/day-off`, `@/lib/encoder-context`, `@/lib/or-no-letter`, `@/lib/member-corrections` |
| [app/api/member-programs/check/route.ts](../app/api/member-programs/check/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/member-records` |
| [app/api/members/account-status/route.ts](../app/api/members/account-status/route.ts) | `POST` | `@/lib/account-deactivation`, `@/lib/encoder-context`, `@/lib/member-transfer` |
| [app/api/members/directory/route.ts](../app/api/members/directory/route.ts) | `GET`, `PATCH`, `DELETE` | `@/lib/access-control`, `@/lib/admin-delete`, `@/lib/member-scope`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/master-data-crud`, `@/lib/member-directory-data`, `@/lib/member-directory`, `@/lib/member-transfer`, `@/lib/account-deactivation`, `@/lib/program-transfer` |
| [app/api/members/route.ts](../app/api/members/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/member-records` |
| [app/api/members/standing/route.ts](../app/api/members/standing/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/account-data` |
| [app/api/members/transfer/route.ts](../app/api/members/transfer/route.ts) | `GET`, `POST` | `@/lib/encoder-context`, `@/lib/member-transfer` |
| [app/api/my-entries/batch/route.ts](../app/api/my-entries/batch/route.ts) | `GET`, `POST` | `@/lib/day-off`, `@/lib/access-control`, `@/lib/auth-server`, `@/lib/batch-edit`, `@/lib/db`, `@/lib/encoder-context` |
| [app/api/my-entries/route.ts](../app/api/my-entries/route.ts) | `GET`, `POST` | `@/lib/day-off`, `@/lib/access-control`, `@/lib/db`, `@/lib/auth-server`, `@/lib/daily-audit`, `@/lib/remittance-deadline`, `@/lib/todays-entries`, `@/lib/encoder-context`, `@/lib/remittance-workflow` |
| [app/api/notifications/route.ts](../app/api/notifications/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/maintenance-notice`, `@/lib/notifications` |
| [app/api/nte/mine/route.ts](../app/api/nte/mine/route.ts) | `GET`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/nte` |
| [app/api/nte/route.ts](../app/api/nte/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/nte` |
| [app/api/payroll/route.ts](../app/api/payroll/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/access-control`, `@/lib/encoder-context`, `@/lib/payroll` |
| [app/api/profile/route.ts](../app/api/profile/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/users-sheet` |
| [app/api/program-categories/route.ts](../app/api/program-categories/route.ts) | `GET`, `POST`, `PUT`, `DELETE` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/program-categories` |
| [app/api/program-incentives/route.ts](../app/api/program-incentives/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/google-sheets-data` |
| [app/api/programs/route.ts](../app/api/programs/route.ts) | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` | `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/master-data-crud`, `@/lib/program-incentive-store`, `@/lib/program-snapshot`, `@/lib/program-payment-limit.mjs`, `@/lib/google-sheets-data` |
| [app/api/programs/transfer/route.ts](../app/api/programs/transfer/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/program-transfer` |
| [app/api/receipt-photos/route.ts](../app/api/receipt-photos/route.ts) | `GET`, `POST` | `@/lib/day-off`, `@/lib/access-control`, `@/lib/db`, `@/lib/remittance-workflow`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/receipt-photos` |
| [app/api/remittance-methods/route.ts](../app/api/remittance-methods/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/remittance-methods` |
| [app/api/remittances/discrepancy/route.ts](../app/api/remittances/discrepancy/route.ts) | `GET` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/remittance-discrepancy` |
| [app/api/remittances/entries/route.ts](../app/api/remittances/entries/route.ts) | `GET` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/remittance-workflow` |
| [app/api/remittances/incentive/route.ts](../app/api/remittances/incentive/route.ts) | `PATCH` | `@/lib/auth-server`, `@/lib/access-control`, `@/lib/encoder-context`, `@/lib/incentive-decision` |
| [app/api/remittances/route.ts](../app/api/remittances/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/day-off`, `@/lib/admin-delete`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/remittance-workflow`, `@/lib/access-control` |
| [app/api/reports/route.ts](../app/api/reports/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/employees`, `@/lib/access-control`, `@/lib/reports`, `@/lib/encoder-context`, `@/lib/report-remarks` |
| [app/api/roles/route.ts](../app/api/roles/route.ts) | `GET`, `POST`, `PATCH`, `DELETE` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/privilege-guard`, `@/lib/roles` |
| [app/api/sale-submissions/route.ts](../app/api/sale-submissions/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/day-off`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/sale-submissions` |
| [app/api/sales/route.ts](../app/api/sales/route.ts) | `POST` | `@/lib/day-off`, `@/lib/clearing`, `@/lib/remittance-workflow`, `@/lib/auth-server`, `@/lib/program-amount-lock`, `@/lib/entry-controls`, `@/lib/date-checks`, `@/lib/work-calendar`, `@/lib/remittance-deadline`, `@/lib/encoder-context`, `@/lib/auth`, `@/lib/sale-submissions`, `@/lib/google-sheets-data`, `@/lib/member-records`, `@/lib/employees`, `@/lib/program-age`, `@/lib/account-rules`, `@/lib/db`, `@/lib/turnover-variance`, `@/lib/remittance`, `@/lib/duplicate-entries` |
| [app/api/sales/validate/route.ts](../app/api/sales/validate/route.ts) | `POST` | `@/lib/auth-server`, `@/lib/member-records` |
| [app/api/server-time/route.ts](../app/api/server-time/route.ts) | `GET` | — |
| [app/api/settings/route.ts](../app/api/settings/route.ts) | `PATCH` | `@/lib/auth-server`, `@/lib/db`, `@/lib/google-sheets`, `@/lib/auth`, `@/lib/default-password`, `@/lib/passwords`, `@/lib/session-account`, `@/lib/users-sheet` |
| [app/api/soa/route.ts](../app/api/soa/route.ts) | `GET`, `PATCH` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/statement-of-account` |
| [app/api/todays-entries/route.ts](../app/api/todays-entries/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/day-off`, `@/lib/access-control`, `@/lib/admin-delete`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/entry-corrections`, `@/lib/or-no-letter`, `@/lib/remittance-deadline`, `@/lib/system-settings`, `@/lib/todays-entries` |
| [app/api/user-accounts/password/route.ts](../app/api/user-accounts/password/route.ts) | `POST` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/master-data-crud`, `@/lib/privilege-guard` |
| [app/api/user-accounts/route.ts](../app/api/user-accounts/route.ts) | `GET`, `POST`, `PATCH`, `DELETE` | `@/lib/encoder-context`, `@/lib/employees`, `@/lib/employee-accounts`, `@/lib/auth-server`, `@/lib/master-data-crud`, `@/lib/google-sheets-data`, `@/lib/privilege-guard` |
| [app/api/vendor-payables/route.ts](../app/api/vendor-payables/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/finance-operations` |
| [app/api/work-calendar/route.ts](../app/api/work-calendar/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/work-calendar` |

## Page support files and root configuration

| File | Exported symbols | Local imports / re-exports |
| --- | --- | --- |
| [.env.example](../.env.example) | — | — |
| [app/attendance-tracking/attendance-sheet.tsx](../app/attendance-tracking/attendance-sheet.tsx) | `AttendanceSheet` | `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/components/people-filter`, `@/lib/attendance-sheet`, `@/lib/date-format`, `@/lib/use-live-refresh` |
| [app/attendance-tracking/daily-board.tsx](../app/attendance-tracking/daily-board.tsx) | `DailyBoard` | `@/components/app-dialog`, `@/components/clock-in-location-flag`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/use-live-refresh` |
| [app/branches/branch-locations.tsx](../app/branches/branch-locations.tsx) | `LocatedBranch`, `locationIsSet`, `BranchLocations` | `@/components/app-dialog`, `@/components/inline-panel`, `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/clock-in-location`, `@/lib/date-format` |
| [app/error.tsx](../app/error.tsx) | `PageError`, `default` | `@/components/ui/button` |
| [app/fidelity/fidelity-views.tsx](../app/fidelity/fidelity-views.tsx) | `MyFidelity`, `FidelityMonitoring` | `@/lib/use-live-refresh`, `@/components/cash-out-fields`, `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/search-select`, `@/components/ui/button`, `@/components/ui/card`, `@/lib/date-format`, `@/lib/fidelity-cap` |
| [app/global-error.tsx](../app/global-error.tsx) | `GlobalError`, `default` | `./globals.css`, `@/lib/theme` |
| [app/globals.css](../app/globals.css) | — | — |
| [app/layout.tsx](../app/layout.tsx) | `metadata`, `viewport`, `RootLayout`, `default` | `./globals.css`, `@/components/app-dialog`, `@/components/app-shell`, `@/lib/theme` |
| [app/loading.tsx](../app/loading.tsx) | `Loading`, `default` | — |
| [app/not-found.tsx](../app/not-found.tsx) | `NotFound`, `default` | `@/components/ui/button` |
| [app/programs/program-bulk-edit.tsx](../app/programs/program-bulk-edit.tsx) | `ProgramBulkEdit` | `@/components/app-dialog`, `@/components/ui/button`, `@/components/ui/input`, `./program-categories` |
| [app/programs/program-categories.tsx](../app/programs/program-categories.tsx) | `ProgramCategory`, `ProgramCategoriesManager` | `@/components/app-dialog`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input` |
| [app/programs/program-transfer.tsx](../app/programs/program-transfer.tsx) | `ProgramTransfer` | `@/components/app-dialog`, `@/components/ui/button`, `@/components/ui/search-select`, `@/lib/api-response`, `@/lib/program-transfer`, `@/lib/date-format` |
| [components.json](../components.json) | — | — |
| [eslint.config.mjs](../eslint.config.mjs) | — | — |
| [next.config.ts](../next.config.ts) | — | — |
| [package.json](../package.json) | — | — |
| [postcss.config.mjs](../postcss.config.mjs) | — | — |
| [proxy.ts](../proxy.ts) | `proxy`, `config` | `@/lib/auth`, `@/lib/access-control`, `@/lib/lunch-break`, `@/lib/session-account`, `@/lib/ui-preferences`, `@/lib/workspace-session` |
| [tsconfig.json](../tsconfig.json) | — | — |

## Maintenance scripts

These are an inventory, not instructions to run every script. Read each script's flags and affected sheets first. Migration, repair, import, and correction scripts can change real business data when configured against a workbook.

| Script | Imports | Supports literal --apply flag |
| --- | --- | --- |
| [scripts/_tmp-forf.mjs](../scripts/_tmp-forf.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/_tmp-g.mjs](../scripts/_tmp-g.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/_tmp-one-account.mjs](../scripts/_tmp-one-account.mjs) | `postgres` | No flag detected; read source before running |
| [scripts/add-or-branch-letters.mjs](../scripts/add-or-branch-letters.mjs) | `node:fs`, `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/assign-baranda-m-to-marites.mjs](../scripts/assign-baranda-m-to-marites.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/assign-mas-branches.mjs](../scripts/assign-mas-branches.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/assign-source86-to-cinde.mjs](../scripts/assign-source86-to-cinde.mjs) | `@next/env`, `postgres`, `node:fs` | Yes; read source for semantics |
| [scripts/audit-bracketing-source.mjs](../scripts/audit-bracketing-source.mjs) | `node:fs`, `node:crypto`, `@next/env`, `postgres`, `./legacy-sources.mjs`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/audit-database-data.mjs](../scripts/audit-database-data.mjs) | `node:fs`, `@next/env`, `postgres`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/audit-nop-offset-20261023.mjs](../scripts/audit-nop-offset-20261023.mjs) | `node:fs`, `node:crypto`, `@next/env`, `postgres`, `./legacy-sources.mjs`, `./source-history-rules.mjs`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/audit-other-program-source.mjs](../scripts/audit-other-program-source.mjs) | `node:fs`, `node:crypto`, `@next/env`, `postgres`, `./legacy-sources.mjs`, `../lib/account-rules.ts`, `./source-history-rules.mjs` | No flag detected; read source before running |
| [scripts/audit-sheet-database.mjs](../scripts/audit-sheet-database.mjs) | `node:fs`, `@next/env`, `googleapis` | No flag detected; read source before running |
| [scripts/audit-source-month-coverage.mjs](../scripts/audit-source-month-coverage.mjs) | `node:fs`, `node:crypto`, `@next/env`, `postgres`, `./legacy-sources.mjs`, `../lib/account-rules.ts`, `./source-cross-year-months.mjs` | No flag detected; read source before running |
| [scripts/check-12665b-link-private.mjs](../scripts/check-12665b-link-private.mjs) | `node:fs`, `@next/env`, `postgres`, `./source-history-rules.mjs` | No flag detected; read source before running |
| [scripts/check-clerk-report-saves.mjs](../scripts/check-clerk-report-saves.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/check-collections.mjs](../scripts/check-collections.mjs) | `@next/env`, `googleapis` | No flag detected; read source before running |
| [scripts/check-company-report.mjs](../scripts/check-company-report.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/check-database.mjs](../scripts/check-database.mjs) | `@next/env`, `node:fs`, `postgres` | No flag detected; read source before running |
| [scripts/check-fully-paid.mjs](../scripts/check-fully-paid.mjs) | `node:fs`, `exceljs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/check-incentive-periods.mjs](../scripts/check-incentive-periods.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/check-mas-members.mjs](../scripts/check-mas-members.mjs) | `@next/env`, `postgres`, `node:fs`, `./legacy-sources.mjs`, `./name-match.mjs` | No flag detected; read source before running |
| [scripts/check-member-transfer.mjs](../scripts/check-member-transfer.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/check-name-links.mjs](../scripts/check-name-links.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/check-owner-receipts-private.mjs](../scripts/check-owner-receipts-private.mjs) | `node:fs`, `@next/env`, `postgres`, `./source-history-rules.mjs` | No flag detected; read source before running |
| [scripts/check-pacios-report-20261016.mjs](../scripts/check-pacios-report-20261016.mjs) | `node:fs`, `@next/env`, `postgres`, `../lib/entry-finance.mjs` | No flag detected; read source before running |
| [scripts/check-pending-receipts.mjs](../scripts/check-pending-receipts.mjs) | `node:fs`, `@next/env`, `googleapis`, `postgres` | No flag detected; read source before running |
| [scripts/check-quinones-split-20261019.mjs](../scripts/check-quinones-split-20261019.mjs) | `@next/env`, `postgres`, `node:fs`, `node:assert/strict` | No flag detected; read source before running |
| [scripts/clear-payroll-runs.mjs](../scripts/clear-payroll-runs.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/clear-rutchelyn-report-20261021.mts](../scripts/clear-rutchelyn-report-20261021.mts) | `@next/env`, `drizzle-orm`, `@/lib/admin-delete`, `@/lib/db`, `@/lib/encoder-context` | Yes; read source for semantics |
| [scripts/compare-double-accounts.mjs](../scripts/compare-double-accounts.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/compare-duplicates.mjs](../scripts/compare-duplicates.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/complete-old-site-reports.mjs](../scripts/complete-old-site-reports.mjs) | `node:fs`, `node:path`, `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/consolidate-member-receipts.mjs](../scripts/consolidate-member-receipts.mjs) | `node:fs`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/copy-legacy-import.mjs](../scripts/copy-legacy-import.mjs) | `node:fs`, `postgres` | Yes; read source for semantics |
| [scripts/copy-sheets-to-postgres.mjs](../scripts/copy-sheets-to-postgres.mjs) | `@next/env`, `googleapis`, `postgres` | Yes; read source for semantics |
| [scripts/correct-ciara-mas-split-20261014.mjs](../scripts/correct-ciara-mas-split-20261014.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/correct-d350-receipts.mjs](../scripts/correct-d350-receipts.mjs) | `@next/env`, `postgres`, `node:fs`, `./legacy-sources.mjs` | Yes; read source for semantics |
| [scripts/correct-employee-id.mjs](../scripts/correct-employee-id.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/correct-or12617-owner-20261020.mjs](../scripts/correct-or12617-owner-20261020.mjs) | `node:fs`, `node:assert/strict`, `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/delete-test-entries.mts](../scripts/delete-test-entries.mts) | `@next/env` | Yes; read source for semantics |
| [scripts/exceptions-summary.mts](../scripts/exceptions-summary.mts) | `node:fs`, `@next/env` | No flag detected; read source before running |
| [scripts/fill-member-contacts.mjs](../scripts/fill-member-contacts.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/find-d210-split-histories.mjs](../scripts/find-d210-split-histories.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/find-duplicate-members-20261023.mjs](../scripts/find-duplicate-members-20261023.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/find-misfiled-program-receipts.mjs](../scripts/find-misfiled-program-receipts.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/find-name-variants.mjs](../scripts/find-name-variants.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/find-older-receipts-private.mjs](../scripts/find-older-receipts-private.mjs) | `node:fs`, `./legacy-sources.mjs`, `./source-history-rules.mjs` | No flag detected; read source before running |
| [scripts/find-shifted-coverage.mjs](../scripts/find-shifted-coverage.mjs) | `node:fs`, `@next/env`, `postgres`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/find-split-program-candidates.mjs](../scripts/find-split-program-candidates.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/fix-21532-21533-receipts.mjs](../scripts/fix-21532-21533-receipts.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-amounts.mjs](../scripts/fix-amounts.mjs) | `node:fs`, `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/fix-copy-exception-dates.mjs](../scripts/fix-copy-exception-dates.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-duplicates.mjs](../scripts/fix-duplicates.mjs) | `@next/env`, `node:fs`, `postgres` | Yes; read source for semantics |
| [scripts/fix-duplicates.mts](../scripts/fix-duplicates.mts) | `node:fs`, `@next/env` | Yes; read source for semantics |
| [scripts/fix-gotual-incentives.mjs](../scripts/fix-gotual-incentives.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-impossible-doi.mjs](../scripts/fix-impossible-doi.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/fix-legacy-receipts.mjs](../scripts/fix-legacy-receipts.mjs) | `node:fs`, `node:crypto`, `@next/env`, `googleapis`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/fix-merge-mas.mjs](../scripts/fix-merge-mas.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-older-clearing-covers.mjs](../scripts/fix-older-clearing-covers.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-or-letters.mjs](../scripts/fix-or-letters.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-owner-receipt-dates-private.mjs](../scripts/fix-owner-receipt-dates-private.mjs) | `node:fs`, `node:assert/strict`, `@next/env`, `postgres`, `./source-history-rules.mjs` | Yes; read source for semantics |
| [scripts/fix-ph11841180-coverage.mjs](../scripts/fix-ph11841180-coverage.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/fix-ph13437031-nop.mjs](../scripts/fix-ph13437031-nop.mjs) | `node:fs`, `node:assert/strict`, `node:util`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `./source-history-rules.mjs` | Yes; read source for semantics |
| [scripts/fix-ph21342295-remittance-dates.mjs](../scripts/fix-ph21342295-remittance-dates.mjs) | `node:fs`, `node:assert/strict`, `@next/env`, `postgres`, `./source-history-rules.mjs` | Yes; read source for semantics |
| [scripts/fix-ph29986586-dsp290.mjs](../scripts/fix-ph29986586-dsp290.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/fix-ph34623670-branch.mjs](../scripts/fix-ph34623670-branch.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-ph46732266-details.mjs](../scripts/fix-ph46732266-details.mjs) | `node:fs`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs`, `node:util` | Yes; read source for semantics |
| [scripts/fix-ph56409915-year.mjs](../scripts/fix-ph56409915-year.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/fix-ph73303959-or-date.mjs](../scripts/fix-ph73303959-or-date.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/fix-ph80673488-d250fg.mjs](../scripts/fix-ph80673488-d250fg.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/fix-ph97483925-month-of.mts](../scripts/fix-ph97483925-month-of.mts) | `@next/env` | Yes; read source for semantics |
| [scripts/fix-program-move-months-20261021.mts](../scripts/fix-program-move-months-20261021.mts) | `@next/env`, `drizzle-orm`, `@/lib/account-rules`, `@/lib/account-data`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/entry-edit`, `@/lib/readable-id` | Yes; read source for semantics |
| [scripts/fix-registration-fee-nops-20261021.mts](../scripts/fix-registration-fee-nops-20261021.mts) | `@next/env`, `drizzle-orm`, `@/lib/account-rules`, `@/lib/account-data`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/entry-edit`, `@/lib/readable-id` | Yes; read source for semantics |
| [scripts/fix-rem-gudn-duplicate.mjs](../scripts/fix-rem-gudn-duplicate.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-remitted-before-receipt.mjs](../scripts/fix-remitted-before-receipt.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-seven-member-dates-20261023.mjs](../scripts/fix-seven-member-dates-20261023.mjs) | `node:fs`, `node:assert/strict`, `@next/env`, `postgres`, `./source-history-rules.mjs` | Yes; read source for semantics |
| [scripts/fix-tangal-incentives.mjs](../scripts/fix-tangal-incentives.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/flag-ph96295172-receipt.mjs](../scripts/flag-ph96295172-receipt.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/generate-code-reference.mjs](../scripts/generate-code-reference.mjs) | `node:fs`, `node:path`, `typescript` | Yes; read source for semantics |
| [scripts/hash-password.mjs](../scripts/hash-password.mjs) | `bcryptjs` | No flag detected; read source before running |
| [scripts/import-fidelity-opening-20261023.mts](../scripts/import-fidelity-opening-20261023.mts) | `node:fs`, `@next/env`, `exceljs`, `drizzle-orm`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/fidelity`, `@/lib/readable-id` | Yes; read source for semantics |
| [scripts/import-fully-paid.mjs](../scripts/import-fully-paid.mjs) | `node:fs`, `exceljs`, `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/import-lugon-2025.mjs](../scripts/import-lugon-2025.mjs) | `@next/env`, `postgres`, `node:crypto`, `node:fs`, `./legacy-sources.mjs`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/import-paper-attendance-20261015.mjs](../scripts/import-paper-attendance-20261015.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/import-receipt-private.mjs](../scripts/import-receipt-private.mjs) | `node:fs`, `node:assert/strict`, `node:crypto`, `@next/env`, `postgres`, `./source-history-rules.mjs`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/insert-held-legacy-receipts.mts](../scripts/insert-held-legacy-receipts.mts) | `node:fs`, `@next/env` | Yes; read source for semantics |
| [scripts/inspect-account-program.mjs](../scripts/inspect-account-program.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-account-status.mjs](../scripts/inspect-account-status.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/inspect-clerk-pending-cash.mjs](../scripts/inspect-clerk-pending-cash.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-clerk-report.cjs](../scripts/inspect-clerk-report.cjs) | See source | No flag detected; read source before running |
| [scripts/inspect-discrepancy-920-20261019.mjs](../scripts/inspect-discrepancy-920-20261019.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-entry-clearings.mjs](../scripts/inspect-entry-clearings.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-legacy-sheets.mjs](../scripts/inspect-legacy-sheets.mjs) | `@next/env`, `googleapis`, `./legacy-sources.mjs` | No flag detected; read source before running |
| [scripts/inspect-lugon-import.mjs](../scripts/inspect-lugon-import.mjs) | `./legacy-sources.mjs`, `node:fs` | No flag detected; read source before running |
| [scripts/inspect-member-pair.mjs](../scripts/inspect-member-pair.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-member-source-private.mjs](../scripts/inspect-member-source-private.mjs) | `node:fs`, `node:crypto`, `./legacy-sources.mjs`, `./source-history-rules.mjs`, `./source-cross-year-months.mjs` | No flag detected; read source before running |
| [scripts/inspect-member-source-rows.mjs](../scripts/inspect-member-source-rows.mjs) | `node:fs`, `node:crypto`, `@next/env`, `postgres`, `./legacy-sources.mjs` | No flag detected; read source before running |
| [scripts/inspect-month-coverage.mjs](../scripts/inspect-month-coverage.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-nine-receipt-owner-20261019.mjs](../scripts/inspect-nine-receipt-owner-20261019.mjs) | `node:fs`, `node:crypto`, `@next/env`, `postgres`, `./legacy-sources.mjs` | No flag detected; read source before running |
| [scripts/inspect-or-member-20261017.mjs](../scripts/inspect-or-member-20261017.mjs) | `@next/env`, `postgres`, `./legacy-sources.mjs` | No flag detected; read source before running |
| [scripts/inspect-or12617b-20261020.mjs](../scripts/inspect-or12617b-20261020.mjs) | `node:fs`, `@next/env`, `postgres`, `./legacy-sources.mjs` | No flag detected; read source before running |
| [scripts/inspect-ph97483925-split.mjs](../scripts/inspect-ph97483925-split.mjs) | `@next/env`, `postgres`, `node:crypto`, `node:fs`, `./legacy-sources.mjs` | No flag detected; read source before running |
| [scripts/inspect-program-incentives.mjs](../scripts/inspect-program-incentives.mjs) | `@next/env`, `postgres`, `../lib/remittance.ts` | No flag detected; read source before running |
| [scripts/inspect-program-tiers.mjs](../scripts/inspect-program-tiers.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-remittance-approval.mjs](../scripts/inspect-remittance-approval.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-rutchelyn-clearing.mjs](../scripts/inspect-rutchelyn-clearing.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-same-person.mjs](../scripts/inspect-same-person.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/inspect-sheet-headers.mjs](../scripts/inspect-sheet-headers.mjs) | `@next/env`, `googleapis` | No flag detected; read source before running |
| [scripts/inspect-sobrera-source.mjs](../scripts/inspect-sobrera-source.mjs) | `./legacy-sources.mjs`, `node:fs` | No flag detected; read source before running |
| [scripts/legacy-programs.mjs](../scripts/legacy-programs.mjs) | `node:fs`, `@next/env`, `googleapis`, `./legacy-sources.mjs` | Yes; read source for semantics |
| [scripts/legacy-site-compare.mjs](../scripts/legacy-site-compare.mjs) | `@next/env`, `node:fs`, `postgres` | No flag detected; read source before running |
| [scripts/legacy-site-export.mjs](../scripts/legacy-site-export.mjs) | `node:fs`, `node:path`, `node:stream`, `node:stream/promises` | No flag detected; read source before running |
| [scripts/legacy-site-survey.mjs](../scripts/legacy-site-survey.mjs) | `node:fs`, `node:path`, `node:stream`, `node:stream/promises` | No flag detected; read source before running |
| [scripts/legacy-sources.mjs](../scripts/legacy-sources.mjs) | `node:fs`, `node:path` | No flag detected; read source before running |
| [scripts/link-cinde-calumbay.mjs](../scripts/link-cinde-calumbay.mjs) | `@next/env`, `postgres`, `node:fs` | Yes; read source for semantics |
| [scripts/link-legacy-mas.mjs](../scripts/link-legacy-mas.mjs) | `@next/env`, `postgres`, `node:fs`, `./legacy-sources.mjs`, `node:crypto` | Yes; read source for semantics |
| [scripts/list-programs.mjs](../scripts/list-programs.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/locate-receipt-private.mjs](../scripts/locate-receipt-private.mjs) | `node:fs`, `@next/env`, `postgres`, `./source-history-rules.mjs` | No flag detected; read source before running |
| [scripts/lookup-records.mjs](../scripts/lookup-records.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/member-accounts.mjs](../scripts/member-accounts.mjs) | `@next/env`, `postgres`, `./legacy-sources.mjs`, `node:fs`, `node:crypto` | No flag detected; read source before running |
| [scripts/merge-employee-pair.mjs](../scripts/merge-employee-pair.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/merge-employees.mjs](../scripts/merge-employees.mjs) | `node:fs`, `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/merge-legacy-mas.mjs](../scripts/merge-legacy-mas.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/merge-members.mjs](../scripts/merge-members.mjs) | `node:fs`, `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/merge-name-variants.mjs](../scripts/merge-name-variants.mjs) | `node:fs`, `node:crypto`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/merge-ph30278224-ph22250072.mjs](../scripts/merge-ph30278224-ph22250072.mjs) | `node:fs`, `node:assert/strict`, `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/merge-ph46732266-ph95168214.mjs](../scripts/merge-ph46732266-ph95168214.mjs) | `@next/env`, `postgres`, `../lib/entry-finance.mjs`, `node:util` | Yes; read source for semantics |
| [scripts/migrate-account-status.mjs](../scripts/migrate-account-status.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-audit-transfers.mjs](../scripts/migrate-audit-transfers.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-batch-extras.mjs](../scripts/migrate-batch-extras.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-branch-assignments.mjs](../scripts/migrate-branch-assignments.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-collector-role.mjs](../scripts/migrate-collector-role.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-database-headers.mjs](../scripts/migrate-database-headers.mjs) | `node:fs`, `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-employee-login.mjs](../scripts/migrate-employee-login.mjs) | `node:fs`, `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-employees.mjs](../scripts/migrate-employees.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-encoder-tracking.mjs](../scripts/migrate-encoder-tracking.mjs) | `@next/env`, `googleapis`, `../lib/encoder-schema.ts` | Yes; read source for semantics |
| [scripts/migrate-expense-fields.mjs](../scripts/migrate-expense-fields.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-finance.mjs](../scripts/migrate-finance.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-legacy-members.mjs](../scripts/migrate-legacy-members.mjs) | `node:crypto`, `node:fs`, `@next/env`, `googleapis`, `../lib/account-rules.ts`, `./legacy-sources.mjs` | Yes; read source for semantics |
| [scripts/migrate-legacy-site.mjs](../scripts/migrate-legacy-site.mjs) | `node:crypto`, `node:fs`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/migrate-payroll.mjs](../scripts/migrate-payroll.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-period-audits.mjs](../scripts/migrate-period-audits.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-primary-branch.mjs](../scripts/migrate-primary-branch.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-program-age.mjs](../scripts/migrate-program-age.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-program-amount-lock.mjs](../scripts/migrate-program-amount-lock.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-program-categories.mjs](../scripts/migrate-program-categories.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-program-rules.mjs](../scripts/migrate-program-rules.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-readable-ids.mjs](../scripts/migrate-readable-ids.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-remittance-deadline.mjs](../scripts/migrate-remittance-deadline.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-remittance-methods.mjs](../scripts/migrate-remittance-methods.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-remittance-penalty.mjs](../scripts/migrate-remittance-penalty.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-remittance-workflow.mjs](../scripts/migrate-remittance-workflow.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-roles.mjs](../scripts/migrate-roles.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-sale-incentives.mjs](../scripts/migrate-sale-incentives.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-sales-remittance.mjs](../scripts/migrate-sales-remittance.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/migrate-single-address.mjs](../scripts/migrate-single-address.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/move-expense-accounts-20261022.mts](../scripts/move-expense-accounts-20261022.mts) | `@next/env`, `drizzle-orm`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/expense-options`, `@/lib/readable-id` | Yes; read source for semantics |
| [scripts/move-photos-to-storage.mjs](../scripts/move-photos-to-storage.mjs) | `@next/env`, `@supabase/supabase-js`, `postgres` | Yes; read source for semantics |
| [scripts/move-program-accounts.mjs](../scripts/move-program-accounts.mjs) | `node:fs`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/name-match.mjs](../scripts/name-match.mjs) | See source | No flag detected; read source before running |
| [scripts/prepare-owner-12665b-private.mjs](../scripts/prepare-owner-12665b-private.mjs) | `node:fs`, `@next/env`, `postgres`, `node:assert/strict`, `node:crypto`, `./source-history-rules.mjs`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/prepare-receipt-import-private.mjs](../scripts/prepare-receipt-import-private.mjs) | `node:fs`, `@next/env`, `postgres`, `node:crypto`, `./legacy-sources.mjs`, `./source-history-rules.mjs`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/preview-month-of-status-rule.mjs](../scripts/preview-month-of-status-rule.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/prod.mjs](../scripts/prod.mjs) | `node:child_process`, `node:fs` | No flag detected; read source before running |
| [scripts/program-history.mjs](../scripts/program-history.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/reassign-ciara-ns-20261014.mjs](../scripts/reassign-ciara-ns-20261014.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/reassign-col3650697726.mjs](../scripts/reassign-col3650697726.mjs) | `node:fs`, `node:assert/strict`, `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/recalculate-moved-date-remitted.mts](../scripts/recalculate-moved-date-remitted.mts) | `drizzle-orm`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/remittance-deadline`, `@/lib/remittance-workflow` | Yes; read source for semantics |
| [scripts/receipt-import-progress.mjs](../scripts/receipt-import-progress.mjs) | `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/recheck-forfeited-accounts.mjs](../scripts/recheck-forfeited-accounts.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/register-legacy-mas.mjs](../scripts/register-legacy-mas.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/remove-blank-rows.mjs](../scripts/remove-blank-rows.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/remove-oct10-expense.mjs](../scripts/remove-oct10-expense.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/repair-account-source-history.mjs](../scripts/repair-account-source-history.mjs) | `node:fs`, `node:util`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/repair-bracketing-source.mjs](../scripts/repair-bracketing-source.mjs) | `node:fs`, `node:assert/strict`, `@next/env`, `postgres`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/repair-branch-ids.mjs](../scripts/repair-branch-ids.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/repair-nop-offset-20261023.mjs](../scripts/repair-nop-offset-20261023.mjs) | `node:fs`, `node:assert/strict`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/repair-other-program-source.mjs](../scripts/repair-other-program-source.mjs) | `node:fs`, `node:assert/strict`, `@next/env`, `postgres`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/repair-sheet-rows.mjs](../scripts/repair-sheet-rows.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/repair-source-month-coverage.mjs](../scripts/repair-source-month-coverage.mjs) | `node:assert/strict`, `node:fs`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/report-other-program-source.mjs](../scripts/report-other-program-source.mjs) | `node:fs` | Yes; read source for semantics |
| [scripts/reprice-corrected-entries.mjs](../scripts/reprice-corrected-entries.mjs) | `node:fs`, `@next/env`, `postgres`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/reprice-legacy-weeks.mjs](../scripts/reprice-legacy-weeks.mjs) | `@next/env`, `postgres`, `../lib/entry-finance.mjs`, `../lib/remittance.ts` | Yes; read source for semantics |
| [scripts/resolve-older-source-coverage-private.mjs](../scripts/resolve-older-source-coverage-private.mjs) | `node:fs`, `./source-history-rules.mjs`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/restore-clearing-incentives.mts](../scripts/restore-clearing-incentives.mts) | `@next/env`, `drizzle-orm`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/remittance-deadline`, `@/lib/remittance-workflow`, `@/lib/work-calendar` | Yes; read source for semantics |
| [scripts/restore-ph70661323-4191s.mjs](../scripts/restore-ph70661323-4191s.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts` | Yes; read source for semantics |
| [scripts/restore-program-move-repair-20261021.mts](../scripts/restore-program-move-repair-20261021.mts) | `@next/env`, `drizzle-orm`, `@/lib/account-rules`, `@/lib/account-data`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/entry-edit`, `@/lib/readable-id` | Yes; read source for semantics |
| [scripts/restore-resubmit-incentives.mjs](../scripts/restore-resubmit-incentives.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/revert-old-site-reports.mjs](../scripts/revert-old-site-reports.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/review-amount-discrepancies.mjs](../scripts/review-amount-discrepancies.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/review-member-finance-private.mjs](../scripts/review-member-finance-private.mjs) | `node:fs`, `@next/env`, `postgres`, `../lib/entry-finance.mjs` | No flag detected; read source before running |
| [scripts/review-member-private.mjs](../scripts/review-member-private.mjs) | `node:fs`, `@next/env`, `postgres`, `./source-history-rules.mjs`, `node:util`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/review-same-base-pay.mjs](../scripts/review-same-base-pay.mjs) | `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/scan-receipt-workbooks-private.mjs](../scripts/scan-receipt-workbooks-private.mjs) | `node:fs`, `./legacy-sources.mjs`, `./source-history-rules.mjs` | No flag detected; read source before running |
| [scripts/set-clearing-covers.mjs](../scripts/set-clearing-covers.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/set-collector-tiers.mts](../scripts/set-collector-tiers.mts) | `drizzle-orm`, `@/lib/batch-edit`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/remittance-workflow` | Yes; read source for semantics |
| [scripts/source-cross-year-months.mjs](../scripts/source-cross-year-months.mjs) | See source | No flag detected; read source before running |
| [scripts/source-history-rules.mjs](../scripts/source-history-rules.mjs) | `../lib/account-rules.ts`, `./source-cross-year-months.mjs` | No flag detected; read source before running |
| [scripts/split-member.mjs](../scripts/split-member.mjs) | `node:fs`, `node:crypto`, `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/split-ph97483925-jr-sr.mjs](../scripts/split-ph97483925-jr-sr.mjs) | `@next/env`, `postgres`, `node:crypto` | Yes; read source for semantics |
| [scripts/test-access-control.mjs](../scripts/test-access-control.mjs) | `node:assert/strict`, `node:test`, `../lib/access-control.ts` | No flag detected; read source before running |
| [scripts/test-account-rules.mjs](../scripts/test-account-rules.mjs) | `node:assert/strict`, `node:test`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/test-attendance-board.mjs](../scripts/test-attendance-board.mjs) | `node:assert/strict`, `node:test`, `../lib/attendance-board.ts` | No flag detected; read source before running |
| [scripts/test-attendance-rules.mjs](../scripts/test-attendance-rules.mjs) | `node:assert/strict`, `node:test`, `../lib/attendance.ts`, `../lib/clock-in-location.ts` | No flag detected; read source before running |
| [scripts/test-date-format.mjs](../scripts/test-date-format.mjs) | `node:assert/strict`, `node:test`, `../lib/date-format.ts` | No flag detected; read source before running |
| [scripts/test-encoder-tracking.cjs](../scripts/test-encoder-tracking.cjs) | See source | No flag detected; read source before running |
| [scripts/test-entry-finance.mjs](../scripts/test-entry-finance.mjs) | `node:assert/strict`, `node:test`, `@electric-sql/pglite`, `../lib/entry-finance.mjs` | No flag detected; read source before running |
| [scripts/test-manila-date.mjs](../scripts/test-manila-date.mjs) | `node:assert/strict`, `node:test`, `../lib/manila-date.ts` | No flag detected; read source before running |
| [scripts/test-money-rules.mjs](../scripts/test-money-rules.mjs) | `node:assert/strict`, `node:test`, `../lib/remittance.ts`, `../lib/account-rules.ts`, `../lib/fidelity-cap.ts` | No flag detected; read source before running |
| [scripts/test-program-payment-limit.mjs](../scripts/test-program-payment-limit.mjs) | `node:assert/strict`, `node:test`, `../lib/program-payment-limit.mjs`, `../lib/account-rules.ts`, `../lib/remittance.ts` | No flag detected; read source before running |
| [scripts/test-remittance.mjs](../scripts/test-remittance.mjs) | `node:assert/strict`, `node:test`, `../lib/remittance.ts` | No flag detected; read source before running |
| [scripts/test-sheets-cache.mjs](../scripts/test-sheets-cache.mjs) | `node:test`, `node:assert/strict`, `../lib/sheets-read-cache.ts` | No flag detected; read source before running |
| [scripts/test-source-covered-months.mjs](../scripts/test-source-covered-months.mjs) | `node:test`, `node:assert/strict`, `./source-cross-year-months.mjs` | No flag detected; read source before running |
| [scripts/test-source-history-rules.mjs](../scripts/test-source-history-rules.mjs) | `node:test`, `node:assert/strict`, `./source-history-rules.mjs` | No flag detected; read source before running |
| [scripts/time-dashboards.mts](../scripts/time-dashboards.mts) | `@next/env` | No flag detected; read source before running |
| [scripts/trace-member-receipts-private.mjs](../scripts/trace-member-receipts-private.mjs) | `node:fs`, `@next/env`, `postgres`, `./source-history-rules.mjs` | No flag detected; read source before running |
| [scripts/transfer-mas-members.mjs](../scripts/transfer-mas-members.mjs) | `@next/env`, `postgres`, `node:fs`, `./name-match.mjs` | Yes; read source for semantics |
| [scripts/transfer-ph56293596-dpb1000.mjs](../scripts/transfer-ph56293596-dpb1000.mjs) | `@next/env`, `postgres`, `../lib/account-rules.ts`, `../lib/entry-finance.mjs` | Yes; read source for semantics |
| [scripts/verify-four-d210-splits-20261019.mjs](../scripts/verify-four-d210-splits-20261019.mjs) | `node:assert/strict`, `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/verify-source-span-fixes-20261019.mjs](../scripts/verify-source-span-fixes-20261019.mjs) | `node:assert/strict`, `node:fs`, `@next/env`, `postgres` | No flag detected; read source before running |
| [scripts/web-left-out-sheet.mjs](../scripts/web-left-out-sheet.mjs) | `node:fs` | No flag detected; read source before running |

## Configuration and public text files

- [config/amount-fixes.json](../config/amount-fixes.json)
- [config/condes-members-20261015.json](../config/condes-members-20261015.json)
- [config/corrected-entry-finance-20261015.json](../config/corrected-entry-finance-20261015.json)
- [config/d210hg-six-coverage-20261015.json](../config/d210hg-six-coverage-20261015.json)
- [config/d300-d350-receipts-20261015.json](../config/d300-d350-receipts-20261015.json)
- [config/d350-nine-receipts-20261015.json](../config/d350-nine-receipts-20261015.json)
- [config/d350-receipt-correction-20261015.json](../config/d350-receipt-correction-20261015.json)
- [config/d350-receipt-correction-20261015b.json](../config/d350-receipt-correction-20261015b.json)
- [config/d350-two-receipts-20261015.json](../config/d350-two-receipts-20261015.json)
- [config/d460-seven-receipts-20261016.json](../config/d460-seven-receipts-20261016.json)
- [config/dpb350-receipt-correction-20261015.json](../config/dpb350-receipt-correction-20261015.json)
- [config/duplicate-fixes.json](../config/duplicate-fixes.json)
- [config/eight-same-pay-consolidations-20261016.json](../config/eight-same-pay-consolidations-20261016.json)
- [config/eight-same-pay-finance-verification-20261016.json](../config/eight-same-pay-finance-verification-20261016.json)
- [config/employee-merges.json](../config/employee-merges.json)
- [config/five-receipt-program-moves-20261016.json](../config/five-receipt-program-moves-20261016.json)
- [config/four-d210-split-fixes-20261019.json](../config/four-d210-split-fixes-20261019.json)
- [config/four-source-span-fixes-20261019.json](../config/four-source-span-fixes-20261019.json)
- [config/fully-paid-programs.json](../config/fully-paid-programs.json)
- [config/legacy-migration-map.json](../config/legacy-migration-map.json)
- [config/legacy-programs.json](../config/legacy-programs.json)
- [config/legacy-receipt-fixes.json](../config/legacy-receipt-fixes.json)
- [config/legacy-site-map.json](../config/legacy-site-map.json)
- [config/member-merges-20261023.json](../config/member-merges-20261023.json)
- [config/member-merges.json](../config/member-merges.json)
- [config/member-splits.json](../config/member-splits.json)
- [config/name-merges.json](../config/name-merges.json)
- [config/old-site-report-clerks.json](../config/old-site-report-clerks.json)
- [config/or11420b-july-august-20261016.json](../config/or11420b-july-august-20261016.json)
- [config/or13743c-dpb350-20261016.json](../config/or13743c-dpb350-20261016.json)
- [config/or5151b-d190-20261016.json](../config/or5151b-d190-20261016.json)
- [config/or8574m-dpb420-20261016.json](../config/or8574m-dpb420-20261016.json)
- [config/ph02795415-bracketing-20261021.json](../config/ph02795415-bracketing-20261021.json)
- [config/ph04464351-january-nop31-20261016.json](../config/ph04464351-january-nop31-20261016.json)
- [config/ph07624278-two-programs-20261019.json](../config/ph07624278-two-programs-20261019.json)
- [config/ph08354649-two-programs-20261019.json](../config/ph08354649-two-programs-20261019.json)
- [config/ph08543913-receipt-sequence-20261017.json](../config/ph08543913-receipt-sequence-20261017.json)
- [config/ph10533517-two-month-receipt-20261019.json](../config/ph10533517-two-month-receipt-20261019.json)
- [config/ph13726515-d46059b-20261016.json](../config/ph13726515-d46059b-20261016.json)
- [config/ph17113133-january-nop22-20261016.json](../config/ph17113133-january-nop22-20261016.json)
- [config/ph17990283-all-d210hg-20261019.json](../config/ph17990283-all-d210hg-20261019.json)
- [config/ph21465590-all-d280-20261019.json](../config/ph21465590-all-d280-20261019.json)
- [config/ph23767391-d280-20261017.json](../config/ph23767391-d280-20261017.json)
- [config/ph24403007-three-month-receipt-20261019.json](../config/ph24403007-three-month-receipt-20261019.json)
- [config/ph24556150-dfpp650-merge-20261015.json](../config/ph24556150-dfpp650-merge-20261015.json)
- [config/ph25389794-dpb420-20261017.json](../config/ph25389794-dpb420-20261017.json)
- [config/ph29085041-month-of-20261019.json](../config/ph29085041-month-of-20261019.json)
- [config/ph29162192-all-d210hg-20261019.json](../config/ph29162192-all-d210hg-20261019.json)
- [config/ph33970911-two-month-start-20261019.json](../config/ph33970911-two-month-start-20261019.json)
- [config/ph34342562-source-coverage-20261019.json](../config/ph34342562-source-coverage-20261019.json)
- [config/ph34460062-two-programs-20261019.json](../config/ph34460062-two-programs-20261019.json)
- [config/ph39400344-d230-20261017.json](../config/ph39400344-d230-20261017.json)
- [config/ph47317014-february-nop22-20261016.json](../config/ph47317014-february-nop22-20261016.json)
- [config/ph57226493-coverage-20261020.json](../config/ph57226493-coverage-20261020.json)
- [config/ph58645726-january-coverage-20261016.json](../config/ph58645726-january-coverage-20261016.json)
- [config/ph61149554-d280-coverage-20261016.json](../config/ph61149554-d280-coverage-20261016.json)
- [config/ph68531118-all-d210hg-20261016.json](../config/ph68531118-all-d210hg-20261016.json)
- [config/ph71670920-ph11741830-merge-20261019.json](../config/ph71670920-ph11741830-merge-20261019.json)
- [config/ph72833261-january-nop21-20261016.json](../config/ph72833261-january-nop21-20261016.json)
- [config/ph76371335-status-20261017.json](../config/ph76371335-status-20261017.json)
- [config/ph80673488-d250fg-20261017.json](../config/ph80673488-d250fg-20261017.json)
- [config/ph84237783-nop3-20261019.json](../config/ph84237783-nop3-20261019.json)
- [config/ph86155816-d270-20261017.json](../config/ph86155816-d270-20261017.json)
- [config/ph87758804-d46059b-20261017.json](../config/ph87758804-d46059b-20261017.json)
- [config/ph88243657-d320-coverage-20261019.json](../config/ph88243657-d320-coverage-20261019.json)
- [config/ph89863784-quinones-sr-split-20261019.json](../config/ph89863784-quinones-sr-split-20261019.json)
- [config/ph93383039-ph79193890-merge-20261017.json](../config/ph93383039-ph79193890-merge-20261017.json)
- [config/ph95756414-source-coverage-20261019.json](../config/ph95756414-source-coverage-20261019.json)
- [config/ph96391262-d230-20261017.json](../config/ph96391262-d230-20261017.json)
- [config/ph99032555-january-nop27-20261016.json](../config/ph99032555-january-nop27-20261016.json)
- [config/program-moves.json](../config/program-moves.json)
- [config/receipt-consolidations.json](../config/receipt-consolidations.json)
- [config/seven-same-pay-consolidations-20261016.json](../config/seven-same-pay-consolidations-20261016.json)
- [config/sheet-database-schema.json](../config/sheet-database-schema.json)
- [config/web1327-crispin-receipt-correction-20261030.json](../config/web1327-crispin-receipt-correction-20261030.json)
- [config/web24037-ds320-amount-correction-20261016.json](../config/web24037-ds320-amount-correction-20261016.json)
- [public/robots.txt](../public/robots.txt)
