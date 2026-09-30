import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

/**
 * One-time passwords are issued by IT and handed over in person or by text. The Users sheet stores them as
 * `temp:<issued epoch seconds>:<bcrypt hash>`, so sign-in knows the person must choose their own password and when the
 * one-time password stops working. A password the person sets is stored as a plain bcrypt hash.
 */
const ONE_TIME_PREFIX = "temp:";
export const ONE_TIME_PASSWORD_HOURS = 72;

// Lowercase letters and digits without look-alikes (0/o, 1/l/i), so the password reads clearly aloud or in a text.
const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";

/** e.g. `k7mq-x3tn-p9wd`: 12 random characters (about 59 bits), grouped for reading. */
export function generateOneTimePassword() {
  const groups = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(""));
  return groups.join("-");
}

export const hashPassword = (password: string) => bcrypt.hash(password, 12);

export async function hashOneTimePassword(password: string, issuedAt = Date.now()) {
  return `${ONE_TIME_PREFIX}${Math.floor(issuedAt / 1000)}:${await hashPassword(password)}`;
}

export function oneTimePasswordExpiry(issuedAt = Date.now()) {
  return new Date(issuedAt + ONE_TIME_PASSWORD_HOURS * 60 * 60 * 1000).toISOString();
}

function readStored(stored: string) {
  if (!stored.startsWith(ONE_TIME_PREFIX)) return { hash: stored, oneTime: false, issuedAt: 0 };
  const [issued, ...hash] = stored.slice(ONE_TIME_PREFIX.length).split(":");
  return { hash: hash.join(":"), oneTime: true, issuedAt: Number(issued) * 1000 || 0 };
}

/** Whether `password` matches the stored value, whether that was a one-time password, and whether it has expired. */
export async function checkPassword(password: string, stored: string, now = Date.now()) {
  const { hash, oneTime, issuedAt } = readStored(stored);
  const matches = Boolean(hash) && await bcrypt.compare(password, hash);
  const expired = oneTime && now - issuedAt > ONE_TIME_PASSWORD_HOURS * 60 * 60 * 1000;
  return { matches, oneTime, expired };
}
