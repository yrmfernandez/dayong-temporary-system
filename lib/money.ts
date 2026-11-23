// Peso helpers in one place (November 23, 2026). Before this, about forty files wrote their own, and the names misled:
// "money" meant "show as ₱" in pages but "round to centavos" in lib, and "cents" meant "× 100" in some files and
// "round to centavos" in others. Safe on the client and in Node tests.

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const wholePeso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

/** An amount as pesos with centavos: ₱1,234.50. A missing amount shows as ₱0.00. */
export function formatPeso(value: number) {
  return peso.format(value || 0);
}

/** An amount as whole pesos, for dashboards and charts: ₱1,235. */
export function formatPesoWhole(value: number) {
  return wholePeso.format(value || 0);
}

/** An amount in messages, without trailing centavos: ₱500, ₱1,234.5. */
export function formatPesoShort(value: number) {
  return `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

/** An amount rounded to centavos (2 decimals). A missing amount (undefined, text) stays NaN so validation catches it. */
export function roundMoney(value: unknown) {
  return Math.round(Number(value) * 100) / 100;
}

/** An amount as whole centavos (× 100), for comparing amounts without float error. */
export function toCents(value: number) {
  return Math.round(value * 100);
}
