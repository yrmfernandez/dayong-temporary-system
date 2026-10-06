# Dayong System code reference

Generated from the repository source on 2026-10-04. Start with the [system guide](system-guide.md) for explanations and worked examples. This index covers source files, exported functions/types/constants, local dependencies, API methods, and maintenance scripts. It does not inspect credentials, dependencies in node_modules, binary assets, or the live workbook. Export names and import connections are extracted with the TypeScript parser; they are navigation aids, not a proof that every path is used at runtime.

Regenerate from the repository root with `node scripts/generate-code-reference.mjs` after changes. Update the review date in this script when performing a new review.

## Coverage

38 page routes, 53 API handlers, 98 library files, 36 component files; 295 scanned source/configuration/public-text files in total.

## Page routes

| Page | Source | Local dependencies |
| --- | --- | --- |
| `/admin-reports` | [app/admin-reports/page.tsx](../app/admin-reports/page.tsx) | `@/components/report-tabs` |
| `/attendance-reviews` | [app/attendance-reviews/page.tsx](../app/attendance-reviews/page.tsx) | `@/components/attendance-calendar`, `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label` |
| `/attendance-tracking` | [app/attendance-tracking/page.tsx](../app/attendance-tracking/page.tsx) | `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select` |
| `/attendance` | [app/attendance/page.tsx](../app/attendance/page.tsx) | `@/components/attendance-calendar`, `@/components/ui/badge`, `@/components/ui/button` |
| `/audit` | [app/audit/page.tsx](../app/audit/page.tsx) | `@/components/inline-panel`, `@/components/clerk-report`, `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/search-select`, `@/lib/account-rules` |
| `/branches` | [app/branches/page.tsx](../app/branches/page.tsx) | `@/components/ui/badge`, `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/select` |
| `/cash-transactions` | [app/cash-transactions/page.tsx](../app/cash-transactions/page.tsx) | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select` |
| `/collections` | [app/collections/page.tsx](../app/collections/page.tsx) | `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/use-form-draft`, `@/lib/remittance-deadline`, `@/lib/use-entry-closed`, `@/lib/entry-controls`, `@/lib/date-checks`, `@/components/receipt-photo`, `@/components/remittance-summary`, `@/components/ui/select`, `@/lib/types`, `@/lib/remittance` |
| `/commissions` | [app/commissions/page.tsx](../app/commissions/page.tsx) | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select` |
| `/employees` | [app/employees/page.tsx](../app/employees/page.tsx) | `@/lib/api-response`, `@/components/ui/button`, `@/components/ui/search-select`, `@/components/inline-panel`, `@/components/status-badge`, `@/components/one-time-password`, `@/components/nte-panel` |
| `/exceptions` | [app/exceptions/page.tsx](../app/exceptions/page.tsx) | `@/components/entry-correction-form`, `@/components/ui/button`, `@/components/ui/card`, `@/lib/api-response`, `@/lib/exceptions` |
| `/expenses` | [app/expenses/page.tsx](../app/expenses/page.tsx) | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/expense-options` |
| `/fidelity/me` | [app/fidelity/me/page.tsx](../app/fidelity/me/page.tsx) |  |
| `/fidelity` | [app/fidelity/page.tsx](../app/fidelity/page.tsx) | `@/lib/auth-server` |
| `/history` | [app/history/page.tsx](../app/history/page.tsx) | `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/input` |
| `/leave-approvals` | [app/leave-approvals/page.tsx](../app/leave-approvals/page.tsx) | `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card` |
| `/leave-requests` | [app/leave-requests/page.tsx](../app/leave-requests/page.tsx) | `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/select`, `@/components/ui/textarea` |
| `/login` | [app/login/page.tsx](../app/login/page.tsx) | `@/components/brand-logo`, `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label` |
| `/mam` | [app/mam/page.tsx](../app/mam/page.tsx) | `@/lib/mam-report`, `@/lib/account-rules`, `@/components/ui/button`, `@/components/ui/badge`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/search-select` |
| `/master-data` | [app/master-data/page.tsx](../app/master-data/page.tsx) |  |
| `/members` | [app/members/page.tsx](../app/members/page.tsx) | `@/components/inline-panel`, `@/components/ui/search-select`, `@/components/ui/input`, `@/lib/api-response`, `@/components/ui/button`, `@/components/status-badge`, `@/components/member-mam`, `@/lib/member-directory` |
| `/my-entries` | [app/my-entries/page.tsx](../app/my-entries/page.tsx) | `@/components/entry-details`, `@/components/metric-tile`, `@/components/receipt-photo`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/api-response`, `@/lib/todays-entries` |
| `/new-sales` | [app/new-sales/page.tsx](../app/new-sales/page.tsx) | `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/account-rules`, `@/lib/account-data`, `@/lib/program-amount-lock`, `@/lib/entry-controls`, `@/lib/date-checks`, `@/lib/remittance-deadline`, `@/lib/use-entry-closed`, `@/lib/use-form-draft`, `@/components/remittance-summary`, `@/lib/remittance`, `@/components/ui/select`, `@/components/ui/separator`, `@/components/ui/textarea`, `@/lib/types` |
| `/` | [app/page.tsx](../app/page.tsx) | `@/components/executive-dashboard`, `@/components/finance-dashboard`, `@/components/metric-tile`, `@/components/status-badge`, `@/components/system-health-dashboard`, `@/components/ui/card`, `@/lib/account-rules`, `@/lib/auth`, `@/lib/auth-server`, `@/lib/dashboard-data`, `@/lib/employees`, `@/lib/executive-analytics`, `@/lib/finance-operations`, `@/lib/remittance-workflow`, `@/lib/system-health`, `@/lib/ui-preferences` |
| `/payroll` | [app/payroll/page.tsx](../app/payroll/page.tsx) | `@/components/inline-panel`, `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/payroll-calc`, `@/lib/payslip` |
| `/programs` | [app/programs/page.tsx](../app/programs/page.tsx) | `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/select`, `@/components/ui/textarea`, `@/lib/program-age` |
| `/remittances` | [app/remittances/page.tsx](../app/remittances/page.tsx) | `@/components/metric-tile`, `@/components/receipt-photo`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/lib/api-response` |
| `/reports/daily` | [app/reports/daily/page.tsx](../app/reports/daily/page.tsx) |  |
| `/reports/monthly` | [app/reports/monthly/page.tsx](../app/reports/monthly/page.tsx) |  |
| `/reports` | [app/reports/page.tsx](../app/reports/page.tsx) | `@/components/report-tabs` |
| `/reports/weekly` | [app/reports/weekly/page.tsx](../app/reports/weekly/page.tsx) |  |
| `/reports/yearly` | [app/reports/yearly/page.tsx](../app/reports/yearly/page.tsx) |  |
| `/roles` | [app/roles/page.tsx](../app/roles/page.tsx) | `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/lib/access-control`, `@/lib/page-catalog` |
| `/settings` | [app/settings/page.tsx](../app/settings/page.tsx) | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/finance-settings`, `@/components/profile`, `@/components/theme-toggle`, `@/components/remittance-method-settings`, `@/lib/ui-preferences`, `@/lib/use-form-draft` |
| `/soa` | [app/soa/page.tsx](../app/soa/page.tsx) | `@/components/brand-logo`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/search-select`, `@/lib/statement-of-account` |
| `/todays-entries` | [app/todays-entries/page.tsx](../app/todays-entries/page.tsx) | `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/api-response`, `@/lib/remittance-deadline`, `@/lib/today-mode`, `@/lib/todays-entries`, `@/components/entry-correction-form`, `@/components/entry-details`, `@/components/receipt-photo` |
| `/user-accounts` | [app/user-accounts/page.tsx](../app/user-accounts/page.tsx) | `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select`, `@/components/one-time-password` |
| `/vendor-payables` | [app/vendor-payables/page.tsx](../app/vendor-payables/page.tsx) | `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select` |

## API routes

All routes pass through the authentication proxy except the three public auth endpoints. Methods below are implemented exports; permission and validation details remain in each linked handler.

