Absolutely. Below is a consolidated, detailed specification of the **Dayong System** based on the design decisions, business rules, Google Sheets structure, development work, and clarifications we’ve established so far.

I’m separating **confirmed rules**, **current implementation**, and **areas still needing final rules** so we don’t accidentally treat an unfinished idea as an established business rule.

# Dayong System — Detailed System Specification

## 1. What the Dayong System is

The **Dayong System** is an internal operational and account-management system designed to handle the lifecycle of Dayong members and their program accounts.

Its core responsibilities are:

**Member registration → Program enrollment → Sales → Collections → Payment allocation → MAS account assignment → Remittance → Incentive/commission calculation → Account monitoring → MAM → Reports**

It is intended to replace a workflow that otherwise depends heavily on manually maintained spreadsheets and documents.

The system is being built as a web application so authorized Dayong staff can use one consistent interface while the underlying operational data remains organized in the **Dayong Database**.

The current database is:

> **2026 DAYONG DATABASE V3**

The system should be referred to as the **Dayong System**, **Dayong Database**, or **2026 DAYONG DATABASE V3**. We should not use “temporary” in the user-facing system/project naming.

---

# 2. Technology Architecture

The current application is built with:

- **Next.js 16.3.5**
- React
- TypeScript
- Next.js App Router
- Next.js API routes/server-side code
- Google Sheets API
- Google Sheets as the operational database
- Vercel for deployment
- Server-side Google service-account authentication

The current Next.js version we have been working with is **16.3.5**. Next.js itself is a React framework for full-stack applications, and its App Router uses the `app` directory and file-system routing. :chatgpt-content-reference{index="0"}

Conceptually, the architecture is:

```text
User
  ↓
Browser
  ↓
Dayong Next.js Application
  ↓
Next.js Pages / Components
  ↓
API Routes
  ↓
Server-side Data Layer
  ↓
Google Sheets API
  ↓
2026 DAYONG DATABASE V3
```

Google credentials must never be exposed to the browser.

They stay on the server through environment variables and server-side modules.

We have been organizing this around files such as:

```text
lib/google-sheets.ts
lib/google-sheets-data.ts
```

with API routes calling reusable data-layer functions rather than every page directly talking to Google Sheets.

This separation is important because the frontend should not need to understand spreadsheet row numbers or Google Sheets API details.

---

# 3. Overall Data Model

One of the most important architectural decisions is that a **Member is not the same thing as a Member Program**.

A person exists once as a Member.

That person can enroll in multiple programs.

Therefore:

```text
Member
  │
  ├── Member Program A
  │      ├── Sales
  │      ├── Payments
  │      ├── Payment Allocations
  │      ├── MAS Assignment
  │      └── Account Status
  │
  └── Member Program B
         ├── Sales
         ├── Payments
         ├── Payment Allocations
         ├── MAS Assignment
         └── Account Status
```

This is fundamental.

We must **not duplicate the Member record every time the person joins another program**.

Instead:

```text
Members
    ↓
Member Programs
    ↓
Program-specific transactions
```

---

# 4. Core Entities

The full logical data model includes or anticipates the following entities:

```text
Branches
Staff / Employees
Users

Members
Beneficiaries
Member Programs

Programs
Program Incentives

Sales

Collections
Payment Allocations

Remittances

MAS Assignments

Suspensions
Transfers
Reactivations

Attendance

MAM
Reports
```

However, **MAM is not a database table**.

MAM is generated from operational data.

More on that later.

---

# 5. Google Sheets Database

The main spreadsheet is:

> **2026 DAYONG DATABASE V3**

Tabs that have already been connected or discussed include:

```text
Members
Sales
Beneficiaries
Programs
Collections
Branches
Users
```

The expanded architecture also uses or plans normalized sheets such as:

```text
Member Programs
Program Incentives
Payment Allocations
Remittances
Staff / Employees
Transfers
Suspensions
Reactivations
Attendance
```

The system uses stable IDs rather than relying only on row positions.

For example:

```text
MemberID
MemberProgramID
ProgramID
BranchID
MASID
CollectorID
CollectionID
```

This is important because spreadsheet row numbers can change.

Stable IDs also make a later migration to a relational database much easier.

---

# 6. Branches

Branches represent Dayong operating locations.

A branch can be associated with:

```text
Members
MAS
Collectors
Sales
Collections
Remittances
MAM reports
Employees
```

A typical relationship is:

```text
Branch
   ↓
MAS
   ↓
Member Program Accounts
   ↓
Collections
```

