// Google Sheets is no longer connected (October 9, 2026), so its credentials are not required.
const REQUIRED_SERVER_VARIABLES = [
  "AUTH_SECRET",
  "DATABASE_URL",
] as const;

export type RequiredServerVariable =
  (typeof REQUIRED_SERVER_VARIABLES)[number];

function removeMatchingQuotes(value: string) {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);

  if (
    trimmed.length >= 2 &&
    ((first === '"' && last === '"') ||
      (first === "'" && last === "'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

export function readServerVariable(
  name: RequiredServerVariable,
) {
  return removeMatchingQuotes(process.env[name] ?? "");
}

export function getMissingServerVariables() {
  return REQUIRED_SERVER_VARIABLES.filter(
    (name) => !readServerVariable(name),
  );
}

export class ServerConfigurationError extends Error {
  readonly variables: RequiredServerVariable[];

  constructor(variables: RequiredServerVariable[]) {
    super(
      `Missing server environment variable${variables.length === 1 ? "" : "s"}: ${variables.join(", ")}.`,
    );
    this.name = "ServerConfigurationError";
    this.variables = variables;
  }
}

export function assertServerConfiguration() {
  const missing = getMissingServerVariables();

  if (missing.length) {
    throw new ServerConfigurationError(missing);
  }
}

export function getAuthSecret() {
  const value = readServerVariable("AUTH_SECRET");
  if (!value) throw new ServerConfigurationError(["AUTH_SECRET"]);
  return value;
}
