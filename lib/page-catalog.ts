// Pages an administrator can grant to a role in Roles → Page access. Dashboard and Settings are always allowed.
export const pageCatalog: Array<{ group: string; pages: Array<{ href: string; label: string }> }> = [
  { group: "Operations", pages: [
    { href: "/todays-entries", label: "Today's Entries" },
    { href: "/clearing", label: "Clearing (receipts checked; required before encoding)" },
    { href: "/my-entries", label: "My Entries (receipt photos)" },
    { href: "/new-sales", label: "New Sales" },
    { href: "/mas-sales", label: "Submit New Sales (MAS, reviewed by the branch clerk)" },
    { href: "/collections", label: "Collections" },
    { href: "/remittances", label: "Remittances" },
    { href: "/mam", label: "MAM" },
  ] },
  { group: "Finance", pages: [
    { href: "/cash-transactions", label: "Cash Transactions" },
    { href: "/expenses", label: "Expenses" },
    { href: "/vendor-payables", label: "Vendor Payables" },
    { href: "/commissions", label: "Commissions" },
    { href: "/payroll", label: "Payroll" },
    { href: "/fidelity", label: "Fidelity" },
  ] },
  { group: "Reports", pages: [
    { href: "/reports", label: "Reports (own encoding, daily to yearly)" },
    { href: "/company-reports", label: "Company Reports (every branch)" },
    { href: "/soa", label: "Statement of Account" },
    { href: "/audit", label: "Audits" },
    { href: "/admin-reports", label: "Report Review" },
    { href: "/history", label: "Audit Log" },
    { href: "/exceptions", label: "Exceptions (administrators)" },
  ] },
  { group: "People", pages: [
    { href: "/employees", label: "Employees" },
    { href: "/attendance", label: "My Attendance" },
    { href: "/attendance-reviews", label: "Attendance Review" },
    { href: "/attendance-tracking", label: "Attendance Tracking" },
    { href: "/leave-requests", label: "Leave Requests" },
    { href: "/leave-approvals", label: "Leave Approvals" },
  ] },
  { group: "Master Data", pages: [
    { href: "/members", label: "Members" },
    { href: "/programs", label: "Programs" },
    { href: "/branches", label: "Branches" },
    { href: "/master-data", label: "Master Data" },
  ] },
  { group: "Administration", pages: [
    { href: "/user-accounts", label: "User Accounts" },
    { href: "/roles", label: "Roles" },
  ] },
];

export const pageCatalogRoutes = pageCatalog.flatMap((group) => group.pages.map((page) => page.href));