Branch is therefore an important reporting and filtering dimension.

MAM in particular begins at the Branch level.

---

# 7. Employees / Staff

The system needs staff records independently from system login accounts.

Operational roles include at least:

### MAS

**Marketing Account Staff**

MAS personnel are responsible for member/program accounts.

### Collector

Responsible for collections and may have a separate incentive structure.

### Entry Clerk

Responsible for encoding operational records, including remittance information from physical documents submitted by MAS.

### IT Clerk

Administrative/technical system access.

### Admin

Higher-level system management.

### HR

Employee/staff-related administration.

### CEO

Management-level visibility/reporting.

A person’s operational role and their system login permissions should conceptually remain separate.

---

# 8. Users

The Users module controls access to the Dayong System.

A system user could be associated with an employee/staff record.

Conceptually:

```text
Employee
    ↓
User Account
    ↓
Role / Permissions
```

Users may include:

```text
Entry Clerk
IT Clerk
Admin
HR
CEO
```

They currently share the same general application interface, although permissions can eventually determine which modules/actions are available.

---

# 9. Members

A Member represents the actual person.

The Member record should contain personal information rather than program-specific payment information.

Examples include:

```text
Member ID
Member Number / PH Number
Surname
First Name
Middle Name
Contact information
Address information
Personal details
Claimant information
Other registration information
```

The exact fields depend on the final Member sheet structure.

The critical rule is:

> **One person should have one Member record even if they enroll in multiple programs.**

---

# 10. Beneficiaries

Beneficiaries are connected to Members and are captured during registration/New Sales where applicable.

Conceptually:

```text
Member
   ↓
Beneficiaries
```

There may be multiple beneficiaries for one member.

This is why beneficiaries should not be forced into a fixed set of columns inside the Member record if the system needs flexible multiple-beneficiary support.

---

# 11. Member Programs

This is one of the most important parts of the architecture.

A **Member Program** represents a specific member's enrollment in a specific program.

Example:

```text
Member:
Juan Dela Cruz

Member Programs:

MP-001
Juan Dela Cruz
Program A

MP-002
Juan Dela Cruz
Program B
```

Juan remains one Member.

But he has two separate accounts/enrollments.

Each can have its own:

```text
Program
Date of enrollment
MAS
Payment history
NOP
Account status
Balance
Collections
Incentives
Transfer history
Suspension history
Reactivation history
```

---

# 12. MAS Assignment Rule

Originally we discussed a single current MAS per member, but the more precise requirement is:

> **MAS assignment needs to be program-specific.**

A Member can have multiple programs, and the MAS responsible for one program does not necessarily need to be the MAS responsible for another.

Therefore:

```text
Member
 ├── Program A → MAS 001
 └── Program B → MAS 014
```

is valid.

The assignment belongs conceptually to:

```text
Member + Program
```

or, more precisely:

```text
MemberProgram
```

rather than permanently to the Member itself.

That distinction will matter significantly for transfers and MAM.

---

# 13. MAS Transfers

When an account moves from one MAS to another, we should preserve history.

Conceptually:

```text
MemberProgram
      ↓
MAS Assignment History

MAS 001
Start: Jan 2026
End: May 2026

MAS 014
Start: Jun 2026
End: Current
```

This lets the system answer:

> Who is responsible for the account now?

and also:

> Who was responsible when this payment was collected?

Those are different questions.

Historical reporting should not change simply because an account later transfers to another MAS.

---

# 14. Programs

The Programs module defines Dayong products/programs.

Current Program configuration includes:

```text
Program Code
Program Name
Description
Base Pay / Monthly Amount
Status
Incentive Rules
```

Status includes:

```text
Active
Inactive
```

The Programs page already supports operations such as:

```text
Add
Edit
Delete
Save
```

and program incentive configuration.

---

# 15. Program Incentives

Incentives are program-specific.

This is important:

> There is not necessarily one global incentive percentage for every program.

Different programs can have different incentive structures.

Furthermore, MAS and Collector incentives are separate.

For example:

```text
Program A

MAS Incentives
Collector Incentives
```

The system must know which role the rule applies to.

---

# 16. Incentive Roles

At minimum:

```text
MAS
Collector
```

have separate incentive configurations.

Therefore a Program might have:

```text
MAS
50%

Collector
10%
```

or entirely different structures.

Changing the Collector incentive should not automatically change the MAS incentive.

---

# 17. Incentive Periods

Incentives can change based on how long the Member Program account has been paying.

An example rule we've discussed is:

```text
Months 1–6
50%

Months 7–13
30%

Later period
12%
```

