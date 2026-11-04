"use client";

import { useEffect, useRef } from "react";

/**
 * The red number for a rejected batch clears once the MAS has seen it (owner, November 4, 2026). Put the returned ref on
 * the My submissions list: when it comes on screen with rejections not yet seen, the server records them as seen.
 * `unseen` names those rejections, so one arriving later is reported too.
 */
export function useSeenRejections(url: string, unseen: string) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!unseen || !list.current) return;
    const observer = new IntersectionObserver((items) => {
      if (!items.some((item) => item.isIntersecting)) return;
      observer.disconnect();
      void fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seen" }) }).catch(() => undefined);
    });
    observer.observe(list.current);
    return () => observer.disconnect();
  }, [url, unseen]);
  return list;
}
