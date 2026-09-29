import { lineTotals, type Adjustment, type PayrollLine } from "@/lib/payroll-calc";

export const PAYSLIP_COMPANY = "D' San Roque Dayong Providers, Inc.";

export type PayslipRow = { label: string; amount: number; note?: string };

/** Everything printed on a payslip; the on-screen view and the PDF both render from this. */
export type Payslip = {
  runId: string;
  periodFrom: string;
  periodTo: string;
  payDate: string;
  status: string;
  employee: { id: string; name: string; roles: string };
  earnings: PayslipRow[];
  deductions: PayslipRow[];
  gross: number;
  totalDeductions: number;
  net: number;
  /** Deductions that could not be taken because they exceed earnings. */
  shortfall: number;
};

type PayslipRun = { id: string; periodFrom: string; periodTo: string; payDate: string; status: string };

const peso = (value: number) => new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

export function buildPayslip(run: PayslipRun, line: PayrollLine, adjustments: Adjustment[]): Payslip {
  const totals = lineTotals(line, adjustments);
  const own = adjustments.filter((item) => item.employeeId === line.employeeId);
  const fromAdjustments = (kind: Adjustment["kind"]) => own.filter((item) => item.kind === kind).map((item) => ({ label: item.category, amount: item.amount, note: item.reason }));
  const earnings: PayslipRow[] = [
    { label: "Base pay", amount: line.basePay, note: line.baseType === "none" ? "No base pay" : `${line.daysPaid} day(s) × ${peso(line.dailyRate)}${line.leaveDays ? `, ${line.leaveDays} paid leave day(s)` : ""}` },
    { label: "Overtime", amount: line.overtimePay, note: `${line.overtimeHours} hour(s)` },
    { label: "Commission", amount: line.commission, note: line.commissionIds.join(", ") },
    ...fromAdjustments("Addition"),
  ];
  const deductions: PayslipRow[] = [
    { label: "Late", amount: line.lateDeduction, note: `${line.lateMinutes} minute(s)` },
    { label: "Undertime", amount: line.undertimeDeduction, note: `${line.undertimeMinutes} minute(s)` },
    { label: "Absences", amount: line.absenceDeduction, note: `${line.absentDays} day(s)` },
    ...fromAdjustments("Deduction"),
  ];
  return {
    runId: run.id, periodFrom: run.periodFrom, periodTo: run.periodTo, payDate: run.payDate, status: run.status,
    employee: { id: line.employeeId, name: line.employeeName, roles: line.roles },
    earnings: earnings.filter((row) => row.amount > 0),
    deductions: deductions.filter((row) => row.amount > 0),
    gross: totals.gross, totalDeductions: totals.deductions, net: totals.net, shortfall: totals.shortfall,
  };
}

export function payslipFileName(slip: Payslip) {
  return `Payslip-${slip.runId}-${slip.employee.id}.pdf`.replace(/[^\w.-]+/g, "_");
}

// ---------- PDF ----------
// A small, dependency-free PDF writer: A4 portrait, standard Helvetica for text and Courier for right-aligned amounts.

const PAGE = { width: 595, height: 842, left: 50, right: 545, top: 790, bottom: 70 };

/** Standard PDF fonts use WinAnsi (Latin-1 for these characters); swap the few symbols they lack. */
const winAnsi = (value: string) => value.replace(/[—–−]/g, "-").replace(/₱/g, "PHP ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
const pdfText = (value: string) => `(${winAnsi(value).replace(/[\\()]/g, (match) => `\\${match}`)})`;

function wrap(value: string, maxChars: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    if (current && `${current} ${word}`.length > maxChars) { lines.push(current); current = ""; }
    current = current ? `${current} ${word}` : word;
    while (current.length > maxChars) { lines.push(current.slice(0, maxChars)); current = current.slice(maxChars); }
  }
  if (current) lines.push(current);
  return lines;
}

