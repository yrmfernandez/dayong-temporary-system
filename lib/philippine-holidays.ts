export const HOLIDAY_TYPES = ["Regular holiday", "Special non-working day", "Special working day"] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

export type HolidayTemplate = { date: string; name: string; type: HolidayType; notes: string };

// Lunar and Islamic holidays move every year and the Islamic ones are only fixed by proclamation, so they come from
// tables. A year missing from a table simply leaves that holiday out; administrators add it in the calendar.
const CHINESE_NEW_YEAR: Record<number, string> = {
  2025: "01-29", 2026: "02-17", 2027: "02-06", 2028: "01-26", 2029: "02-13", 2030: "02-03",
  2031: "01-23", 2032: "02-11", 2033: "01-31", 2034: "02-19", 2035: "02-08",
};
const EID_AL_FITR: Record<number, string> = { 2025: "04-01", 2026: "03-20", 2027: "03-10", 2028: "02-27", 2029: "02-15", 2030: "02-05" };
const EID_AL_ADHA: Record<number, string> = { 2025: "06-06", 2026: "05-27", 2027: "05-17", 2028: "05-05", 2029: "04-24", 2030: "04-13" };
const ESTIMATED = "Estimated date; confirm against the official proclamation.";

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

function lastMondayOfAugust(year: number) {
  const last = utc(year, 8, 31);
  return addDays(last, -((last.getUTCDay() + 6) % 7));
}

/**
 * The usual Philippine national holidays for a year (Republic Act 9492 and the yearly proclamations). They are a
 * starting list only: administrators review them in the calendar, and none of them closes attendance by itself.
 */
export function philippineHolidays(year: number): HolidayTemplate[] {
  const holiday = (date: Date | string, name: string, type: HolidayType, notes = ""): HolidayTemplate =>
    ({ date: typeof date === "string" ? `${year}-${date}` : iso(date), name, type, notes });
  const easterSunday = easter(year);
  const list = [
    holiday("01-01", "New Year's Day", "Regular holiday"),
    holiday("02-25", "EDSA People Power Revolution Anniversary", "Special working day", "Recent proclamations keep this a working day."),
    holiday(addDays(easterSunday, -3), "Maundy Thursday", "Regular holiday"),
    holiday(addDays(easterSunday, -2), "Good Friday", "Regular holiday"),
    holiday(addDays(easterSunday, -1), "Black Saturday", "Special non-working day"),
    holiday("04-09", "Araw ng Kagitingan", "Regular holiday"),
    holiday("05-01", "Labor Day", "Regular holiday"),
    holiday("06-12", "Independence Day", "Regular holiday"),
    holiday("08-21", "Ninoy Aquino Day", "Special non-working day"),
    holiday(lastMondayOfAugust(year), "National Heroes Day", "Regular holiday"),
    holiday("11-01", "All Saints' Day", "Special non-working day"),
    holiday("11-02", "All Souls' Day", "Special non-working day", "Declared by proclamation in recent years."),
    holiday("11-30", "Bonifacio Day", "Regular holiday"),
    holiday("12-08", "Feast of the Immaculate Conception of Mary", "Special non-working day"),
    holiday("12-24", "Christmas Eve", "Special non-working day"),
    holiday("12-25", "Christmas Day", "Regular holiday"),
    holiday("12-30", "Rizal Day", "Regular holiday"),
    holiday("12-31", "Last Day of the Year", "Special non-working day"),
  ];
  if (CHINESE_NEW_YEAR[year]) list.push(holiday(CHINESE_NEW_YEAR[year], "Chinese New Year", "Special non-working day"));
  if (EID_AL_FITR[year]) list.push(holiday(EID_AL_FITR[year], "Eid'l Fitr", "Regular holiday", ESTIMATED));
  if (EID_AL_ADHA[year]) list.push(holiday(EID_AL_ADHA[year], "Eid'l Adha", "Regular holiday", ESTIMATED));
  return list.sort((first, second) => first.date.localeCompare(second.date));
}
