import { AsyncLocalStorage } from "node:async_hooks";
import { getSessionUser } from "@/lib/auth-server";

type Encoder = { userId: string; employeeId: string; name: string; encodedAt: string };
const storage = new AsyncLocalStorage<Encoder>();
export function isEncodingRequest() { return Boolean(storage.getStore()); }

// One trusted actor and timestamp per request, including nested/batched saves.
export function withEncoder(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const user = await getSessionUser();
    if (!user?.userId || !user.employeeId || !user.name) {
      return Response.json(
        { success: false, message: "Please sign in to save entries.", error: "Please sign in to save entries." },
        { status: 401 },
      );
    }
    return storage.run({
      userId: user.userId, employeeId: user.employeeId, name: user.name,
      encodedAt: new Date().toISOString(),
    }, () => handler(request));
  };
}

/**
 * Runs work the system does on its own (no user clicked save) as the encoder "System", so every row it writes still
 * carries who wrote it and when.
 */
export function runAsSystem<T>(work: () => Promise<T>) {
  return storage.run({ userId: "system", employeeId: "", name: "System", encodedAt: new Date().toISOString() }, work);
}

export function getEncoder() {
  const encoder = storage.getStore();
  if (!encoder) throw new Error("A verified encoder is required before saving entries.");
  return encoder;
}

/** The signed-in actor of the current save request, or null outside one. */
export function currentEncoder() {
  return storage.getStore() ?? null;
}

export function encoderValues() {
  const actor = getEncoder();
  // USER_ENTERED must treat identity snapshots as literal text, never formulas/numbers.
  return [actor.userId, actor.employeeId, actor.name].map((value) => `'${value}`)
    .concat(actor.encodedAt);
}