The exact month-13 boundary needs to remain internally consistent because an earlier example described overlapping ranges around month 13.

The intended architecture nevertheless supports tiers like:

```text
Role
From Month
To Month
Incentive
```

rather than hardcoding one percentage.

---

# 18. Mark Up

We added **Mark Up** into the incentive configuration.

The Programs UI was moving toward a tier layout such as:

```text
Type | Incentive | Mark Up | From | To
```

Mark Up participates in the incentive calculation.

An example we worked through was:

```text
Base Pay = ₱350
Mark Up = ₱50

Incentive Base:
₱350 - ₱50
= ₱300

Incentive:
50% × ₱300
= ₱150

Final Incentive:
₱150 + ₱50
= ₱200
```

So conceptually:

```text
Incentive Base =
Base Pay - Mark Up

Percentage Incentive =
Incentive Base × Incentive Rate

Final Incentive =
Percentage Incentive + Mark Up
```

for the rule configuration where that formula applies.

---

# 19. Incentive Validation

The backend work already introduced validation around incentive configuration.

Rules include:

```text
Mark Up >= 0
Mark Up <= Base Pay
```

Incentive amounts/percentages must also be valid.

Period ranges must be valid.

And overlapping incentive periods for the **same role** should be rejected.

For example:

```text
MAS
1–6

MAS
5–10
```

should be rejected because the ranges overlap.

But:

```text
MAS
1–6

Collector
1–6
```

is fine because they apply to different roles.

---

# 20. New Sales Module

The **New Sales** page is one of the major operational modules already being developed.

It handles both:

1. New members
2. Existing members enrolling in additional programs

That distinction is extremely important.

The page should not blindly create a new Member every time.

---

# 21. New Sales — Existing Member Search

Before creating a Member, the system should allow staff to search existing Members.

For example:

```text
Search:
PH Number
Member Number
Name
```

If the Member already exists:

```text
Load Member
      ↓
Autofill personal information
      ↓
Add new Member Program
```

rather than:

```text
Create duplicate Member
```

---

# 22. New Sales — Batch Information

The New Sales page supports shared/batch information such as:

```text
Branch
MAS
Date Remitted
```

and then multiple sales/member entries underneath.

This makes encoding multiple records more efficient.

---

# 23. New Sales — Sale Entry

Each sale can contain sections for:

```text
Member information
Personal information
Beneficiaries
Claimant
Contact details
Program
Payment
OR information
```

Multiple sales can be entered in the same session.

The interface supports:

```text
Add sale
Remove sale
Collapse/expand sale
Save
Cancel
```

---

# 24. Program Selection in New Sales

The New Sales program selector retrieves Programs from the system.

A program should be identified using a stable program identifier/code.

We recently encountered the React warning:

```text
Encountered two children with the same key,
`undefined-undefined`
```

around:

```tsx
<SelectItem
  key={`${program.programCode}-${program.programName}`}
```

That indicated some Program objects did not contain the expected normalized fields.

This reinforces an architectural requirement:

> API responses should normalize Program records before UI components consume them.

The UI should not have to guess whether a sheet column is called `Program Code`, `programCode`, `Code`, etc.

---

# 25. Sales

Sales represent enrollment/registration transactions.

A Sale connects operational information such as:

```text
Member
Member Program
Program
Branch
MAS
Initial payment
OR information
Date
Date Remitted
```

A Sale is not the Member itself.

This separation prevents Member records from becoming transaction records.

---

# 26. Collections

The Collections module handles ongoing member payments.

A collection should connect to a **MemberProgram**, not just a Member.

Why?

Because:

```text
Member
 ├── Program A
 └── Program B
```

may have completely different payment histories.

If we store only:

```text
MemberID
```

we cannot reliably know which program/account the payment belongs to.

Therefore:

```text
Collection
    ↓
MemberProgramID
```

is essential.

---

# 27. Collection Fields

The normalized collection design includes fields such as:

```text
CollectionID
Timestamp
MemberProgramID
MemberID
BranchID
MASID
CollectorID
ORNumber
ORDate
CollectionDate
AmountCollected
MonthOf
NOP
DateRemitted
Reactivation
Transferred
SuspensionType
OriginalMASOfficer
Status
Remarks
```

Some fields may eventually be normalized further into separate history tables, but this represents the operational information required.

---

# 28. OR Number

Collections maintain Official Receipt information.

For example:

```text
OR Number
OR Date
Amount
```

OR information is also important for MAM.

---

# 29. Collection Date vs Month Of

