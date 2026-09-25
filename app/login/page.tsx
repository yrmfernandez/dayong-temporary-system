"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setMessage("");

    if (!username.trim() || !password) {
      setMessage("Enter your username and password.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const responseText = await response.text();
      let result: { success?: boolean; message?: string } = {};

      try {
        result = JSON.parse(responseText) as typeof result;
      } catch {
        throw new Error(
          response.ok
            ? "The sign-in server returned an invalid response."
            : "The sign-in server is unavailable. Check the Vercel Function logs and environment variables.",
        );
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to sign in.",
        );
      }

      router.replace("/");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to sign in.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">
            DAYONG Monitoring System
          </CardTitle>

          <p className="text-sm text-muted-foreground">
            Sign in using your employee account.
          </p>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-4"
            onSubmit={handleLogin}
          >
            <div className="space-y-2">
              <Label htmlFor="username">
                Username
              </Label>

              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                Password
              </Label>

              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                disabled={submitting}
              />
            </div>

            {message && (
              <p className="text-sm text-destructive">
                {message}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting}
            >
              {submitting
                ? "Signing in..."
                : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
