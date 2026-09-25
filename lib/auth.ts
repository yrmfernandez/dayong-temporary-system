import {
  jwtVerify,
  SignJWT,
} from "jose";
import { getAuthSecret } from "@/lib/server-environment";

export type SessionUser = {
  userId: string;
  employeeId: string;
  username: string;
  roles: string[];
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

    return {
      userId: String(payload.userId ?? ""),
      employeeId: String(payload.employeeId ?? ""),
      username: String(payload.username ?? ""),
      roles: Array.isArray(payload.roles)
        ? payload.roles.map(String)
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
