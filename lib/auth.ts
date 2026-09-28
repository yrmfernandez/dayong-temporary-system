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
};

let secretKey: Uint8Array | undefined;

function getSecretKey() {
  secretKey ??= new TextEncoder().encode(getAuthSecret());
  return secretKey;
}

export async function createSessionToken(
  user: SessionUser,
) {
  return new SignJWT(user)
    .setProtectedHeader({
      alg: "HS256",
    })
    .setIssuedAt()
    .setExpirationTime("8h")
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
    };
  } catch {
    return null;
  }
}

function readRolePages(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([, pages]) => Array.isArray(pages)).map(([role, pages]) => [role, (pages as unknown[]).map(String)]));
}
