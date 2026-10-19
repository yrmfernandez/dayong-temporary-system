// Conservative parser for explicit 2025 arrears followed by 2026 coverage.
const words = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
export function crossYearMonths(value) {
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    return year === 2025 || year === 2026 ? [value.toISOString().slice(0,7)] : null;
  }
  if (typeof value === 'number') return value > 10000 ? crossYearMonths(new Date(Date.UTC(1899,11,30)+Math.round(value*86400000))) : null;
  const text = String(value ?? '').toUpperCase();
  const years = [...new Set(text.match(/\b20\d{2}\b/g) ?? [])].map(Number).sort();
  if (years.some(y => y !== 2025 && y !== 2026)) return null;
  const months = new Set((text.match(/[A-Z]+/g) ?? []).map(w => words.indexOf(w.slice(0,3))+1).filter(n => n > 0));
  if (!months.size || months.size === 12) return null;
  const starts = [...months].filter(m => !months.has((m+10)%12+1));
  if (starts.length !== 1) return null;
  const sequence = Array.from({length:months.size},(_,i) => (starts[0]-1+i)%12+1);
  if (!sequence.every(m => months.has(m))) return null;
  let year = years[0] ?? 2026;
  const result = sequence.map((m,i) => {
    if (i && m < sequence[i-1]) year++;
    return `${year}-${String(m).padStart(2,'0')}`;
  });
  if (year > 2026 || (years.length > 1 && Number(result.at(-1).slice(0,4)) !== years.at(-1))) return null;
  return result;
}