These must **not** be treated as the same thing.

Example:

A payment could physically be made:

```text
Collection Date:
September 25, 2026
```

but be payment for:

```text
Month Of:
August 2026
```

Therefore:

```text
CollectionDate
```

means when the money was received.

While:

```text
MonthOf
```

or payment allocation means which membership month the payment covers.

This distinction is essential for correct MAM calculations.

---

# 30. Payment Allocations

A single collection can cover multiple months.

Example:

```text
Member pays ₱1,050

Monthly payment = ₱350

Payment covers:

September 2026
October 2026
November 2026
```

We should not represent this as an ambiguous single MonthOf value.

Instead:

```text
Collection
   ↓
Payment Allocation
   September

   Payment Allocation
   October

   Payment Allocation
   November
```

Conceptually:

```text
Collection 1001
Amount = ₱1,050

Allocation 1
Sep = ₱350

Allocation 2
Oct = ₱350

Allocation 3
Nov = ₱350
```

This gives us reliable advance-payment support.

---

# 31. Why Payment Allocations Matter

Without allocations, the system cannot reliably distinguish:

```text
Advance payment
Late payment
Current payment
Multi-month payment
```

It would also make MAM unreliable.

Therefore the correct structure is:

```text
Actual money received
        ↓
Collection

What months that money pays
        ↓
Payment Allocations
```

---

# 32. NOP

NOP is a major account-monitoring value.

The rule established is:

> NOP increments for the same **Member + Program**, not globally for the Member.

More precisely, it should belong to the **MemberProgram**.

Conceptually:

```text
MemberProgram A

Payment 1 → NOP 1
Payment 2 → NOP 2
Payment 3 → NOP 3
```

If the same Member has Program B:

```text
MemberProgram B

Payment 1 → NOP 1
```

Program A being NOP 10 does not make Program B NOP 11.

---

# 33. NOP Calculation

Conceptually:

```text
latest NOP for MemberProgram
        +
        1
        =
new NOP
```

For the first applicable payment:

```text
NOP = 1
```

This allows the system to know how long the account has been paying and is important for incentive tiers.

---

# 34. TMD

TMD is calculated as:

```text
TMD =
Program Monthly Amount × NOP
```

Example:

```text
Monthly Amount = ₱350
NOP = 5

TMD =
₱350 × 5
= ₱1,750
```

TMD therefore grows according to the payment/account progression.

---

# 35. Account Status

The MAM/account-monitoring logic includes statuses such as:

```text
ADV
U
60 D
90 D
120 D
150 D
NS
```

These statuses correspond to different expected balance calculations.

---

# 36. Balance Rules

The established balance rules are:

```text
ADV
Balance = ₱0

U
Balance = Monthly Amount × 1

60 D
Balance = Monthly Amount × 2

90 D
Balance = Monthly Amount × 3

120 D
Balance = Monthly Amount × 4

150 D
Balance = Monthly Amount × 5

NS
Balance = Monthly Amount × 1
```

If:

```text
H = Program Monthly Amount
```

then:

```text
ADV = 0
U   = H × 1
60D = H × 2
90D = H × 3
120D = H × 4
150D = H × 5
NS  = H × 1
```

---

# 37. Example Status Calculation

Suppose:

```text
Program Monthly Amount = ₱350
```

Then:

| Status | Balance |
|---|---:|
| ADV | ₱0 |
| U | ₱350 |
| 60 D | ₱700 |
| 90 D | ₱1,050 |
| 120 D | ₱1,400 |
| 150 D | ₱1,750 |
| NS | ₱350 |

These values can then contribute to account monitoring and quota calculations.

---

# 38. Quota

At the MAM/report level, Quota is conceptually based on the sum of the relevant account balances.

For example:

```text
Account 1 = ₱350
Account 2 = ₱700
Account 3 = ₱0
Account 4 = ₱350
```

Then:

```text
Quota = ₱1,400
```

The exact report-level presentation can still evolve, but the underlying calculation is derived from account balances.

---

# 39. Remittances

Remittance is distinct from collection.

Collection answers:

> What money was collected from the member?

Remittance answers:

> What money/documentation was turned over/encoded for Dayong?

The workflow we established is that the **Entry Clerk** encodes remittance information based on physical copies/documents submitted by MAS.

Conceptually:

```text
Member Payment
     ↓
Collection
     ↓
MAS documentation
     ↓
Physical copy submitted
     ↓
Entry Clerk
     ↓
Remittance encoding
```

---

# 40. Gross Collection vs Net Remittance