| API | Methods | Source |
| --- | --- | --- |
| `/api/attendance-calendar` | GET, POST | [app/api/attendance-calendar/route.ts](../app/api/attendance-calendar/route.ts) |
| `/api/attendance-reviews` | GET, POST | [app/api/attendance-reviews/route.ts](../app/api/attendance-reviews/route.ts) |
| `/api/attendance-tracking/daily` | GET, PATCH | [app/api/attendance-tracking/daily/route.ts](../app/api/attendance-tracking/daily/route.ts) |
| `/api/attendance-tracking` | GET | [app/api/attendance-tracking/route.ts](../app/api/attendance-tracking/route.ts) |
| `/api/attendance` | GET, POST | [app/api/attendance/route.ts](../app/api/attendance/route.ts) |
| `/api/audit` | GET, POST, PATCH | [app/api/audit/route.ts](../app/api/audit/route.ts) |
| `/api/audit/summary` | GET | [app/api/audit/summary/route.ts](../app/api/audit/summary/route.ts) |
| `/api/auth/login` | POST | [app/api/auth/login/route.ts](../app/api/auth/login/route.ts) |
| `/api/auth/logout` | POST | [app/api/auth/logout/route.ts](../app/api/auth/logout/route.ts) |
| `/api/auth/session` | GET | [app/api/auth/session/route.ts](../app/api/auth/session/route.ts) |
| `/api/branches` | GET, POST, PUT, DELETE | [app/api/branches/route.ts](../app/api/branches/route.ts) |
| `/api/cash-transactions` | GET, POST, PATCH | [app/api/cash-transactions/route.ts](../app/api/cash-transactions/route.ts) |
| `/api/clerk-report` | GET, POST | [app/api/clerk-report/route.ts](../app/api/clerk-report/route.ts) |
| `/api/collections` | GET, POST | [app/api/collections/route.ts](../app/api/collections/route.ts) |
| `/api/commissions` | GET, POST, PATCH | [app/api/commissions/route.ts](../app/api/commissions/route.ts) |
| `/api/company-targets` | POST | [app/api/company-targets/route.ts](../app/api/company-targets/route.ts) |
| `/api/employees` | GET, POST, PATCH, DELETE | [app/api/employees/route.ts](../app/api/employees/route.ts) |
| `/api/exceptions` | GET, PATCH | [app/api/exceptions/route.ts](../app/api/exceptions/route.ts) |
| `/api/expenses` | GET, POST, PATCH | [app/api/expenses/route.ts](../app/api/expenses/route.ts) |
| `/api/fidelity` | GET, PATCH | [app/api/fidelity/route.ts](../app/api/fidelity/route.ts) |
| `/api/finance-options` | GET, POST | [app/api/finance-options/route.ts](../app/api/finance-options/route.ts) |
| `/api/google-sheets/test` | GET | [app/api/google-sheets/test/route.ts](../app/api/google-sheets/test/route.ts) |
| `/api/history` | GET, PATCH | [app/api/history/route.ts](../app/api/history/route.ts) |
| `/api/leave-approvals` | GET, POST | [app/api/leave-approvals/route.ts](../app/api/leave-approvals/route.ts) |
| `/api/leave-requests` | GET, POST | [app/api/leave-requests/route.ts](../app/api/leave-requests/route.ts) |
| `/api/mam/member` | GET | [app/api/mam/member/route.ts](../app/api/mam/member/route.ts) |
| `/api/mam` | GET, POST | [app/api/mam/route.ts](../app/api/mam/route.ts) |
| `/api/mas` | GET | [app/api/mas/route.ts](../app/api/mas/route.ts) |
| `/api/member-programs/check` | GET | [app/api/member-programs/check/route.ts](../app/api/member-programs/check/route.ts) |
| `/api/members/directory` | GET, PATCH, DELETE | [app/api/members/directory/route.ts](../app/api/members/directory/route.ts) |
| `/api/members` | GET | [app/api/members/route.ts](../app/api/members/route.ts) |
| `/api/members/standing` | GET | [app/api/members/standing/route.ts](../app/api/members/standing/route.ts) |
| `/api/members/transfer` | GET, POST | [app/api/members/transfer/route.ts](../app/api/members/transfer/route.ts) |
| `/api/my-entries` | GET, POST | [app/api/my-entries/route.ts](../app/api/my-entries/route.ts) |
| `/api/nte` | GET, POST, PATCH | [app/api/nte/route.ts](../app/api/nte/route.ts) |
| `/api/payroll` | GET, POST | [app/api/payroll/route.ts](../app/api/payroll/route.ts) |
| `/api/profile` | GET | [app/api/profile/route.ts](../app/api/profile/route.ts) |
| `/api/program-categories` | GET, POST, PUT, DELETE | [app/api/program-categories/route.ts](../app/api/program-categories/route.ts) |
| `/api/program-incentives` | GET, POST | [app/api/program-incentives/route.ts](../app/api/program-incentives/route.ts) |
| `/api/programs` | GET, POST, PUT, DELETE | [app/api/programs/route.ts](../app/api/programs/route.ts) |
| `/api/receipt-photos` | GET, POST | [app/api/receipt-photos/route.ts](../app/api/receipt-photos/route.ts) |
| `/api/remittance-methods` | GET, POST | [app/api/remittance-methods/route.ts](../app/api/remittance-methods/route.ts) |
| `/api/remittances` | GET, POST, PATCH | [app/api/remittances/route.ts](../app/api/remittances/route.ts) |
| `/api/reports` | GET, POST | [app/api/reports/route.ts](../app/api/reports/route.ts) |
| `/api/roles` | GET, POST, PATCH, DELETE | [app/api/roles/route.ts](../app/api/roles/route.ts) |
| `/api/sales` | POST | [app/api/sales/route.ts](../app/api/sales/route.ts) |
| `/api/sales/validate` | POST | [app/api/sales/validate/route.ts](../app/api/sales/validate/route.ts) |
| `/api/settings` | PATCH | [app/api/settings/route.ts](../app/api/settings/route.ts) |
| `/api/soa` | GET, PATCH | [app/api/soa/route.ts](../app/api/soa/route.ts) |
| `/api/todays-entries` | GET, POST, PATCH | [app/api/todays-entries/route.ts](../app/api/todays-entries/route.ts) |
| `/api/user-accounts/password` | POST | [app/api/user-accounts/password/route.ts](../app/api/user-accounts/password/route.ts) |
| `/api/user-accounts` | GET, POST, PATCH, DELETE | [app/api/user-accounts/route.ts](../app/api/user-accounts/route.ts) |
| `/api/vendor-payables` | GET, POST, PATCH | [app/api/vendor-payables/route.ts](../app/api/vendor-payables/route.ts) |

## Libraries and business rules

