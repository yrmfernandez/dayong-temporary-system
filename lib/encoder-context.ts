import { AsyncLocalStorage } from "node:async_hooks";
import { getSessionUser } from "@/lib/auth-server";

type Encoder = { userId: string; employeeId: string; username: string; encodedAt: string };
const storage = new AsyncLocalStorage<Encoder>();
export function isEncodingRequest() { return Boolean(storage.getStore()); }

// One trusted actor and timestamp per request, including nested/batched saves.
export function withEncoder(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const user = await getSessionUser();
    if (!user?.userId || !user.employeeId || !user.username) {
      return Response.json(
        { success: false, message: "Please sign in to save entries.", error: "Please sign in to save entries." },
        { status: 401 },
      );
    }
    return storage.run({
      userId: user.userId, employeeId: user.employeeId, username: user.username,
      encodedAt: new Date().toISOString(),
    }, () => handler(request));
  };
}

export function getEncoder() {
  const encoder = storage.getStore();
  if (!encoder) throw new Error("A verified encoder is required before saving entries.");
  return encoder;
}

export function encoderValues() {
  const actor = getEncoder();
  // USER_ENTERED must treat identity snapshots as literal text, never formulas/numbers.
  return [actor.userId, actor.employeeId, actor.username].map((value) => `'${value}`)
    .concat(actor.encodedAt);
}
