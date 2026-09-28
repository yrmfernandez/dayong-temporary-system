// Company Employee ID format: PREFIX-YYYY-NNNN. Shared by forms, APIs, and account creation.
export const EMPLOYEE_ID_PATTERN = /^[A-Z]{2,5}-\d{4}-\d{4}$/;
// HTML pattern attribute (case-insensitive input is uppercased before saving).
export const EMPLOYEE_ID_INPUT_PATTERN = "[A-Za-z]{2,5}-[0-9]{4}-[0-9]{4}";
export const EMPLOYEE_ID_EXAMPLE = "MD-20##-####";
export const EMPLOYEE_ID_FORMAT_MESSAGE = `Employee ID must use the company format ${EMPLOYEE_ID_EXAMPLE}.`;

export const normalizeEmployeeId = (value: string) => value.trim().toUpperCase();
export const isEmployeeIdFormat = (value: string) => EMPLOYEE_ID_PATTERN.test(normalizeEmployeeId(value));
