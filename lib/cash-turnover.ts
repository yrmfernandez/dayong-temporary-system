// Cash an Entry Clerk hands to Finance at the office in person (owner, November 24, 2026). It leaves the clerk's cash on
// hand like a bank deposit, so it is kept with them (bank_deposits) with this type of transfer, and the name of who in
// Finance received it in place of the bank account. The clerk report shows it as its own Cash Out line. Pure, so the
// report's form can use it.

/** The type of transfer of cash turned over to Finance in person. */
export const FINANCE_TURNOVER = "Turned over to Finance";

export const isFinanceTurnover = (item: { transferType: string }) => item.transferType === FINANCE_TURNOVER;
