import nextEnv from "@next/env";
import { google } from "googleapis";
nextEnv.loadEnvConfig(process.cwd());
const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });
try {
  const result = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, ranges: ["Collections"], fields: "sheets(properties,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,dataValidation))))" }, { timeout: 20000, retry: false });
  for (const sheet of result.data.sheets ?? []) {
    console.log(JSON.stringify({ properties: sheet.properties }));
    for (const grid of sheet.data ?? []) {
      let populated = 0;
      for (const [index, row] of (grid.rowData ?? []).entries()) {
        const cells = row.values ?? [];
        const rowNumber = (grid.startRow ?? 0) + index + 1;
        if (rowNumber === 1) console.log(JSON.stringify({ headers: cells.map((c) => c.formattedValue ?? "") }));
        if (cells.some((c) => c.userEnteredValue)) {
          populated++;
          if (rowNumber > 1) console.log(JSON.stringify({ row: rowNumber, fields: cells.map((c, i) => ({ column: i + 1, value: c.formattedValue, entered: c.userEnteredValue, error: c.effectiveValue?.errorValue })).filter((c) => c.error || [9,10,11,12,13,14,15,20,26,27,28].includes(c.column)) }));
        }
        for (const [i, cell] of cells.entries()) if (cell.effectiveValue?.errorValue) console.log(JSON.stringify({ errorRow: rowNumber, column: i + 1, error: cell.effectiveValue.errorValue, formula: cell.userEnteredValue?.formulaValue }));
        for (const [i, cell] of cells.entries()) {
          const rule = cell.dataValidation;
          if (cell.userEnteredValue && rule) console.log(JSON.stringify({ validationRow: rowNumber, column: i + 1, value: cell.formattedValue, rule }));
        }
      }
      console.log(JSON.stringify({ populatedRows: populated }));
    }
  }
  const related = await sheets.spreadsheets.values.batchGet({ spreadsheetId: process.env.GOOGLE_SHEET_ID, ranges: ["Collections", "Remittances", "'Member programs'", "Programs"], valueRenderOption: "UNFORMATTED_VALUE" }, { timeout: 20000, retry: false });
  const [collections, remittances, enrollments, programs] = related.data.valueRanges.map((r) => r.values ?? []);
  for (const [index, row] of collections.slice(1).entries()) {
    if (!row[0]) continue;
    const enrollment = enrollments.slice(1).find((e) => e[0] === row[2]);
    const remittance = remittances.slice(1).find((r) => r[0] === row[1]);
    const program = programs.slice(1).find((p) => p[0] === row[5]);
    console.log(JSON.stringify({ collectionRow: index + 2, enrollmentFound: Boolean(enrollment), remittanceFound: Boolean(remittance), programFound: Boolean(program), matchesEnrollment: Boolean(enrollment && enrollment[1] === row[3] && enrollment[3] === row[5] && enrollment[5] === row[6] && enrollment[6] === row[7]), accountStatus: enrollment?.[18], monthlyRate: program?.[3], batchGross: remittance?.[10], batchRemittance: remittance?.[11] }));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