The architecture distinguishes:

```text
Gross Collection
```

from:

```text
Net Remittance
```

because incentives/commissions may affect the amount eventually remitted.

However, the exact final business formula for all remittance scenarios still needs to remain configurable/confirmed rather than being hardcoded prematurely.

---

# 41. MAM

**MAM means Member Account Monitoring.**

This is an extremely important distinction:

> **MAM is NOT a Google Sheet/table containing independent account records.**

It is a **generated monitoring/reporting document**.

The MAM should be calculated from the system's existing operational data.

---

# 42. MAM Data Sources

MAM combines information from sources such as:

```text
Members
Member Programs
Programs
Sales / Payments
Collections
Payment Allocations
MAS assignments
Remittances
```

Conceptually:

```text
Members
        +
Member Programs
        +
Programs
        +
Collections
        +
Payment Allocations
        +
MAS Assignments
        +
Remittances
        ↓
MAM Engine
        ↓
Generated MAM
```

This prevents duplicate sources of truth.

---

# 43. MAM Hierarchy

MAM is organized roughly as:

```text
Branch
   ↓
MAS
   ↓
Account / Member
   ↓
Month
```

Depending on the final report layout, Account Type/Program can also participate in grouping/sorting.

The key idea is that MAM provides a monthly operational view of accounts under each MAS.

---

# 44. MAM Fields

MAM may display fields including:

```text
MAS
Active Accounts
Month

APP #
OR #

PH / Member

DOI

Registration Fee

Program

OR Date

Amount

For-the-Month

NOP

Date Remitted

TMD

Status

Balance
```

Some values come directly from stored records.

Others are calculated.

---

# 45. MAM Must Not Create Fake Collections

This is a critical business rule.

Suppose a member does not make a payment in October.

The October MAM may still need to show the account's status based on the payment history.

But:

> The system must not create a fake October Collection just to make the MAM display correctly.

Instead:

```text
Historical payments
       +
Payment allocations
       +
Account state
       ↓
Calculate October MAM state
```

The report can carry forward context without manufacturing transactions.

---

# 46. Carry-Forward Logic

This distinction matters:

```text
Transaction History
```

is factual.

```text
Monthly Account State
```

is derived.

If the last actual payment was August, the system may calculate the September/October status based on account rules.

But the Collections table should continue showing only real payments.

That gives us proper accounting integrity.

---

# 47. Advance Payments

Suppose:

```text
Payment Date:
September 2026

Payment covers:
September
October
November
```

The MAM should recognize October and November as already covered.

Therefore it can display:

```text
ADV
```

or the appropriate account state without requiring new Collection records for those months.

Again, this is why Payment Allocations are critical.

---

# 48. Suspension

The system architecture includes account suspension.

A suspension should conceptually record:

```text
MemberProgramID
Suspension Type
Start Date
End Date
Reason
Status
Encoded By
Timestamp
```

The exact suspension business rules—particularly how suspension changes NOP, status, balances, and incentive periods—still need final definition.

We should not invent those rules.

---

# 49. Reactivation

The system also anticipates reactivation.

Conceptually:

```text
Suspended Member Program
        ↓
Reactivation
        ↓
Active account
```

Reactivation may affect:

```text
Collections
Account status
MAM
NOP
MAS
```

but the exact financial rules still require final confirmation.

---

# 50. Transfers

Transfers are particularly important for MAS responsibility.

A transfer should preserve:

```text
Original MAS
New MAS
Transfer Date
MemberProgram
Reason
Encoded By
Timestamp
```

The system should not simply overwrite history.

For example:

```text
January–May
MAS = Maria

June onward
MAS = Pedro
```

January reports should continue to show Maria.

A later transfer should not rewrite historical responsibility.

---

# 51. Attendance

Attendance is part of the broader Dayong System scope.

It should eventually connect employee/staff attendance with operational reporting.

However, the detailed attendance business rules have not been finalized to the same level as Members, Programs, Sales, Collections, or MAM.

So Attendance should remain a separate module without us inventing unconfirmed policies.

---

# 52. Dashboard

The Dashboard is intended to provide a management-level overview of Dayong operations.

Potential data areas include:

```text
Members
Active accounts
Sales
Collections
Remittances
Branches
MAS performance
Program performance
Account statuses
```

But exact KPI definitions still need to be finalized before hardcoding them.

---

# 53. Daily Reports

Daily Reports should derive information from operational transactions rather than requiring duplicate manual entry.

Potential sources include:

```text
Sales
Collections
Remittances
```

with filters such as:

