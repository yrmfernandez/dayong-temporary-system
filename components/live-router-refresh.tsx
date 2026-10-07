"use client";

import { useRouter } from "next/navigation";

import { useLiveRefresh } from "@/lib/use-live-refresh";

/** For server-rendered pages (dashboards): re-renders the page in place when one of `tables` changes. */
export function LiveRouterRefresh({ tables, delayMs }: { tables: string[]; delayMs?: number }) {
  const router = useRouter();
  useLiveRefresh(tables, () => router.refresh(), delayMs);
  return null;
}
