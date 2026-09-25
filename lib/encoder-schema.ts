export const encoderHeaders = [
  "Encoded By User ID", "Encoded By Employee ID", "Encoded By Username", "Encoded At",
];
export const editorHeaders = [
  "Updated By User ID", "Updated By Employee ID", "Updated By Username",
];

// Business columns retain their existing positions. Migration only appends headers.
export const encoderSheets = [
  { title: "Employees", columns: 9 },
  { title: "Members", columns: 30 },
  { title: "Member programs", columns: 14 },
  { title: "Sales", columns: 43 },
  { title: "Remittances", columns: 6 },
  { title: "Remittance Collections", columns: 5 },
  { title: "Collections", columns: 21 },
  { title: "Programs", columns: 6 },
  { title: "Program Incentives", columns: 8 },
  { title: "Branches", columns: 12 },
  { title: "Users", columns: 8 },
  { title: "User Roles", columns: 2 },
  { title: "Attendance", columns: 18 },
  { title: "Leave Requests", columns: 11 },
];

export function columnName(index: number): string {
  let name = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  }
  return name;
}

export function trackingHeaders(title: string): string[] {
  return title === "Attendance" ? [...encoderHeaders, ...editorHeaders] : encoderHeaders;
}

export function quotedSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function getEncoderSheet(range: string) {
  const title = range.split("!")[0].replace(/^'|'$/g, "").replace(/''/g, "'");
  const schema = encoderSheets.find((sheet) => sheet.title.toLowerCase() === title.toLowerCase());
  if (!schema) throw new Error(`No encoder schema for ${title}.`);
  return schema;
}
