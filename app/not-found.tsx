import Link from "next/link";
import { SearchX } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

/** A mistyped or old address: shown inside the app with a way back, instead of the plain default 404. */
export default function NotFound() {
  return (
    <section className="mx-auto max-w-xl space-y-4 py-10">
      <div className="flex items-center gap-3">
        <div className="tone-soft tone-neutral rounded-2xl p-3"><SearchX className="size-7" /></div>
        <h1 className="text-2xl font-bold">Page not found</h1>
      </div>
      <p className="text-sm text-muted-foreground">This address does not match any page. It may be mistyped, or the page has moved; use the menu or go back to the dashboard.</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>Go to dashboard</Link>
    </section>
  );
}
