/** The shared password older accounts started with. It is never issued now, and signing in with it forces a change. */
export const DEFAULT_PASSWORD = "password12345";

export const MIN_PASSWORD_LENGTH = 12;

const commonPasswords = new Set([DEFAULT_PASSWORD, "password", "password123", "12345678", "qwerty123", "admin123", "dayong123"]);

/** Passwords a sign-in must replace: the old shared default, anything short, or anything commonly guessed. */
export function isWeakPassword(password: string) {
  return password.length < MIN_PASSWORD_LENGTH || commonPasswords.has(password.toLowerCase());
}
