/**
 * A program's saved settings as one comparable string (October 10, 2026). Programs → Edit sends the snapshot of the
 * program as it was when the form opened; the save is refused when the program has changed since, so a form left
 * open never writes older values back over someone else's newer edit (the "my edit is gone" bug).
 * Used by the page (app/programs/page.tsx) and the API (app/api/programs/route.ts) on the same program shape.
 */
type Tier = { role?: unknown; fromMonth?: unknown; toMonth?: unknown; incentiveType?: unknown; markUp?: unknown; incentiveAmount?: unknown; branchId?: unknown; nonCommissionable?: unknown };
export type ProgramSnapshotSource = {
  code?: unknown; name?: unknown; basePay?: unknown; status?: unknown; description?: unknown; categoryId?: unknown;
  registrationFeeRequired?: unknown; registrationAmount?: unknown; payBalanceTotal?: unknown;
  saleIncentiveType?: unknown; saleIncentiveAmount?: unknown; ageRestricted?: unknown; minAge?: unknown; maxAge?: unknown;
  newSaleAmountEditable?: unknown; collectionAmountEditable?: unknown; flexible?: unknown; maxMonthlyPayment?: unknown;
  incentiveTiers?: Tier[];
};

const text = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => (value === null || value === undefined || value === "" ? "" : String(Math.round(Number(value) * 100) / 100));
const flag = (value: unknown) => (value === true ? "1" : "0");

export function programSnapshot(program: ProgramSnapshotSource) {
  const tiers = (program.incentiveTiers ?? [])
    .map((tier) => [text(tier.role), amount(tier.fromMonth), amount(tier.toMonth), text(tier.incentiveType), amount(tier.markUp), amount(tier.incentiveAmount), text(tier.branchId), flag(tier.nonCommissionable)].join("|"))
    .sort();
  return JSON.stringify([
    text(program.code), text(program.name), amount(program.basePay), text(program.status), text(program.description), text(program.categoryId),
    flag(program.registrationFeeRequired), amount(program.registrationAmount), amount(program.payBalanceTotal),
    text(program.saleIncentiveType), amount(program.saleIncentiveAmount), flag(program.ageRestricted), amount(program.minAge), amount(program.maxAge),
    flag(program.newSaleAmountEditable), flag(program.collectionAmountEditable), flag(program.flexible), amount(program.maxMonthlyPayment),
    tiers,
  ]);
}
