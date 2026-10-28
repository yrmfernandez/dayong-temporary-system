import { canConfirmOrWithoutLetterFor } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";

/**
 * A correction's "This OR number really has no letter" tick (owner, October 28, 2026): true only when ticked by an
 * Administrator; ticked by anyone else, the correction is refused. The correction then accepts digits only
 * (lib/or-number.ts orNumberProblem `noLetter`).
 */
export async function orNoLetterConfirmed(value: unknown) {
  if (value !== true) return false;
  const user = await getSessionUser();
  if (!user || !canConfirmOrWithoutLetterFor(user)) throw new Error("Only an Administrator can confirm that an OR number has no letter.");
  return true;
}

/** Added to a correction's reason, so Record Corrections shows the OR number was confirmed without a letter. */
export const NO_LETTER_NOTE = "OR number confirmed by an Administrator to have no letter";
