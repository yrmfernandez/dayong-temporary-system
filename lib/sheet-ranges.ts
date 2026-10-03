/**
 * One range per large sheet for every module the dashboards use. The read cache keys on the exact range text, so when
 * the dashboard, reports, remittances, Today's Entries and Exceptions ask for the same range, Collections (55,000+
 * rows, about five seconds per read) is fetched once and shared instead of once per module. Read them with
 * valueRenderOption UNFORMATTED_VALUE and dateTimeRenderOption FORMATTED_STRING so the cache entries match too.
 */
export const COLLECTIONS_RANGE = "'Collections'!A:AN";
export const SALES_RANGE = "'Sales'!A:AS";
export const REMITTANCES_RANGE = "'Remittances'!A:AB";
export const REMITTANCE_LINKS_RANGE = "'Remittance Collections'!A:I";
export const PROGRAMS_RANGE = "'Programs'!A:U";
export const MEMBERS_RANGE = "'Members'!A:V";
