import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import type { Tone } from "@/components/status-badge";

type MetricTileProps = {
  label: string;
  value: string | number;
  detail?: string;
  icon?: LucideIcon;
  tone?: Tone;
  href?: string;
};

/** KPI tile: the number reads first, a tinted icon and top accent say which family it belongs to. */
export function MetricTile({ label, value, detail, icon: Icon, tone = "brand", href }: MetricTileProps) {
  const body = (
    <div data-slot="card" className={`tone-${tone} group relative h-full overflow-hidden rounded-[1.25rem] p-4 transition-transform ${href ? "hover:-translate-y-0.5" : ""}`}>
      <span className="tone-bar absolute inset-x-0 top-0 h-1 opacity-80" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <span className="tone-soft flex size-9 shrink-0 items-center justify-center rounded-xl"><Icon className="size-4.5" /></span>}
      </div>
      <p className="mt-1 break-words text-xl font-bold tracking-tight text-foreground tabular-nums sm:text-2xl">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-[1.25rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}
