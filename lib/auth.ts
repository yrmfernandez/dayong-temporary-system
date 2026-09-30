import {
  jwtVerify,
  SignJWT,
} from "jose";
import { getAuthSecret } from "@/lib/server-environment";

export type SessionUser = {
  userId: string;
  employeeId: string;
  name: string;
  /** Configured page routes per assigned role, keyed by lowercase role name. */
  rolePages: Record<string, string[]>;
  roles: string[];
  roleNames: string[];
  permissions: {
    manageUsers: boolean;
    manageAttendance: boolean;
    viewAttendanceReports: boolean;
  };
  /** Signed in with the default or a weak password: only Settings is reachable until it is changed. */
  mustChangePassword: boolean;
  /** Fingerprint of the password hash at sign-in; a password change or reset elsewhere ends this session. */
  passwordStamp: string;
  /** When the account was last confirmed active against the Users sheet (ms). */
  checkedAt: number;
  /** Session end in epoch seconds. Rechecks keep it, so a session never outlives its sign-in by more than 8 hours. */
  expiresAt?: number;
};

export const SESSION_COOKIE = "dayong_session";
export const SESSION_SECONDS = 60 * 60 * 8;

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** Seconds left before the session ends. */
export const sessionMaxAge = (user: Pick<SessionUser, "expiresAt">) =>
  user.expiresAt ? Math.max(0, user.expiresAt - Math.floor(Date.now() / 1000)) : SESSION_SECONDS;

/** The session cookie as a Set-Cookie header value, for handlers that return a plain Response. */
export function serializeSessionCookie(token: string, maxAge: number) {
  const options = sessionCookieOptions(maxAge);
  return `${SESSION_COOKIE}=${token}; Path=${options.path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${options.secure ? "; Secure" : ""}`;
}

let secretKey: Uint8Array | undefined;

function getSecretKey() {
  secretKey ??= new TextEncoder().encode(getAuthSecret());
  return secretKey;
}

export async function createSessionToken(
  user: SessionUser,
) {
  const { expiresAt, ...claims } = user;
  return new SignJWT(claims)
    .setProtectedHeader({
      alg: "HS256",
    })
    .setIssuedAt()
    .setExpirationTime(expiresAt ?? "8h")
    .sign(getSecretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      getSecretKey(),
    );

    // Sessions issued before Employee ID sign-in carry no name; require a fresh sign-in.
    if (!payload.name) return null;

    return {
      userId: String(payload.userId ?? ""),
      employeeId: String(payload.employeeId ?? ""),
      name: String(payload.name ?? ""),
      rolePages: readRolePages(payload.rolePages),
      roles: Array.isArray(payload.roles)
        ? payload.roles.map(String)
        : [],
      roleNames: Array.isArray(payload.roleNames)
        ? payload.roleNames.map(String)
        : [],
      permissions: {
        manageUsers:
          payload.permissions &&
          typeof payload.permissions === "object" &&
          "manageUsers" in payload.permissions
            ? Boolean(payload.permissions.manageUsers)
            : false,

        manageAttendance:
          payload.permissions &&
          typeof payload.permissions === "object" &&
          "manageAttendance" in payload.permissions
            ? Boolean(
                payload.permissions.manageAttendance,
              )
            : false,

        viewAttendanceReports:
          payload.permissions &&
          typeof payload.permissions === "object" &&
          "viewAttendanceReports" in payload.permissions
            ? Boolean(
                payload.permissions
                  .viewAttendanceReports,
              )
            : false,
      },
      mustChangePassword: payload.mustChangePassword === true,
      passwordStamp: String(payload.passwordStamp ?? ""),
      // Sessions issued before rechecks existed are rechecked on their next request.
      checkedAt: Number(payload.checkedAt) || 0,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

function readRolePages(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([, pages]) => Array.isArray(pages)).map(([role, pages]) => [role, (pages as unknown[]).map(String)]));
}