| File | Exported symbols | Local imports / re-exports |
| --- | --- | --- |
| [lib/access-control.ts](../lib/access-control.ts) | `AccessContext`, `executiveRoles`, `normalizeRoleName`, `isAdministratorRole`, `itRoles`, `hrRoles`, `canManageAccountsFor`, `canManageEmployeesFor`, `canManageConfigurationFor`, `defaultRoutesForRole`, `routesForRole`, `accessibleRoutes`, `canAccessPath`, `DashboardKind`, `dashboardKind` | — |
| [lib/account-data.ts](../lib/account-data.ts) | `AccountScope`, `LoadedAccount`, `AccountData`, `loadAccountData`, `accountReport`, `ProgramStanding`, `memberStanding`, `mamReport`, `memberMam`, `syncAccountStatuses`, `NewCollection`, `commitCollections` | `@/lib/account-rules`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/remittance`, `@/lib/mam-report` |
| [lib/account-rules.ts](../lib/account-rules.ts) | `AccountStatus`, `Account`, `AccountPayment`, `todayInManila`, `validDate`, `validMonth`, `monthIndex`, `monthName`, `monthCount`, `dateInMonth`, `addMonths`, `addDay`, `allocations`, `paymentsByEnrollment`, `accountState`, `COLLECTION_CHANNELS`, `CollectionChannel`, `incentiveRoleFor`, `PaymentInput`, `validatePayment` | — |
| [lib/api-response.ts](../lib/api-response.ts) | `readApiResponse`, `parseJsonResponse` | — |
| [lib/attendance-board.ts](../lib/attendance-board.ts) | `BoardCategory`, `canViewAttendanceTracking`, `canAdjustLateness`, `boardCategory`, `minutesBetween` | `@/lib/auth`, `@/lib/attendance-data` |
| [lib/attendance-calendar.ts](../lib/attendance-calendar.ts) | `ALL_BRANCHES`, `Holiday`, `Closure`, `validDate`, `getHolidays`, `saveHoliday`, `deleteHoliday`, `addPhilippineHolidays`, `getClosures`, `closureCovers`, `closureLabel`, `closureForBranch`, `employeeAttendanceBranches`, `declareClosure`, `removeClosure` | `@/lib/attendance-data`, `@/lib/encoder-sheets`, `@/lib/encoder-schema`, `@/lib/encoder-context`, `@/lib/employees`, `@/lib/google-sheets`, `@/lib/google-sheets-data`, `@/lib/philippine-holidays`, `@/lib/readable-id`, `@/lib/sheet-rows` |
| [lib/attendance-data.ts](../lib/attendance-data.ts) | `AttendanceRecord`, `sheetDateText`, `sheetTimeText`, `getAttendanceForEmployeeDate`, `addAttendanceRecord`, `addAttendanceRecords`, `getAllAttendanceForRange`, `updateAttendanceRecord`, `getAttendanceRecordsForDate`, `getNonWorkingDayRecords`, `cancelClockInsForNonWorkingDay`, `getAttendanceRecordsForRange`, `recordApprovedLeaveAttendance` | `@/lib/encoder-sheets`, `@/lib/google-sheets`, `@/lib/attendance` |
| [lib/attendance.ts](../lib/attendance.ts) | `ATTENDANCE_TIME_ZONE`, `SCHEDULED_TIME_IN`, `SCHEDULED_TIME_OUT`, `WORKING_DAYS`, `AttendanceStatus`, `getPhilippineDate`, `getPhilippineTime`, `isWorkingDay` | — |
| [lib/audit-log.ts](../lib/audit-log.ts) | `AUDIT_SHEET`, `AUDIT_HEADERS`, `AuditActor`, `AuditAction`, `AuditChanges`, `parseRange`, `planValuesUpdate`, `planValuesBatchUpdate`, `planBatchUpdate`, `diffRow`, `auditedWrite`, `resetAuditSheetCache` | — |
| [lib/auth-server.ts](../lib/auth-server.ts) | `getSessionUser`, `userWithPageAccess`, `canManageAccounts`, `canManageEmployees`, `canManageConfiguration`, `canManageUsers`, `canManageAttendance` | `@/lib/access-control`, `@/lib/auth` |
| [lib/auth.ts](../lib/auth.ts) | `SessionUser`, `SESSION_COOKIE`, `SESSION_SECONDS`, `sessionCookieOptions`, `sessionMaxAge`, `serializeSessionCookie`, `createSessionToken`, `verifySessionToken` | `@/lib/server-environment` |
| [lib/auto-absence.ts](../lib/auto-absence.ts) | `SYSTEM_ABSENCE_NOTE`, `isSystemAbsence`, `systemAbsences`, `closeFinishedAttendanceDays`, `closeFinishedAttendanceDaysQuietly` | `@/lib/attendance-calendar`, `@/lib/attendance-data`, `@/lib/attendance`, `@/lib/encoder-context`, `@/lib/google-sheets`, `@/lib/google-sheets-data`, `@/lib/system-settings` |
| [lib/calculations.ts](../lib/calculations.ts) | `CollectionStatus`, `calculateTMD`, `calculateBalance`, `getNextNOP`, `getProgramBasePay`, `calculateCollectionTMD` | `./types` |
| [lib/cash-count.ts](../lib/cash-count.ts) | `DENOMINATIONS`, `CashCount`, `cashCountTotal`, `formatCashCount`, `parseCashCount`, `cashCountProblem` | — |
| [lib/clerk-cash.ts](../lib/clerk-cash.ts) | `BankDeposit`, `getDeposits`, `addDeposit`, `voidDeposit`, `ReportNotes`, `getReportNotes`, `saveReportNotes` | `@/lib/encoder-context`, `@/lib/google-sheets`, `@/lib/readable-id` |
| [lib/clerk-report.ts](../lib/clerk-report.ts) | `COMPANY`, `weekOfMonth`, `ReportLine`, `ExpenseRow`, `buildClerkReport`, `ClerkReport` | `@/lib/clerk-cash`, `@/lib/daily-audit`, `@/lib/google-sheets`, `@/lib/todays-entries` |
| [lib/company-targets.ts](../lib/company-targets.ts) | `CompanyTarget`, `periodType`, `getCompanyTargets`, `saveCompanyTarget` | `@/lib/encoder-sheets`, `@/lib/encoder-schema`, `@/lib/encoder-context`, `@/lib/google-sheets` |
| [lib/daily-audit.ts](../lib/daily-audit.ts) | `AUDIT_PERIODS`, `AuditPeriod`, `asAuditPeriod`, `AUDIT_RESULTS`, `AuditStatus`, `periodSpan`, `AuditFigures`, `DailyAudit`, `auditedEmployees`, `getDailyAudits`, `saveDailyAudit`, `decideDailyAudit`, `AuditSummaryFilters`, `getAuditSummary` | `@/lib/encoder-context`, `@/lib/encoder-sheets`, `@/lib/employees`, `@/lib/google-sheets`, `@/lib/google-sheets-data`, `@/lib/readable-id`, `@/lib/clerk-report` |
| [lib/dashboard-data.ts](../lib/dashboard-data.ts) | `dashboardKind`, `DashboardKind`, `getDashboardData`, `DashboardData` | `@/lib/auth`, `@/lib/account-rules`, `@/lib/access-control`, `@/lib/attendance-data`, `@/lib/google-sheets`, `@/lib/leave-data`, `@/lib/users-sheet`, `@/lib/reports`, `@/lib/remittance-workflow`, `@/lib/system-settings`, `@/lib/todays-entries`, `@/lib/sheet-ranges`, `@/lib/sheets-on-db` |
| [lib/date-checks.ts](../lib/date-checks.ts) | `REMIT_LATE_DAYS`, `ENCODE_LATE_DAYS`, `DateFacts`, `dateWarnings`, `blockingDateProblem` | — |
| [lib/db.ts](../lib/db.ts) | `schema`, `Database`, `Transaction`, `Queryable`, `getDb`, `currentDb`, `inTransaction`, `UNIQUE_VIOLATION`, `isUniqueViolation`, `encodedBy` | `@/db/schema`, `@/lib/encoder-context`, `@/lib/server-environment` |
| [lib/default-password.ts](../lib/default-password.ts) | `DEFAULT_PASSWORD`, `MIN_PASSWORD_LENGTH`, `isWeakPassword` | — |
| [lib/defaults.ts](../lib/defaults.ts) | `emptyAddress`, `emptyPersonName`, `emptyClaimant`, `emptyMember`, `emptyProgram`, `emptyBeneficiary`, `emptyNewSale` | `./types` |
| [lib/duplicate-entries.ts](../lib/duplicate-entries.ts) | `entryKey`, `personKey`, `recordedApplicationNumbers`, `recordedOrNumbers`, `recordedMembersByPerson`, `newSalesDoubleEntry` | `@/lib/db`, `@/lib/program-age` |
| [lib/earned-commissions.ts](../lib/earned-commissions.ts) | `getEarnedCommissions`, `EarnedCommission` | `@/lib/employees`, `@/lib/finance-operations`, `@/lib/reports` |
| [lib/employee-accounts.ts](../lib/employee-accounts.ts) | `accountRoleIdsFor`, `createDefaultAccount` | `@/lib/google-sheets-data`, `@/lib/passwords` |
| [lib/employee-id-change.ts](../lib/employee-id-change.ts) | `changeEmployeeId` | `@/lib/db`, `@/lib/employee-id`, `@/lib/google-sheets`, `@/lib/record-corrections` |
| [lib/employee-id.ts](../lib/employee-id.ts) | `EMPLOYEE_ID_PATTERN`, `EMPLOYEE_ID_INPUT_PATTERN`, `EMPLOYEE_ID_EXAMPLE`, `EMPLOYEE_ID_FORMAT_MESSAGE`, `normalizeEmployeeId`, `isEmployeeIdFormat` | — |
| [lib/employees.ts](../lib/employees.ts) | `employmentStatuses`, `EmploymentStatus`, `getEmployees`, `suggestEmployeeId`, `getNextEmployeeId`, `registerEmployee`, `updateEmployee`, `setEmployeeRoles`, `updateEmployeeStatus`, `deleteEmployee` | `@/lib/db`, `@/lib/google-sheets`, `@/lib/employee-id` |
| [lib/encoder-context.ts](../lib/encoder-context.ts) | `isEncodingRequest`, `withEncoder`, `runAsSystem`, `getEncoder`, `currentEncoder`, `encoderValues` | `@/lib/auth-server` |
| [lib/encoder-schema.ts](../lib/encoder-schema.ts) | `encoderHeaders`, `editorHeaders`, `encoderSheets`, `columnName`, `trackingHeaders`, `quotedSheet`, `getEncoderSheet` | — |
| [lib/encoder-sheets.ts](../lib/encoder-sheets.ts) | `appendEncodedRows`, `updateEncodedRow` | `@/lib/google-sheets`, `@/lib/encoder-context`, `@/lib/encoder-schema`, `@/lib/sheet-headers` |
| [lib/entry-controls.ts](../lib/entry-controls.ts) | `BACKDATE_REASON_MIN`, `needsBackdateReason`, `checkBackdate`, `controlTotalProblem` | `@/lib/remittance-deadline` |
| [lib/entry-corrections.ts](../lib/entry-corrections.ts) | `correctSaleOrCollection` | `@/lib/duplicate-entries`, `@/lib/google-sheets`, `@/lib/remittance-deadline`, `@/lib/record-corrections` |
| [lib/exceptions.ts](../lib/exceptions.ts) | `EXCEPTION_CATEGORIES`, `ExceptionCategory`, `ExceptionItem`, `findExceptions` | `@/lib/sheets-on-db`, `@/components/entry-correction-form`, `@/lib/sheet-ranges`, `@/lib/account-rules`, `@/lib/duplicate-entries`, `@/lib/google-sheets`, `@/lib/program-age`, `@/lib/program-amount-lock`, `@/lib/remittance-deadline`, `@/lib/date-checks` |
| [lib/executive-analytics.ts](../lib/executive-analytics.ts) | `executivePeriods`, `ExecutivePeriod`, `isExecutivePeriod`, `Ranked`, `TrendPoint`, `getExecutiveAnalytics`, `ExecutiveAnalytics` | `@/lib/account-rules`, `@/lib/sheet-ranges`, `@/lib/company-targets`, `@/lib/google-sheets` |
| [lib/expense-options.ts](../lib/expense-options.ts) | `EXPENSE_ACCOUNTS`, `EXPENSE_ATTACHMENTS`, `EXPENSE_APPROVERS`, `choiceWithOther`, `attachmentList` | — |
| [lib/fidelity.ts](../lib/fidelity.ts) | `FIDELITY_CAP`, `WITHDRAWAL_TYPES`, `getFidelityData`, `withdrawFidelity` | `@/lib/google-sheets`, `@/lib/employees`, `@/lib/encoder-sheets`, `@/lib/readable-id` |
| [lib/finance-access.ts](../lib/finance-access.ts) | `canUseFinance` | `@/lib/auth-server` |
| [lib/finance-data.ts](../lib/finance-data.ts) | `EXPENSE_EXTRA_HEADERS`, `ExpenseRecord`, `CashLedgerEntry`, `getFinanceData`, `createExpense`, `createCashTransaction`, `voidFinanceRecord` | `@/lib/readable-id`, `@/lib/encoder-sheets`, `@/lib/encoder-context`, `@/lib/google-sheets`, `@/lib/sheet-headers`, `@/lib/expense-options` |
| [lib/finance-operations.ts](../lib/finance-operations.ts) | `getCashAccounts`, `saveCashAccount`, `getVendorPayables`, `createVendorPayable`, `payVendorPayable`, `getCommissions`, `createCommission`, `payCommission` | `@/lib/encoder-sheets`, `@/lib/google-sheets`, `@/lib/readable-id` |
| [lib/google-sheets-data.ts](../lib/google-sheets-data.ts) | `ProgramSheetData`, `BranchSheetData`, `getBranches`, `createBranch`, `ProgramIncentiveSheetData`, `CreateProgramData`, `getProgramIncentives`, `addProgramIncentive`, `getPrograms`, `programColumns`, `createProgram`, `LoginRole`, `LoginUserData`, `AttendanceEmployee`, `getLoginUserByEmployeeId`, `AccountRole`, `CreateEmployeeAccountData`, `getActiveAccountRoles`, `createEmployeeAccount`, `getActiveAttendanceEmployees` | `@/lib/db`, `@/lib/program-amount-lock`, `@/lib/program-incentive-store`, `@/lib/employees`, `@/lib/employee-id`, `@/lib/encoder-sheets`, `@/lib/roles`, `@/lib/program-age`, `@/lib/remittance`, `@/lib/users-sheet`, `@/lib/google-sheets` |
| [lib/google-sheets.ts](../lib/google-sheets.ts) | `GOOGLE_SHEET_ID`, `sheetsStats`, `withWriteLock`, `sheetOfRange`, `readingFresh`, `sheets` | `@/lib/sheets-read-cache`, `@/lib/encoder-context`, `@/lib/sheets-on-db`, `@/lib/server-environment` |
| [lib/leave-data.ts](../lib/leave-data.ts) | `LeaveApprovalStatus`, `LeaveRequest`, `getLeaveRequestsForEmployee`, `addLeaveRequest`, `getAllLeaveRequests`, `updateLeaveRequestReview` | `@/lib/encoder-sheets`, `@/lib/google-sheets` |
| [lib/mam-report.ts](../lib/mam-report.ts) | `MamAccount`, `monitoringMonths`, `buildMamReport` | `@/lib/account-rules` |
| [lib/master-data-crud.ts](../lib/master-data-crud.ts) | `ProgramInput`, `updateProgramRecord`, `deleteProgramRecord`, `BranchInput`, `updateBranchRecord`, `deleteBranchRecord`, `getUserAccounts`, `updateUserAccount`, `resetUserPassword`, `deleteUserAccount`, `updateMemberRecord`, `deleteMemberRecord` | `@/lib/db`, `@/lib/google-sheets-data`, `@/lib/google-sheets`, `@/lib/passwords`, `@/lib/encoder-sheets`, `@/lib/sheet-rows`, `@/lib/users-sheet`, `@/lib/program-incentive-store` |
| [lib/member-directory-data.ts](../lib/member-directory-data.ts) | `loadMemberDirectory`, `DirectoryQuery`, `queryMemberDirectory` | `@/lib/db`, `@/lib/account-data`, `@/lib/member-directory`, `@/lib/member-scope`, `@/lib/employees`, `@/lib/google-sheets-data` |
| [lib/member-directory.ts](../lib/member-directory.ts) | `DirectoryEnrollment`, `DirectoryMember`, `DECEASED_STATUS`, `MEMBER_STATUSES`, `STANDING_FILTERS`, `Standing`, `matchesStanding`, `DirectoryFilters`, `emptyDirectoryFilters`, `MemberRecord`, `EnrollmentRecord`, `CollectorRecord`, `buildMemberDirectory`, `filterMemberDirectory` | — |
| [lib/member-records.ts](../lib/member-records.ts) | `MemberSheetData`, `MemberDetails`, `addMember`, `updateMemberDetails`, `addBeneficiaries`, `findMemberByNumber`, `searchMembersByName`, `listMembersForMas`, `MemberProgramSheetData`, `findMemberProgramEnrollment`, `addMemberProgram`, `SaleSheetData`, `addSale`, `listMembersInBranch` | `@/lib/readable-id`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/program-age` |
| [lib/member-scope.ts](../lib/member-scope.ts) | `ownMembersScope`, `isOwnAccount` | `@/lib/auth`, `@/lib/access-control`, `@/lib/employees` |
| [lib/member-transfer.ts](../lib/member-transfer.ts) | `canTransferMembers`, `transferCandidates`, `transferEnrollment`, `getTransferHistory` | `@/lib/auth-server`, `@/lib/db`, `@/lib/encoder-context`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/readable-id` |
| [lib/members.ts](../lib/members.ts) | `getMemberPrograms`, `getProgram`, `getMember` | `./types` |
| [lib/mock-members.ts](../lib/mock-members.ts) | `mockMembers` | `./types` |
| [lib/navigation.ts](../lib/navigation.ts) | `NavItem`, `NavSection`, `normalizeRole`, `workspaceFor`, `routeMatches`, `visibleNavigation`, `isInWorkspace`, `locatePage`, `activeHref` | `@/lib/access-control` |
| [lib/nte.ts](../lib/nte.ts) | `NTE_DAYS`, `SUSPENSION_THRESHOLD`, `Nte`, `listNtes`, `issueNte`, `withdrawNte` | `@/lib/db`, `@/lib/employees`, `@/lib/readable-id`, `@/lib/remittance-deadline` |
| [lib/page-catalog.ts](../lib/page-catalog.ts) | `pageCatalog`, `pageCatalogRoutes` | — |
| [lib/passwords.ts](../lib/passwords.ts) | `ONE_TIME_PASSWORD_HOURS`, `generateOneTimePassword`, `hashPassword`, `hashOneTimePassword`, `oneTimePasswordExpiry`, `checkPassword` | — |
| [lib/payroll-calc.ts](../lib/payroll-calc.ts) | `WORKING_DAYS_PER_YEAR`, `BaseType`, `PayProfile`, `PayrollSettings`, `defaultPayrollSettings`, `AttendanceDay`, `CommissionItem`, `PayrollLine`, `Adjustment`, `COMPANY_PROGRAM_CATEGORY`, `ADJUSTMENT_CATEGORIES`, `dailyRateOf`, `scheduledWorkingDays`, `computePayrollLine`, `lineTotals`, `runTotals` | — |
| [lib/payroll.ts](../lib/payroll.ts) | `getPayProfiles`, `savePayProfile`, `PayrollRun`, `getPayrollOverview`, `getPayrollRun`, `createPayrollRun`, `recalculatePayrollRun`, `addPayrollAdjustment`, `removePayrollAdjustment`, `approvePayrollRun`, `payPayrollRun`, `voidPayrollRun`, `deletePayrollRun` | `@/lib/attendance-data`, `@/lib/sheet-ranges`, `@/lib/auto-absence`, `@/lib/encoder-context`, `@/lib/encoder-sheets`, `@/lib/employees`, `@/lib/finance-data`, `@/lib/finance-operations`, `@/lib/google-sheets`, `@/lib/google-sheets-data`, `@/lib/payroll-calc`, `@/lib/readable-id`, `@/lib/sheet-rows` |
| [lib/payslip.ts](../lib/payslip.ts) | `PAYSLIP_COMPANY`, `PayslipRow`, `Payslip`, `buildPayslip`, `payslipFileName`, `payslipPdf` | `@/lib/payroll-calc` |
| [lib/philippine-holidays.ts](../lib/philippine-holidays.ts) | `HOLIDAY_TYPES`, `HolidayType`, `HolidayTemplate`, `philippineHolidays` | — |
| [lib/photo-storage.ts](../lib/photo-storage.ts) | `PHOTO_BUCKET`, `storePhoto`, `readPhoto` | — |
| [lib/privilege-guard.ts](../lib/privilege-guard.ts) | `guardAccountChange`, `guardRoleChange` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/master-data-crud`, `@/lib/roles` |
| [lib/program-age.ts](../lib/program-age.ts) | `AgeRestriction`, `readAgeRestriction`, `normalizeAgeRestriction`, `ageRestrictionCells`, `describeAgeRestriction`, `ageOn`, `isoDate`, `ageRestrictionError` | — |
| [lib/program-amount-lock.ts](../lib/program-amount-lock.ts) | `isTrue`, `amountEditableCells`, `fixedNewSaleAmount` | — |
| [lib/program-categories.ts](../lib/program-categories.ts) | `ProgramCategory`, `getProgramCategories`, `createProgramCategory`, `updateProgramCategory`, `deleteProgramCategory` | `@/lib/db`, `@/lib/readable-id` |
| [lib/program-incentive-store.ts](../lib/program-incentive-store.ts) | `StoredTier`, `validateIncentiveTiers`, `writeProgramIncentives` | `@/lib/db`, `@/lib/readable-id` |
| [lib/programs.ts](../lib/programs.ts) | `Program`, `getActivePrograms`, `getAllPrograms` | `./google-sheets-data` |
| [lib/rate-limit.ts](../lib/rate-limit.ts) | `retryAfter`, `recordAttempt`, `clearAttempts`, `clientIp` | — |
| [lib/readable-id.ts](../lib/readable-id.ts) | `createReadableId` | — |
| [lib/receipt-photos.ts](../lib/receipt-photos.ts) | `MAX_PHOTO_BYTES`, `ReceiptPhotoInfo`, `listReceiptPhotos`, `photosByEntry`, `getReceiptPhoto`, `saveReceiptPhoto` | `@/lib/db`, `@/lib/encoder-context`, `@/lib/photo-storage`, `@/lib/readable-id` |
| [lib/record-corrections.ts](../lib/record-corrections.ts) | `ensureCorrectionsSheet`, `recordCorrection` | `@/lib/encoder-sheets`, `@/lib/google-sheets`, `@/lib/readable-id` |
| [lib/remittance-deadline.ts](../lib/remittance-deadline.ts) | `REMITTANCE_CUTOFF`, `ENTRY_CLOSED_MESSAGE`, `validTime`, `incentiveDeadline`, `keepsIncentive`, `manilaNow`, `manilaDateOf`, `entryClosed`, `formatDeadline` | — |
| [lib/remittance-methods.ts](../lib/remittance-methods.ts) | `PaymentMethod`, `getPaymentMethods`, `findActivePaymentMethod`, `savePaymentMethod` | `@/lib/db`, `@/lib/readable-id` |
| [lib/remittance-workflow.ts](../lib/remittance-workflow.ts) | `RemittanceKind`, `CashCollection`, `CashRemittance`, `forfeitsIncentive`, `amountDue`, `getRemittanceDashboard`, `CASH_IN_FULL_NOTE`, `createCashRemittance`, `decideCashRemittance`, `submitReadyEntries`, `resubmitReturned` | `@/lib/sheets-on-db`, `@/lib/readable-id`, `@/lib/sheet-ranges`, `@/lib/encoder-context`, `@/lib/google-sheets`, `@/lib/sheet-headers`, `@/lib/remittance-deadline`, `@/lib/cash-count`, `@/lib/receipt-photos` |
| [lib/remittance.ts](../lib/remittance.ts) | `IncentiveTier`, `tiersForBranch`, `SaleIncentiveSetting`, `SaleProgram`, `normalizeSaleIncentive`, `calculateSaleIncentive`, `calculateRemittance` | — |
| [lib/report-remarks.ts](../lib/report-remarks.ts) | `getReportRemarks`, `addReportRemark` | `@/lib/encoder-sheets`, `@/lib/google-sheets`, `@/lib/readable-id` |
| [lib/reports.ts](../lib/reports.ts) | `ReportLine`, `ReportSummary`, `buildOperationalReport` | `@/lib/sheets-on-db`, `@/lib/google-sheets`, `@/lib/sheet-ranges` |
| [lib/roles.ts](../lib/roles.ts) | `RoleRecord`, `parsePageAccess`, `getRoles`, `createRole`, `updateRole`, `deleteRole` | `@/lib/google-sheets`, `@/lib/encoder-context`, `@/lib/sheet-rows`, `@/lib/access-control`, `@/lib/page-catalog` |
| [lib/server-environment.ts](../lib/server-environment.ts) | `RequiredServerVariable`, `readServerVariable`, `getMissingServerVariables`, `ServerConfigurationError`, `assertServerConfiguration`, `getAuthSecret`, `getGooglePrivateKey`, `getGoogleSheetId` | — |
| [lib/session-account.ts](../lib/session-account.ts) | `SESSION_RECHECK_MS`, `passwordStamp`, `sessionFor`, `recheckSession` | `@/lib/auth`, `@/lib/google-sheets-data` |
| [lib/sheet-headers.ts](../lib/sheet-headers.ts) | `canonicalHeader`, `headerMatches` | — |
| [lib/sheet-ranges.ts](../lib/sheet-ranges.ts) | `COLLECTIONS_RANGE`, `SALES_RANGE`, `REMITTANCES_RANGE`, `REMITTANCE_LINKS_RANGE`, `PROGRAMS_RANGE`, `MEMBERS_RANGE` | — |
| [lib/sheet-rows.ts](../lib/sheet-rows.ts) | `deleteRowsWhere`, `deleteRowsById` | `@/lib/google-sheets` |
| [lib/sheets-on-db.ts](../lib/sheets-on-db.ts) | `SHEET_TITLES`, `tableOf`, `isDatabaseSheet`, `countSheetRows`, `columnLetters`, `parseA1`, `sheetsOnDb`, `readSheetRows`, `readSheetRowsNumbered`, `appendSheetRows` | `@/lib/db` |
| [lib/sheets-read-cache.ts](../lib/sheets-read-cache.ts) | `SheetsReadCache`, `KeyedLock` | — |
| [lib/statement-of-account.ts](../lib/statement-of-account.ts) | `listStatementAccounts`, `getStatementOfAccount`, `StatementOfAccount` | `@/lib/account-rules`, `@/lib/account-data`, `@/lib/db` |
| [lib/system-health.ts](../lib/system-health.ts) | `IntegrityIssue`, `getSystemHealth`, `SystemHealth` | `@/lib/audit-log`, `@/lib/google-sheets`, `@/lib/users-sheet`, `@/lib/server-environment` |
| [lib/system-settings.ts](../lib/system-settings.ts) | `isTodayMode`, `TODAY_MODE_LABELS`, `TODAY_MODES`, `TodayMode`, `getSetting`, `saveSetting`, `getTodayMode`, `setTodayMode` | `@/lib/google-sheets`, `@/lib/today-mode` |
| [lib/theme.ts](../lib/theme.ts) | `ThemePreference`, `THEME_KEY`, `themeBootScript`, `readTheme`, `resolveTheme`, `applyTheme`, `setTheme`, `watchTheme` | — |
| [lib/today-mode.ts](../lib/today-mode.ts) | `TODAY_MODES`, `TodayMode`, `TODAY_MODE_LABELS`, `isTodayMode` | — |
| [lib/todays-entries.ts](../lib/todays-entries.ts) | `DayEntry`, `getEntriesForDay`, `getEntriesForRange` | `@/lib/google-sheets`, `@/lib/sheet-ranges`, `@/lib/sheets-on-db`, `@/lib/remittance-deadline`, `@/lib/date-checks`, `@/lib/receipt-photos`, `@/lib/today-mode` |
| [lib/types.ts](../lib/types.ts) | `Address`, `PersonName`, `Claimant`, `Beneficiary`, `Member`, `Program`, `ProgramEnrollment`, `NewSale`, `Collection` | — |
| [lib/ui-preferences.ts](../lib/ui-preferences.ts) | `IndicatorStyle`, `TableDensity`, `preferenceKeys`, `ACTIVE_ROLE_COOKIE`, `writeActiveRoleCookie`, `readPreference`, `writePreference`, `removePreference`, `onPreferencesChange`, `readIndicator`, `readDensity` | — |
| [lib/use-entry-closed.ts](../lib/use-entry-closed.ts) | `useEntryClosed` | `@/lib/remittance-deadline` |
| [lib/use-form-draft.ts](../lib/use-form-draft.ts) | `useFormDraft`, `clearFormDrafts` | — |
| [lib/users-sheet.ts](../lib/users-sheet.ts) | `USERS_RANGE`, `UserColumns`, `UserRecord`, `userColumns`, `readUserRows`, `loadUsers`, `userCell`, `assertUsernameColumnRemoved` | `@/lib/google-sheets`, `@/lib/encoder-schema`, `@/lib/sheet-headers` |
| [lib/utils.ts](../lib/utils.ts) | `cn` | — |

