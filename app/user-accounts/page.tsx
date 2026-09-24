"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Role = {
  id: string;
  name: string;
};

type RolesResponse = {
  success: boolean;
  roles?: Role[];
  message?: string;
};

export default function UserAccountsPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const loadRoles = async () => {
      try {
        const response = await fetch(
          "/api/user-accounts",
          {
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as RolesResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.message ||
              "You are not allowed to manage user accounts.",
          );
        }

        setRoles(result.roles ?? []);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load roles.",
        );
      } finally {
        setLoading(false);
      }
    };

    void loadRoles();
  }, []);

  const toggleRole = (roleId: string) => {
    setRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId],
    );
  };

  const createAccount = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setMessage("");

    if (
      !fullName.trim() ||
      !username.trim() ||
      !password
    ) {
      setMessage(
        "Complete full name, username, and password.",
      );
      return;
    }

    if (roleIds.length === 0) {
      setMessage("Select at least one role.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        "/api/user-accounts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            employeeId,
            fullName,
            username,
            password,
            roleIds,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to create user account.",
        );
      }

      setEmployeeId(result.user?.employeeId ?? "");
      setFullName("");
      setUsername("");
      setPassword("");
      setRoleIds([]);
      setMessage("Employee account created successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create user account.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          User Accounts
        </h1>

        <p className="text-sm text-muted-foreground">
          Create login accounts and assign employee roles.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Employee Account</CardTitle>
        </CardHeader>

        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              Checking access and loading roles...
            </p>
          ) : roles.length === 0 ? (
            <p className="text-sm text-destructive">
              {message ||
                "No active roles are available, or you do not have access."}
            </p>
          ) : (
            <form
              className="space-y-5"
              onSubmit={createAccount}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="employee-id">
                    Employee ID *
                  </Label>

                  <Input
                    id="employee-id"
                    value={employeeId}
                    placeholder="Generated automatically"
                    readOnly
                    disabled
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="full-name">
                    Full Name *
                  </Label>

                  <Input
                    id="full-name"
                    value={fullName}
                    onChange={(event) =>
                      setFullName(event.target.value)
                    }
                    disabled={saving}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="account-username">
                    Username *
                  </Label>

                  <Input
                    id="account-username"
                    value={username}
                    onChange={(event) =>
                      setUsername(event.target.value)
                    }
                    autoComplete="off"
                    disabled={saving}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="account-password">
                    Temporary Password *
                  </Label>

                  <Input
                    id="account-password"
                    type="password"
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    autoComplete="new-password"
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Roles *</Label>

                <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  {roles.map((role) => (
                    <label
                      key={role.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={roleIds.includes(role.id)}
                        onChange={() => toggleRole(role.id)}
                        disabled={saving}
                      />

                      <span>
                        {role.name}{" "}
                        <span className="text-muted-foreground">
                          ({role.id})
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {message && (
                <p className="text-sm text-muted-foreground">
                  {message}
                </p>
              )}

              <Button type="submit" disabled={saving}>
                {saving
                  ? "Creating Account..."
                  : "Create Account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
