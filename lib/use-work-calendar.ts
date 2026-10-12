"use client";

import { useEffect, useState } from "react";

import type { DeclaredDay } from "@/lib/working-days";

/**
 * The declared non-working days for the entry forms, loaded once (app/api/work-calendar). Until they arrive, or if they
 * cannot be read, only Sundays count as closed; the server checks again with the full calendar when saving.
 */
export function useDeclaredNonWorkingDays() {
  const [days, setDays] = useState<DeclaredDay[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/work-calendar", { signal: controller.signal })
      .then((response) => response.json())
      .then((result) => { if (result.success) setDays(result.days); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return days;
}