## Components and UI connections

| File | Exported symbols | Local imports / re-exports |
| --- | --- | --- |
| [components/app-shell.tsx](../components/app-shell.tsx) | `ShellUser`, `AppShell` | `@/components/sidebar`, `@/components/topbar`, `@/lib/access-control`, `@/lib/navigation`, `@/lib/ui-preferences` |
| [components/attendance-calendar.tsx](../components/attendance-calendar.tsx) | `AttendanceCalendar` | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/philippine-holidays` |
| [components/brand-logo.tsx](../components/brand-logo.tsx) | `BrandLogo` | — |
| [components/clerk-report.tsx](../components/clerk-report.tsx) | `ClerkReport` | `@/components/brand-logo`, `@/components/entry-details`, `@/components/receipt-photo`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/clerk-report`, `@/lib/expense-options` |
| [components/company-targets.tsx](../components/company-targets.tsx) | `CompanyTargets` | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label` |
| [components/entry-correction-form.tsx](../components/entry-correction-form.tsx) | `CorrectableEntry`, `EntryCorrectionForm` | `@/components/ui/button`, `@/components/ui/input`, `@/components/ui/label`, `@/lib/api-response` |
| [components/entry-details.tsx](../components/entry-details.tsx) | `EntryDetails` | `@/components/receipt-photo`, `@/components/ui/button`, `@/lib/todays-entries` |
| [components/executive-charts.tsx](../components/executive-charts.tsx) | `Legend`, `RevenueTrend`, `Columns`, `RankRow`, `RankBars`, `Change`, `ShareBar` | — |
| [components/executive-dashboard.tsx](../components/executive-dashboard.tsx) | `ExecutiveDashboard` | `@/components/company-targets`, `@/components/print-button`, `@/components/executive-charts`, `@/components/status-badge`, `@/components/ui/card`, `@/lib/executive-analytics` |
| [components/finance-dashboard.tsx](../components/finance-dashboard.tsx) | `FinanceDashboard` | `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/card`, `@/lib/executive-analytics`, `@/lib/remittance-workflow`, `@/lib/finance-operations` |
| [components/finance-settings.tsx](../components/finance-settings.tsx) | `FinanceSettings` | `@/components/inline-panel`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label` |
| [components/inline-panel.tsx](../components/inline-panel.tsx) | `InlinePanel`, `InlineRow` | `@/lib/utils` |
| [components/member-mam.tsx](../components/member-mam.tsx) | `MemberMam` | `@/components/status-badge` |
| [components/metric-tile.tsx](../components/metric-tile.tsx) | `MetricTile` | `@/components/status-badge` |
| [components/nte-panel.tsx](../components/nte-panel.tsx) | `NtePanel` | `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/search-select`, `@/lib/api-response`, `@/lib/nte` |
| [components/one-time-password.tsx](../components/one-time-password.tsx) | `IssuedPassword`, `OneTimePasswordNotice` | `@/components/ui/button` |
| [components/print-button.tsx](../components/print-button.tsx) | `PrintButton` | `@/components/ui/button` |
| [components/profile.tsx](../components/profile.tsx) | `Profile`, `permissionLabels`, `initials`, `Avatar`, `useProfile`, `ProfileDetails`, `ProfileMenu` | `@/components/status-badge`, `@/lib/utils`, `@/lib/ui-preferences`, `@/lib/use-form-draft` |
| [components/receipt-photo.tsx](../components/receipt-photo.tsx) | `compressReceiptPhoto`, `ReceiptPhotoUpload`, `ReceiptPhotoView` | `@/components/ui/button` |
| [components/remittance-method-settings.tsx](../components/remittance-method-settings.tsx) | `RemittanceMethodSettings` | `@/components/inline-panel`, `@/components/status-badge`, `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label` |
| [components/remittance-summary.tsx](../components/remittance-summary.tsx) | `RemittanceSummary` | — |
| [components/report-tabs.tsx](../components/report-tabs.tsx) | `ReportTabs` | `@/components/clerk-report` |
| [components/sidebar.tsx](../components/sidebar.tsx) | `Sidebar`, `initials` | `@/components/app-shell`, `@/components/brand-logo`, `@/components/profile`, `@/lib/use-form-draft`, `@/components/theme-toggle`, `@/lib/navigation`, `@/lib/ui-preferences` |
| [components/status-badge.tsx](../components/status-badge.tsx) | `Tone`, `toneForStatus`, `StatusBadge` | — |
| [components/system-health-dashboard.tsx](../components/system-health-dashboard.tsx) | `SystemHealthDashboard` | `@/components/status-badge`, `@/components/ui/card`, `@/lib/system-health` |
| [components/theme-toggle.tsx](../components/theme-toggle.tsx) | `useThemePreference`, `ThemeToggle` | `@/lib/theme` |
| [components/topbar.tsx](../components/topbar.tsx) | `Topbar` | `@/components/app-shell`, `@/components/profile`, `@/components/theme-toggle`, `@/lib/navigation` |
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
| [app/api/attendance-calendar/route.ts](../app/api/attendance-calendar/route.ts) | `GET`, `POST` | `@/lib/attendance-calendar`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/google-sheets-data` |
| [app/api/attendance-reviews/route.ts](../app/api/attendance-reviews/route.ts) | `GET`, `POST` | `@/lib/encoder-context`, `@/lib/auto-absence`, `@/lib/employees`, `@/lib/attendance-data`, `@/lib/attendance`, `@/lib/attendance-calendar`, `@/lib/auth-server`, `@/lib/google-sheets-data` |
| [app/api/attendance-tracking/daily/route.ts](../app/api/attendance-tracking/daily/route.ts) | `GET`, `PATCH` | `@/lib/auth-server`, `@/lib/auto-absence`, `@/lib/encoder-context`, `@/lib/attendance-calendar`, `@/lib/attendance-data`, `@/lib/attendance`, `@/lib/attendance-board`, `@/lib/employees`, `@/lib/google-sheets-data` |
| [app/api/attendance-tracking/route.ts](../app/api/attendance-tracking/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/attendance-board`, `@/lib/attendance-data`, `@/lib/employees`, `@/lib/google-sheets-data` |
| [app/api/attendance/route.ts](../app/api/attendance/route.ts) | `GET`, `POST` | `@/lib/encoder-context`, `@/lib/auto-absence`, `@/lib/attendance-data`, `@/lib/attendance-calendar`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/attendance`, `@/lib/auth-server` |
| [app/api/audit/route.ts](../app/api/audit/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/daily-audit`, `@/lib/encoder-context` |
| [app/api/audit/summary/route.ts](../app/api/audit/summary/route.ts) | `GET` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/daily-audit` |
| [app/api/auth/login/route.ts](../app/api/auth/login/route.ts) | `POST` | `@/lib/auth`, `@/lib/default-password`, `@/lib/passwords`, `@/lib/google-sheets`, `@/lib/google-sheets-data`, `@/lib/rate-limit`, `@/lib/session-account`, `@/lib/server-environment` |
| [app/api/auth/logout/route.ts](../app/api/auth/logout/route.ts) | `POST` | `@/lib/auth` |
| [app/api/auth/session/route.ts](../app/api/auth/session/route.ts) | `GET` | `@/lib/auth-server` |
| [app/api/branches/route.ts](../app/api/branches/route.ts) | `GET`, `POST`, `PUT`, `DELETE` | `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/master-data-crud`, `@/lib/google-sheets-data` |
| [app/api/cash-transactions/route.ts](../app/api/cash-transactions/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/finance-data` |
| [app/api/clerk-report/route.ts](../app/api/clerk-report/route.ts) | `GET`, `POST` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/clerk-report`, `@/lib/daily-audit`, `@/lib/employees`, `@/lib/remittance-deadline`, `@/lib/report-remarks`, `@/lib/clerk-cash`, `@/lib/encoder-context`, `@/lib/finance-data` |
| [app/api/collections/route.ts](../app/api/collections/route.ts) | `GET`, `POST` | `@/lib/readable-id`, `@/lib/remittance-deadline`, `@/lib/entry-controls`, `@/lib/date-checks`, `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/db`, `@/lib/account-data`, `@/lib/account-rules`, `@/lib/remittance-methods`, `@/lib/remittance`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/duplicate-entries` |
| [app/api/commissions/route.ts](../app/api/commissions/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/earned-commissions`, `@/lib/encoder-context`, `@/lib/finance-operations` |
| [app/api/company-targets/route.ts](../app/api/company-targets/route.ts) | `POST` | `@/lib/auth-server`, `@/lib/company-targets`, `@/lib/encoder-context` |
| [app/api/employees/route.ts](../app/api/employees/route.ts) | `GET`, `POST`, `PATCH`, `DELETE` | `@/lib/auth-server`, `@/lib/employee-id-change`, `@/lib/encoder-context`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/master-data-crud`, `@/lib/employee-accounts`, `@/lib/privilege-guard` |
| [app/api/exceptions/route.ts](../app/api/exceptions/route.ts) | `GET`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/entry-corrections`, `@/lib/exceptions` |
| [app/api/expenses/route.ts](../app/api/expenses/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/finance-data` |
| [app/api/fidelity/route.ts](../app/api/fidelity/route.ts) | `GET`, `PATCH` | `@/lib/auth-server`, `@/lib/fidelity`, `@/lib/encoder-context` |
| [app/api/finance-options/route.ts](../app/api/finance-options/route.ts) | `GET`, `POST` | `@/lib/encoder-context`, `@/lib/finance-access`, `@/lib/finance-operations`, `@/lib/google-sheets-data` |
| [app/api/google-sheets/test/route.ts](../app/api/google-sheets/test/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/google-sheets` |
| [app/api/history/route.ts](../app/api/history/route.ts) | `GET`, `PATCH` | `@/lib/sheets-on-db`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/google-sheets`, `@/lib/entry-corrections`, `@/lib/encoder-schema`, `@/lib/audit-log` |
| [app/api/leave-approvals/route.ts](../app/api/leave-approvals/route.ts) | `GET`, `POST` | `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/leave-data`, `@/lib/attendance-data` |
| [app/api/leave-requests/route.ts](../app/api/leave-requests/route.ts) | `GET`, `POST` | `@/lib/readable-id`, `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/leave-data` |
| [app/api/mam/member/route.ts](../app/api/mam/member/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/member-scope`, `@/lib/account-data` |
| [app/api/mam/route.ts](../app/api/mam/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/member-scope`, `@/lib/encoder-context`, `@/lib/account-data`, `@/lib/mam-report`, `@/lib/account-rules`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/member-records` |
| [app/api/mas/route.ts](../app/api/mas/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/employees` |
| [app/api/member-programs/check/route.ts](../app/api/member-programs/check/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/member-records` |
| [app/api/members/directory/route.ts](../app/api/members/directory/route.ts) | `GET`, `PATCH`, `DELETE` | `@/lib/access-control`, `@/lib/member-scope`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/master-data-crud`, `@/lib/member-directory-data`, `@/lib/member-directory`, `@/lib/member-transfer` |
| [app/api/members/route.ts](../app/api/members/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/member-records` |
| [app/api/members/standing/route.ts](../app/api/members/standing/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/account-data` |
| [app/api/members/transfer/route.ts](../app/api/members/transfer/route.ts) | `GET`, `POST` | `@/lib/encoder-context`, `@/lib/member-transfer` |
| [app/api/my-entries/route.ts](../app/api/my-entries/route.ts) | `GET`, `POST` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/daily-audit`, `@/lib/remittance-deadline`, `@/lib/todays-entries`, `@/lib/encoder-context`, `@/lib/remittance-workflow` |
| [app/api/nte/route.ts](../app/api/nte/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/nte` |
| [app/api/payroll/route.ts](../app/api/payroll/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/access-control`, `@/lib/encoder-context`, `@/lib/payroll` |
| [app/api/profile/route.ts](../app/api/profile/route.ts) | `GET` | `@/lib/auth-server`, `@/lib/employees`, `@/lib/google-sheets-data`, `@/lib/users-sheet` |
| [app/api/program-categories/route.ts](../app/api/program-categories/route.ts) | `GET`, `POST`, `PUT`, `DELETE` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/program-categories` |
| [app/api/program-incentives/route.ts](../app/api/program-incentives/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/google-sheets-data` |
| [app/api/programs/route.ts](../app/api/programs/route.ts) | `GET`, `POST`, `PUT`, `DELETE` | `@/lib/encoder-context`, `@/lib/auth-server`, `@/lib/master-data-crud`, `@/lib/program-incentive-store`, `@/lib/google-sheets-data` |
| [app/api/receipt-photos/route.ts](../app/api/receipt-photos/route.ts) | `GET`, `POST` | `@/lib/access-control`, `@/lib/remittance-workflow`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/google-sheets`, `@/lib/receipt-photos`, `@/lib/sheet-ranges` |
| [app/api/remittance-methods/route.ts](../app/api/remittance-methods/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/remittance-methods` |
| [app/api/remittances/route.ts](../app/api/remittances/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/remittance-workflow`, `@/lib/access-control` |
| [app/api/reports/route.ts](../app/api/reports/route.ts) | `GET`, `POST` | `@/lib/auth-server`, `@/lib/employees`, `@/lib/access-control`, `@/lib/reports`, `@/lib/encoder-context`, `@/lib/report-remarks` |
| [app/api/roles/route.ts](../app/api/roles/route.ts) | `GET`, `POST`, `PATCH`, `DELETE` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/privilege-guard`, `@/lib/roles` |
| [app/api/sales/route.ts](../app/api/sales/route.ts) | `POST` | `@/lib/auth-server`, `@/lib/program-amount-lock`, `@/lib/entry-controls`, `@/lib/date-checks`, `@/lib/remittance-deadline`, `@/lib/encoder-context`, `@/lib/google-sheets-data`, `@/lib/member-records`, `@/lib/employees`, `@/lib/program-age`, `@/lib/account-rules`, `@/lib/db`, `@/lib/remittance`, `@/lib/duplicate-entries` |
| [app/api/sales/validate/route.ts](../app/api/sales/validate/route.ts) | `POST` | `@/lib/auth-server`, `@/lib/member-records` |
| [app/api/settings/route.ts](../app/api/settings/route.ts) | `PATCH` | `@/lib/auth-server`, `@/lib/google-sheets`, `@/lib/auth`, `@/lib/default-password`, `@/lib/passwords`, `@/lib/session-account`, `@/lib/users-sheet` |
| [app/api/soa/route.ts](../app/api/soa/route.ts) | `GET`, `PATCH` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/statement-of-account` |
| [app/api/todays-entries/route.ts](../app/api/todays-entries/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/access-control`, `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/entry-corrections`, `@/lib/remittance-deadline`, `@/lib/system-settings`, `@/lib/todays-entries` |
| [app/api/user-accounts/password/route.ts](../app/api/user-accounts/password/route.ts) | `POST` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/master-data-crud`, `@/lib/privilege-guard` |
| [app/api/user-accounts/route.ts](../app/api/user-accounts/route.ts) | `GET`, `POST`, `PATCH`, `DELETE` | `@/lib/encoder-context`, `@/lib/employees`, `@/lib/employee-accounts`, `@/lib/auth-server`, `@/lib/master-data-crud`, `@/lib/google-sheets-data`, `@/lib/privilege-guard` |
| [app/api/vendor-payables/route.ts](../app/api/vendor-payables/route.ts) | `GET`, `POST`, `PATCH` | `@/lib/auth-server`, `@/lib/encoder-context`, `@/lib/finance-operations` |

## Page support files and root configuration

| File | Exported symbols | Local imports / re-exports |
| --- | --- | --- |
| [.env.example](../.env.example) | — | — |
| [app/attendance-tracking/daily-board.tsx](../app/attendance-tracking/daily-board.tsx) | `DailyBoard` | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input`, `@/components/ui/label`, `@/components/ui/search-select` |
| [app/fidelity/fidelity-views.tsx](../app/fidelity/fidelity-views.tsx) | `MyFidelity`, `FidelityMonitoring` | `@/components/metric-tile`, `@/components/status-badge`, `@/components/ui/search-select`, `@/components/ui/button`, `@/components/ui/card` |
| [app/globals.css](../app/globals.css) | — | — |
| [app/layout.tsx](../app/layout.tsx) | `metadata`, `viewport`, `RootLayout`, `default` | `./globals.css`, `@/components/app-shell`, `@/lib/theme` |
| [app/loading.tsx](../app/loading.tsx) | `Loading`, `default` | — |
| [app/programs/program-categories.tsx](../app/programs/program-categories.tsx) | `ProgramCategory`, `ProgramCategoriesManager` | `@/components/ui/button`, `@/components/ui/card`, `@/components/ui/input` |
| [components.json](../components.json) | — | — |
| [eslint.config.mjs](../eslint.config.mjs) | — | — |
| [next.config.ts](../next.config.ts) | — | — |
| [package.json](../package.json) | — | — |
| [postcss.config.mjs](../postcss.config.mjs) | — | — |
| [proxy.ts](../proxy.ts) | `proxy`, `config` | `@/lib/auth`, `@/lib/access-control`, `@/lib/session-account` |
| [tsconfig.json](../tsconfig.json) | — | — |

## Maintenance scripts

These are an inventory, not instructions to run every script. Read each script's flags and affected sheets first. Migration, repair, import, and correction scripts can change real business data when configured against a workbook.

| Script | Imports | Supports literal --apply flag |
| --- | --- | --- |
| [scripts/audit-sheet-database.mjs](../scripts/audit-sheet-database.mjs) | `node:fs`, `@next/env`, `googleapis` | No flag detected; read source before running |
| [scripts/check-collections.mjs](../scripts/check-collections.mjs) | `@next/env`, `googleapis` | No flag detected; read source before running |
| [scripts/check-database.mjs](../scripts/check-database.mjs) | `@next/env`, `node:fs`, `postgres` | No flag detected; read source before running |
| [scripts/copy-legacy-import.mjs](../scripts/copy-legacy-import.mjs) | `node:fs`, `postgres` | Yes; read source for semantics |
| [scripts/copy-sheets-to-postgres.mjs](../scripts/copy-sheets-to-postgres.mjs) | `@next/env`, `googleapis`, `postgres` | Yes; read source for semantics |
| [scripts/correct-employee-id.mjs](../scripts/correct-employee-id.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/fix-copy-exception-dates.mjs](../scripts/fix-copy-exception-dates.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/fix-or-letters.mjs](../scripts/fix-or-letters.mjs) | `@next/env`, `postgres` | Yes; read source for semantics |
| [scripts/generate-code-reference.mjs](../scripts/generate-code-reference.mjs) | `node:fs`, `node:path`, `typescript` | Yes; read source for semantics |
| [scripts/hash-password.mjs](../scripts/hash-password.mjs) | `bcryptjs` | No flag detected; read source before running |
| [scripts/inspect-legacy-sheets.mjs](../scripts/inspect-legacy-sheets.mjs) | `@next/env`, `googleapis`, `./legacy-sources.mjs` | No flag detected; read source before running |
| [scripts/inspect-sheet-headers.mjs](../scripts/inspect-sheet-headers.mjs) | `@next/env`, `googleapis` | No flag detected; read source before running |
| [scripts/legacy-programs.mjs](../scripts/legacy-programs.mjs) | `node:fs`, `@next/env`, `googleapis`, `./legacy-sources.mjs` | Yes; read source for semantics |
| [scripts/legacy-sources.mjs](../scripts/legacy-sources.mjs) | `node:fs`, `node:path` | No flag detected; read source before running |
| [scripts/merge-legacy-mas.mjs](../scripts/merge-legacy-mas.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
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
| [scripts/move-photos-to-storage.mjs](../scripts/move-photos-to-storage.mjs) | `@next/env`, `@supabase/supabase-js`, `postgres` | Yes; read source for semantics |
| [scripts/register-legacy-mas.mjs](../scripts/register-legacy-mas.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/remove-blank-rows.mjs](../scripts/remove-blank-rows.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/repair-branch-ids.mjs](../scripts/repair-branch-ids.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/repair-sheet-rows.mjs](../scripts/repair-sheet-rows.mjs) | `@next/env`, `googleapis` | Yes; read source for semantics |
| [scripts/test-access-control.mjs](../scripts/test-access-control.mjs) | `node:assert/strict`, `node:test`, `../lib/access-control.ts` | No flag detected; read source before running |
| [scripts/test-account-rules.mjs](../scripts/test-account-rules.mjs) | `node:assert/strict`, `node:test`, `../lib/account-rules.ts` | No flag detected; read source before running |
| [scripts/test-encoder-tracking.cjs](../scripts/test-encoder-tracking.cjs) | See source | No flag detected; read source before running |
| [scripts/test-remittance.mjs](../scripts/test-remittance.mjs) | `node:assert/strict`, `node:test`, `../lib/remittance.ts` | No flag detected; read source before running |
| [scripts/test-sheets-cache.mjs](../scripts/test-sheets-cache.mjs) | `node:test`, `node:assert/strict`, `../lib/sheets-read-cache.ts` | No flag detected; read source before running |

## Configuration and public text files

- [config/legacy-programs.json](../config/legacy-programs.json)
- [config/sheet-database-schema.json](../config/sheet-database-schema.json)
- [public/robots.txt](../public/robots.txt)