export function payslipPdf(slip: Payslip): Uint8Array {
  const pages: string[][] = [[]];
  let y = PAGE.top;
  const ops = () => pages[pages.length - 1];
  const text = (x: number, size: number, value: string, font = "F1", gray = 0) => ops().push(`${gray} g BT /${font} ${size} Tf ${x} ${y} Td ${pdfText(value)} Tj ET`);
  // Courier glyphs are 0.6 em wide, so right alignment needs no font metrics.
  const amount = (size: number, value: string, font = "F3") => ops().push(`0 g BT /${font} ${size} Tf ${PAGE.right - winAnsi(value).length * size * 0.6} ${y} Td ${pdfText(value)} Tj ET`);
  const rule = (width = 0.5, gray = 0.75) => ops().push(`${gray} G ${width} w ${PAGE.left} ${y} m ${PAGE.right} ${y} l S`);
  const ensure = (space: number) => { if (y - space < PAGE.bottom) { pages.push([]); y = PAGE.top; text(PAGE.left, 9, `${slip.employee.name} - ${slip.runId} (continued)`, "F1", 0.4); y -= 24; } };

  text(PAGE.left, 9, PAYSLIP_COMPANY.toUpperCase(), "F2", 0.4); y -= 24;
  text(PAGE.left, 20, "PAYSLIP", "F2"); y -= 18;
  text(PAGE.left, 10, `Pay period: ${slip.periodFrom} to ${slip.periodTo}`); y -= 14;
  text(PAGE.left, 10, `Pay date: ${slip.payDate || "Not yet paid"}    Payroll: ${slip.runId}    Status: ${slip.status}`); y -= 22;
  rule(1, 0); y -= 22;
  text(PAGE.left, 13, slip.employee.name, "F2"); y -= 15;
  text(PAGE.left, 10, `Employee ID: ${slip.employee.id}${slip.employee.roles ? `    Role: ${slip.employee.roles}` : ""}`, "F1", 0.3); y -= 26;

  const section = (title: string, rows: PayslipRow[], total: number, sign: string) => {
    ensure(60);
    text(PAGE.left, 11, title.toUpperCase(), "F2"); y -= 6; rule(); y -= 15;
    if (!rows.length) { text(PAGE.left, 10, "None", "F1", 0.4); y -= 16; }
    for (const row of rows) {
      const notes = row.note ? wrap(row.note, 95) : [];
      ensure(16 + notes.length * 11);
      text(PAGE.left, 10, row.label);
      amount(10, `${sign}${peso(row.amount)}`);
      y -= 12;
      for (const note of notes) { text(PAGE.left + 10, 8, note, "F1", 0.4); y -= 10; }
      y -= 5;
    }
    rule(); y -= 15;
    text(PAGE.left, 10, `Total ${title.toLowerCase()}`, "F2");
    amount(10, `${sign}${peso(total)}`, "F4");
    y -= 28;
  };
  section("Earnings", slip.earnings, slip.gross, "");
  section("Deductions", slip.deductions, slip.totalDeductions, "-");

  ensure(110);
  ops().push(`0 G 1.5 w ${PAGE.left} ${y - 14} ${PAGE.right - PAGE.left} 34 re S`);
  text(PAGE.left + 12, 13, "NET PAY", "F2");
  amount(14, `PHP ${peso(slip.net)}  `, "F4");
  y -= 34;
  if (slip.shortfall > 0) { text(PAGE.left, 9, `Deductions exceed earnings by PHP ${peso(slip.shortfall)}; net pay is shown as zero.`, "F1", 0.3); y -= 14; }

  ensure(80);
  y -= 50;
  ops().push(`0.4 G 0.5 w ${PAGE.left} ${y} m ${PAGE.left + 200} ${y} l S ${PAGE.right - 200} ${y} m ${PAGE.right} ${y} l S`);
  y -= 12;
  text(PAGE.left, 9, "Prepared by", "F1", 0.4);
  ops().push(`0.4 g BT /F1 9 Tf ${PAGE.right - 200} ${y} Td ${pdfText("Received by")} Tj ET`);

  pages.forEach((page, index) => page.push(
    `0.5 g BT /F1 8 Tf ${PAGE.left} 40 Td ${pdfText(`${slip.runId} - ${slip.employee.id}`)} Tj ET`,
    `0.5 g BT /F1 8 Tf ${PAGE.right - 40} 40 Td ${pdfText(`Page ${index + 1} of ${pages.length}`)} Tj ET`,
  ));

  // Objects: 1 catalog, 2 page tree, 3-6 fonts, then a page and its content stream per page.
  const fonts = ["Helvetica", "Helvetica-Bold", "Courier", "Courier-Bold"];
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${7 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ...fonts.map((font) => `<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`),
  ];
  for (const [index, page] of pages.entries()) {
    const stream = page.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${8 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = objects.map((body, index) => { const offset = pdf.length; pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; return offset; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is a single Latin-1 byte, so string lengths above are byte offsets.
  return Uint8Array.from(pdf, (character) => character.charCodeAt(0));
}
