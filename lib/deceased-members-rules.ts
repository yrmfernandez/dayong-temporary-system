/**
 * Deceased Members (owner, November 26, 2026): the lists and limits shared by the page and the server
 * (lib/deceased-members.ts). The labels are saved as they are written here; "Other" is saved as its typed text.
 */
export const DECEASED_REQUIREMENTS = [
  "Application form",
  "Receipts",
  "Membership ID",
  "Certified true copy of death certificate",
  "Barangay certification",
  "Medical certificate",
] as const;

export const DECEASED_CLAIMS = ["Cash", "1 Sack of Rice", "Flower", "Tarpaulin", "7,000", "10,000", "15,000", "20,000"] as const;

/** When the account is converted to services. "Other" asks for the service in words. */
export const DECEASED_SERVICES = ["Half glass", "Full glass", "Other"] as const;

/**
 * Attached files: photos and scans of the requirements, PDFs and office documents. 4 MB each, because a request to the
 * server may not exceed 4.5 MB on Vercel; the page shrinks large photos before sending them. Up to 40 files a record.
 */
export const MAX_DECEASED_FILE_BYTES = 4_000_000;
export const MAX_DECEASED_FILES = 40;
export const DECEASED_FILE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif",
  "application/pdf": "pdf",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
export const DECEASED_FILE_ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx";

export type DeceasedFile = { id: string; name: string; type: string; size: number; uploadedAt: string; uploadedBy: string };

export type DeceasedRecord = {
  id: string; employeeId: string; employeeName: string; branch: string; masEmployeeId: string; masName: string;
  memberId: string; deceasedName: string; programId: string; programName: string; convertedToServices: boolean;
  nop: number | null; totalMonthlyDeposit: number | null; dateOfDeath: string;
  requirements: string[]; requirementsOther: string; claims: string[]; claimsOther: string;
  service: string; serviceOther: string; fullPaymentAmount: number | null; dateOfRelease: string; remarks: string;
  status: "Active" | "Removed"; removedReason: string; removedAt: string; addedAt: string; updatedAt: string;
  files: DeceasedFile[];
};

/** Requirements not handed in yet, out of the six listed ("Other" is extra and never missing). */
export const missingRequirements = (record: Pick<DeceasedRecord, "requirements">) => DECEASED_REQUIREMENTS.filter((item) => !record.requirements.includes(item));

/** The service in words: Half glass, Full glass, or what was typed for Other. */
export const serviceLabel = (record: Pick<DeceasedRecord, "convertedToServices" | "service" | "serviceOther">) =>
  !record.convertedToServices ? "" : record.service === "Other" ? record.serviceOther || "Other" : record.service;

/** Ticked items in words, with the typed Other last. */
export const listWithOther = (items: string[], other: string) => [...items, ...(other ? [other] : [])];