```text
Date
Branch
MAS
Collector
Program
```

---

# 54. Search

Search is intended to be shared throughout the system.

A staff member should eventually be able to locate a Member using values such as:

```text
PH Number
Member Number
Name
OR Number
```

and navigate to the member/account information.

---

# 55. Member Detail View

The eventual Member detail screen should ideally show the complete relationship:

```text
MEMBER
│
├── Personal Information
│
├── Beneficiaries
│
├── Claimant
│
└── Programs
      │
      ├── Program A
      │    ├── MAS
      │    ├── Enrollment
      │    ├── NOP
      │    ├── Collections
      │    ├── Allocations
      │    ├── Status
      │    ├── Balance
      │    └── History
      │
      └── Program B
           ├── MAS
           ├── Enrollment
           ├── NOP
           ├── Collections
           └── History
```

This reflects the actual data model much better than a flat spreadsheet view.

---

# 56. System Navigation

The overall navigation we've designed includes modules along these lines:

```text
Dashboard

New Sales

Collections

Remittances

Attendance

MAM

Daily Reports

Members

Employees

Programs

Users

Settings
```

Not every module is at the same stage of implementation.

---

# 57. Data-Layer Design

A major architectural goal is to avoid code like this everywhere:

```text
Page
 ↓
Google Sheet directly
```

Instead:

```text
Page
 ↓
API
 ↓
Data Layer
 ↓
Google Sheets
```

For example:

```text
app/programs/page.tsx
        ↓
/api/programs
        ↓
lib/google-sheets-data.ts
        ↓
Google Sheets API
        ↓
Programs Sheet
```

This gives us one place to normalize spreadsheet data.

---

# 58. Data Normalization

Google Sheets column names may be human-readable:

```text
Program Code
Program Name
Base Pay
```

while TypeScript objects should ideally be normalized:

```ts
programCode
programName
basePay
```

The server/data layer should handle this transformation.

Then frontend code receives predictable objects.

That prevents problems such as:

```text
program.programCode === undefined
```

which contributed to the duplicate React key problem we recently encountered.

---

# 59. API Responsibilities

API routes should handle things such as:

```text
Input validation
Data normalization
ID generation
Reading Sheets
Writing Sheets
Updating rows
Deleting/deactivating records
Business-rule validation
Error responses
```

Pages should focus primarily on UI state and user interaction.

---

# 60. Server-Side Security

Google service-account credentials must remain server-side.

Conceptually:

```text
.env.local

GOOGLE_SHEET_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
```

are read by server-side code.

The browser should never receive the private key.

This architecture fits Next.js's full-stack/server-side model. :chatgpt-content-reference{index="1"}

---

# 61. Validation Philosophy

Business validation should not exist only in the browser.

For example, Program incentives might be checked in the UI, but the API must still reject invalid data.

Why?

Because UI validation can be bypassed.

Therefore:

```text
Frontend validation
        +
Backend validation
```

should both exist.

---

# 62. Program Validation Example

Suppose someone submits:

```text
Base Pay = ₱350
Mark Up = ₱500
```

The backend should reject it because:

```text
Mark Up > Base Pay
```

Similarly:

```text
MAS Tier 1 = Months 1–6
MAS Tier 2 = Months 5–10
```

should fail because the same-role periods overlap.

---

# 63. System IDs

The system should rely on stable IDs internally.

For example:

```text
MemberID
ProgramID
MemberProgramID
CollectionID
PaymentAllocationID
BranchID
StaffID
UserID
RemittanceID
```

Human-readable values like:

```text
PH Number
Program Code
OR Number
```

are useful business identifiers, but relational connections should preferably use stable IDs.

---

# 64. Why MemberProgramID Is So Important

Consider:

```text
MemberID = M001
```

with:

```text
Program A
Program B
Program C
```

If Collection only stores:

```text
MemberID = M001
```

we do not know which account changed.

But:

```text
MemberProgramID = MP002
```

immediately tells us:

```text
M001
+
Program B
```

Therefore most account-level operations should ultimately be based on:

```text
MemberProgramID
```

---

# 65. Program-Level MAS Assignment

The same principle applies to MAS.

Incorrect simplified structure:

```text
Member
MASID
```

Better conceptual structure:

```text
MemberProgram
MASID
```

Best long-term structure:

```text
MemberProgram
       ↓
MAS Assignment History
```

because that supports transfers properly.

---

# 66. Full Member Lifecycle

The overall business lifecycle can be visualized as:

