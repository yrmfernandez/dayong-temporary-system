"use client";

import { useEffect, useState } from "react";

import { entryClosed } from "@/lib/remittance-deadline";

/** True from the 3:00 PM cutoff until midnight (Manila), checked every 30 seconds; the save routes refuse then too. */
export function useEntryClosed() {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const check = () => setClosed(entryClosed());
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return closed;
}
