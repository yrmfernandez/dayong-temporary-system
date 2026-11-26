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
  /** Makes the tile a button (for example to open a filtered list on the same page). */
  onClick?: () => void;
};

/** KPI tile: the number reads first, a tinted icon and top accent say which family it belongs to. */
export function MetricTile({ label, value, detail, icon: Icon, tone = "brand", href, onClick }: MetricTileProps) {
  const body = (
    <div data-slot="card" className={`tone-${tone} group relative h-full overflow-hidden rounded-2xl p-4`}>
      <span className="tone-bar absolute inset-x-0 top-0 h-0.5 opacity-80" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <span className="tone-soft flex size-9 shrink-0 items-center justify-center rounded-xl"><Icon className="size-4.5" /></span>}
      </div>
      <p className="mt-1 break-words text-xl font-bold tracking-tight text-foreground tabular-nums sm:text-2xl">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
  if (onClick) return <button type="button" onClick={onClick} className="tile-interactive block w-full rounded-2xl text-left active:scale-[0.99] transition-transform duration-(--dur-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</button>;
  return href ? <Link href={href} className="tile-interactive block rounded-2xl active:scale-[0.99] transition-transform duration-(--dur-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}