```text
                    MEMBER
                       │
                       ▼
               Search Existing?
                  /         \
                Yes          No
                 │            │
                 │        Create Member
                 │            │
                 └──────┬─────┘
                        ▼
                Select Program
                        │
                        ▼
              Create MemberProgram
                        │
                        ▼
                    New Sale
                        │
                        ▼
                 Initial Payment
                        │
                        ▼
               Payment Allocation
                        │
                        ▼
                 MAS Assignment
                        │
                        ▼
                Ongoing Collections
                        │
                        ▼
               Payment Allocations
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
           NOP       Incentive   Status
             │          │          │
             └──────────┼──────────┘
                        ▼
                       MAM
                        │
                        ▼
                     Reports
```

---

# 67. Payment Lifecycle

A payment should flow approximately like:

```text
Member Program
      ↓
Payment received
      ↓
Create Collection
      ↓
Record OR
      ↓
Determine months covered
      ↓
Create Payment Allocations
      ↓
Calculate/update NOP
      ↓
Determine applicable incentive tier
      ↓
Calculate MAS/Collector incentive
      ↓
Remittance
      ↓
MAM/report calculations
```

---

# 68. Incentive Lifecycle

For incentive calculation:

```text
MemberProgram
      ↓
Program
      ↓
NOP / applicable payment period
      ↓
Role
   MAS / Collector
      ↓
Find matching incentive tier
      ↓
Base Pay
      ↓
Mark Up
      ↓
Calculate incentive
```

Therefore incentive configuration belongs to Programs, but incentive calculation happens in the context of an actual account/payment.

---

# 69. Example Complete Scenario

Suppose:

```text
Member:
Juan Dela Cruz

MemberID:
M001
```

Juan enrolls in:

```text
Program A
Monthly = ₱350
```

The system creates:

```text
MemberProgramID:
MP001
```

and assigns:

```text
MAS:
Maria
```

Juan makes his first payment.

```text
Collection:
₱350

NOP:
1

TMD:
₱350 × 1
= ₱350
```

He makes another payment:

```text
NOP:
2

TMD:
₱350 × 2
= ₱700
```

Later Juan joins Program B.

The system should **not** create another Juan.

Instead:

```text
Member:
M001

MemberProgram:
MP002

Program:
B

NOP:
starts independently
```

He could even have:

```text
Program A → MAS Maria

Program B → MAS Pedro
```

This is valid under the program-specific MAS architecture.

---

# 70. Example Advance Payment

Juan's Program A costs:

```text
₱350/month
```

He pays:

```text
₱1,050
```

The Collection records the actual money:

```text
Collection C001
Amount = ₱1,050
```

Then Payment Allocations record:

```text
September = ₱350
October   = ₱350
November  = ₱350
```

MAM can therefore recognize October and November as paid/advance-covered without creating fake October or November collections.

---

# 71. Example Late Account

Suppose the monthly amount is:

```text
₱350
```

and the calculated account status is:

```text
90 D
```

Then:

```text
Balance =
₱350 × 3

Balance =
₱1,050
```

That balance can contribute to the MAS's MAM quota.

---

# 72. Reporting Integrity Principle

One of the most important principles of the Dayong System should be:

> **Store actual events; calculate derived states.**

For example:

Store:

```text
Actual Member
Actual Enrollment
Actual Payment
Actual OR
Actual Allocation
Actual MAS transfer
Actual Suspension
Actual Reactivation
```

Calculate:

```text
Current status
TMD
Balance
Quota
MAM monthly state
Incentives
```

This prevents reports from contaminating transaction history.

---

# 73. MAM Integrity Principle

Therefore MAM should never become a second manually maintained database.

Bad architecture:

```text
Collections
        ↓
Manually copy values
        ↓
MAM Sheet
        ↓
Different values
```

Correct architecture:

```text
Operational Database
        ↓
MAM Calculation Engine
        ↓
Generated MAM
```

That means when underlying information changes legitimately, the report can be regenerated from the source data.

---

# 74. Development Status

A substantial amount of foundation work has already been done.

We've worked on:

```text
Google Sheets connection

Google Sheets data layer

Members

Programs

Program Incentives

New Sales

Program selection

Mark Up

Backend incentive validation

Member/program architecture

Build fixes

Next.js/TypeScript errors

React rendering issues
```

We've also successfully run:

```text
npm run build
```

after previous fixes.

The current Next.js 16 toolchain uses `next build` for production builds, with Turbopack now the default bundler in Next.js 16. :chatgpt-content-reference{index="2"}

---

# 75. Areas That Are Strongly Defined

