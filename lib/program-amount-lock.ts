/**
 * Program rule: whether encoders may type the amount on a New Sale or a Collection (Programs T
 * new_sale_amount_editable, U collection_amount_editable). FALSE, the default, locks the amount to what the program
 * says, so it cannot be mistyped.
 */
export const isTrue = (value: unknown) => value === true || /^(true|yes)$/i.test(String(value ?? "").trim());

/** Programs T:U cells. Anything but an explicit true is FALSE. */
export const amountEditableCells = (data: { newSaleAmountEditable?: unknown; collectionAmountEditable?: unknown }) =>
  [data.newSaleAmountEditable === true ? "TRUE" : "FALSE", data.collectionAmountEditable === true ? "TRUE" : "FALSE"];

/** The locked New Sale amount: the registration amount, or the first month's base pay when there is no registration fee. */
export const fixedNewSaleAmount = (program: { registrationFeeRequired: boolean; registrationAmount: number; basePay: number }) =>
  program.registrationFeeRequired ? program.registrationAmount : program.basePay;
