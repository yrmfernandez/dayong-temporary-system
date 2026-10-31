/** Search Records choices shared by the page and the server (lib/record-search.ts). */
export const RECORD_KINDS = [["all", "Everything"], ["collections", "Collections"], ["sales", "New Sales"], ["members", "Members and contacts"]] as const;
/** Which date the range applies to. Kinds without that date are skipped while it is chosen. */
export const DATE_FIELDS = [["or", "OR date"], ["remitted", "Date remitted"], ["encoded", "Date encoded"], ["doi", "DOI (New Sales)"], ["birthdate", "Birthdate (members)"]] as const;