At this point, these architectural decisions are relatively clear:

**Members and programs are many-to-many through Member Programs.**

```text
Member
 ↕
MemberProgram
 ↕
Program
```

**Payments belong to Member Programs.**

```text
Collection → MemberProgram
```

**NOP is per Member Program.**

```text
Member + Program
```

**MAS responsibility can differ by Member Program.**

```text
Member + Program → MAS
```

**Incentives are configurable per Program and Role.**

```text
Program
 ├── MAS rules
 └── Collector rules
```

**Multi-month payments require allocations.**

```text
Collection → Payment Allocations
```

**MAM is generated.**

```text
Operational Data → MAM
```

**MAM must not manufacture Collection records.**

**TMD is:**

```text
Monthly Amount × NOP
```

**Balance is status-based.**

And historical transfers should not overwrite historical responsibility.

---

# 76. Areas Still Requiring Final Business Rules

Some areas are intentionally **not finalized yet**.

These include details such as:

```text
Exact suspension behavior

Exact reactivation rules

Complete transfer rules

Full remittance formula

All commission/incentive edge cases

Exact month-13 incentive boundary

Attendance policies

Dashboard KPI definitions

Daily Report final layouts

MAM final printable layout

Account status transition rules

How some special payment situations affect NOP

Detailed permissions per user role
```

These should be finalized from actual Dayong business rules rather than guessed during coding.

---

# 77. Recommended Long-Term Data Relationship

The architecture we are effectively moving toward is:

```text
BRANCH
  │
  ├──── STAFF
  │       │
  │       ├── MAS
  │       └── Collector
  │
  └──── MEMBER
           │
           ├──── BENEFICIARY
           │
           └──── MEMBER PROGRAM
                    │
                    ├──── PROGRAM
                    │       │
                    │       └── PROGRAM INCENTIVES
                    │
                    ├──── MAS ASSIGNMENT HISTORY
                    │
                    ├──── SALE
                    │
                    ├──── COLLECTION
                    │        │
                    │        └── PAYMENT ALLOCATIONS
                    │
                    ├──── TRANSFER HISTORY
                    │
                    ├──── SUSPENSION HISTORY
                    │
                    └──── REACTIVATION HISTORY
```

Then:

```text
Member Programs
+
Programs
+
Collections
+
Payment Allocations
+
MAS Assignments
+
Remittances
        ↓
     MAM Engine
        ↓
       MAM
        ↓
     Reports
```

---

# 78. The Central Concept of the Dayong System

If I had to reduce the entire architecture to one idea, it would be:

> **The Member is the person. The Member Program is the account.**

That distinction resolves a huge number of problems.

A person's:

```text
Name
Address
Contact
Beneficiaries
```

belong primarily to the **Member**.

But:

```text
Program
MAS
NOP
Payments
Status
Balance
TMD
Incentives
Transfer
Suspension
Reactivation
```

belong primarily to the **Member Program/account**.

And transactions such as collections should point to that account.

---

# 79. Source of Truth

Ultimately, **2026 DAYONG DATABASE V3** should act as the operational source of truth while we're using Google Sheets.

The web application provides:

```text
Validation
Automation
Search
Calculation
User interface
Reporting
Access control
```

over that data.

The architecture is intentionally structured so that a future move from Google Sheets to something like a relational database would not require completely redesigning the business model.

The frontend could remain broadly:

```text
Dayong UI
    ↓
Dayong APIs
```

while the storage layer changes underneath.

---

# 80. Where the Dayong System Is Heading

The target is not simply an electronic version of the existing sheets.

The better goal is:

```text
                  DAYONG SYSTEM

                      MEMBER
                         │
              ┌──────────┴──────────┐
              │                     │
          PROGRAM A             PROGRAM B
              │                     │
           MAS 01                  MAS 02
              │                     │
        COLLECTIONS           COLLECTIONS
              │                     │
        ALLOCATIONS           ALLOCATIONS
              │                     │
             NOP                    NOP
              │                     │
         INCENTIVES             INCENTIVES
              │                     │
              └──────────┬──────────┘
                         │
                        MAM
                         │
                DAILY / MANAGEMENT
                     REPORTS
```

The result should be a system where Dayong staff encode a real-world event **once**, and the system uses that data everywhere else.

A sale should feed the member account. A payment should feed Collections, NOP, incentives, remittance calculations, MAM, and reports. A MAS transfer should change future responsibility while preserving historical responsibility. A multi-month payment should correctly affect the months it actually covers.

That is the architecture we've been building toward for the **Dayong System**.