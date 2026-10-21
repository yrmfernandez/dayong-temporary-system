/**
 * The warning an Entry Clerk must acknowledge before the preview of a Collections or New Sales batch opens (owner,
 * October 21, 2026: a firm reminder to check every entry before saving). Shown with alertDialog (components/app-dialog.tsx).
 */
export const COLLECTION_CHECK_REMINDER = [
  "You are fully accountable for every collection you save.",
  "Before you continue, check each entry against its official receipt: member, program, OR number and date, amount collected, months and NOP covered, and the collector.",
  "Saved entries are recorded under your name and go straight into members' accounts, remittances and reports. Mistakes can only be corrected through an audit.",
  "Do not save until every entry is correct.",
].join("\n\n");

export const SALE_CHECK_REMINDER = [
  "You are fully accountable for every New Sale you save.",
  "Before you continue, check each sale against its application form and official receipt: member name and details, program, application number, date of issue, amount paid, registration fee and MAS.",
  "Saved sales are recorded under your name and open the member's account, incentives and remittance. Mistakes can only be corrected through an audit.",
  "Do not save until every sale is correct.",
].join("\n\n");
