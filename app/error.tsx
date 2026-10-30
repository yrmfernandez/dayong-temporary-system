"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Shown inside the app (sidebar kept) when a page hits an unexpected error while drawing, instead of Next's bare
 * "Application error" screen. Try again reloads the page's data; nothing is saved by this screen.
 */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section className="mx-auto max-w-xl space-y-4 py-10" role="alert">
      <div className="flex items-center gap-3">
        <div className="tone-soft tone-danger rounded-2xl p-3"><AlertTriangle className="size-7" /></div>
        <h1 className="text-2xl font-bold">Something went wrong on this page</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        The page could not be shown. Your saved work is safe: a save either finishes completely or not at all.
        Try again; if it keeps happening, tell IT what you were doing{error.digest ? " and this reference" : ""}.
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => retry()}>Try again</Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>Go to dashboard</Link>
      </div>
    </section>
  );
}
