"use client";

import { useEffect } from "react";
import "./globals.css";
import { themeBootScript } from "@/lib/theme";

/**
 * The last safety net: shown when the app frame itself (root layout, sidebar) fails, so app/error.tsx cannot draw.
 * It replaces the whole document, so it brings its own <html>, styles and theme. Try again reloads the page.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <title>Something went wrong · Dayong Monitoring System</title>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="flex h-full items-center justify-center p-6 text-foreground antialiased">
        <main className="max-w-md space-y-4 text-center" role="alert">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The system could not be shown. Your saved work is safe. Try again, or reload the page; if it keeps happening,
            tell IT{error.digest ? " this reference" : ""}.
          </p>
          {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
          <div className="flex justify-center gap-2">
            <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => retry()}>Try again</button>
            {/* A full page load on purpose: the app frame is what failed, so client navigation cannot be trusted. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="rounded-md border px-4 py-2 text-sm font-medium">Go to dashboard</a>
          </div>
        </main>
      </body>
    </html>
  );
}
