"use client";

import { useState } from "react";

const peso = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value);
const compact = (value: number) => new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/** Round an axis maximum up to a readable step so gridlines land on clean numbers. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((step) => step * magnitude).find((step) => step >= value) ?? value;
}

function Tooltip({ x, children }: { x: number; children: React.ReactNode }) {
  return <div role="status" className="pointer-events-none absolute top-2 z-10 min-w-40 -translate-x-1/2 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg" style={{ left: `${Math.min(Math.max(x, 12), 88)}%` }}>{children}</div>;
}

function Key({ color, label, value }: { color: string; label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 text-muted-foreground"><span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />{label}</span><strong className="tabular-nums text-foreground">{value}</strong></div>;
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">{items.map((item) => <span key={item.label} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: item.color }} aria-hidden />{item.label}</span>)}</div>;
}

type TrendPoint = { month: string; label: string; sales: number; collections: number; accounts: number };

/** Monthly revenue as stacked columns: New Sales at the base, Collections on top. */
export function RevenueTrend({ points }: { points: TrendPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const width = 720, height = 240, left = 48, bottom = 24, top = 8;
  const max = niceMax(Math.max(...points.map((point) => point.sales + point.collections), 0));
  const slot = (width - left) / points.length, bar = Math.min(36, slot * 0.6);
  const y = (value: number) => top + (height - top - bottom) * (1 - value / max);
  const point = active === null ? null : points[active];
  return <div className="viz relative">
    <Legend items={[{ label: "New Sales", color: "var(--viz-1)" }, { label: "Collections", color: "var(--viz-2)" }]} />
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-auto w-full" role="img" aria-label="Monthly revenue, New Sales and Collections, last 12 months" onPointerLeave={() => setActive(null)}>
      {[0, 0.25, 0.5, 0.75, 1].map((step) => <g key={step}><line x1={left} x2={width} y1={y(max * step)} y2={y(max * step)} stroke="var(--viz-grid)" /><text x={left - 8} y={y(max * step) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{compact(max * step)}</text></g>)}
      {points.map((item, index) => {
        const x = left + slot * index + (slot - bar) / 2, salesTop = y(item.sales), total = y(item.sales + item.collections), baseline = y(0);
        const dim = active !== null && active !== index;
        return <g key={item.month} tabIndex={0} onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} className="outline-none" opacity={dim ? 0.45 : 1}>
          <rect x={left + slot * index} y={top} width={slot} height={height - top - bottom} fill="transparent" />
          {item.sales > 0 && <rect x={x} y={salesTop} width={bar} height={Math.max(0, baseline - salesTop)} rx={item.collections > 0 ? 0 : 4} fill="var(--viz-1)" />}
          {item.collections > 0 && <path d={roundedTop(x, total, bar, Math.max(0, salesTop - total - (item.sales > 0 ? 2 : 0)))} fill="var(--viz-2)" />}
          <text x={left + slot * index + slot / 2} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">{item.label}</text>
        </g>;
      })}
    </svg>
    {point && active !== null && <Tooltip x={((left + slot * (active + 0.5)) / width) * 100}><p className="mb-1 font-semibold text-foreground">{new Date(`${point.month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</p><Key color="var(--viz-1)" label="New Sales" value={peso(point.sales)} /><Key color="var(--viz-2)" label="Collections" value={peso(point.collections)} /><div className="mt-1 border-t pt-1"><Key color="transparent" label="Total" value={peso(point.sales + point.collections)} /><Key color="transparent" label="New accounts" value={String(point.accounts)} /></div></Tooltip>}
  </div>;
}

// A bar whose top two corners are rounded and whose base stays square against the segment below it.
function roundedTop(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, height, width / 2);
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
}

/** Single-series columns with the value printed on each bar (few categories, so every label fits). */
export function Columns({ items, format = "count", label }: { items: Array<{ label: string; value: number; detail?: string }>; format?: "count" | "money"; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...items.map((item) => item.value), 0) || 1;
  const best = items.reduce((top, item, index) => item.value > items[top].value ? index : top, 0);
  return <figure className="viz relative" aria-label={label}>
    <div className="flex h-44 items-end gap-2">
      {items.map((item, index) => <div key={item.label} tabIndex={0} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 outline-none">
        <span className="text-xs font-semibold tabular-nums text-foreground">{format === "money" ? compact(item.value) : item.value}</span>
        <span className="w-full max-w-10 rounded-t-[4px] transition-opacity" style={{ height: `${(item.value / max) * 80}%`, minHeight: item.value ? 2 : 0, background: "var(--viz-1)", opacity: index === best || active === index ? 1 : 0.55 }} />
      </div>)}
    </div>
    <div className="mt-2 flex gap-2 border-t pt-2">{items.map((item) => <span key={item.label} className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">{item.label}</span>)}</div>
    {active !== null && items[active].detail && <Tooltip x={((active + 0.5) / items.length) * 100}><p className="font-semibold text-foreground">{items[active].label}</p><p className="text-muted-foreground">{items[active].detail}</p></Tooltip>}
  </figure>;
}

export type RankRow = { label: string; value: number; secondary?: string; change?: number | null };

/** Ranked horizontal bars: name, bar, value, and change against the previous period. */
export function RankBars({ rows, format = "money", empty = "No activity in this period." }: { rows: RankRow[]; format?: "money" | "count"; empty?: string }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.value), 0) || 1;
  return <ol className="viz space-y-3">
    {rows.map((row, index) => <li key={row.label} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="row-span-2 text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
      <span className="truncate text-sm font-medium text-foreground" title={row.label}>{row.label}</span>
      <span className="text-right text-sm font-semibold tabular-nums">{format === "money" ? peso(row.value) : row.value.toLocaleString("en-PH")}</span>
      <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${(row.value / max) * 100}%`, background: index === 0 ? "var(--viz-1)" : "color-mix(in oklab, var(--viz-1) 60%, transparent)" }} /></span>
      <span className="flex items-center justify-end gap-2 text-xs text-muted-foreground">{row.secondary}{row.change !== undefined && <Change value={row.change} />}</span>
    </li>)}
  </ol>;
}

export function Change({ value, className = "" }: { value: number | null; className?: string }) {
  if (value === null) return <span className={`text-xs text-muted-foreground ${className}`}>New</span>;
  const tone = value > 0 ? "text-emerald-700 dark:text-emerald-400" : value < 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground";
  return <span className={`text-xs font-semibold tabular-nums ${tone} ${className}`}>{value > 0 ? "▲" : value < 0 ? "▼" : "•"} {Math.abs(value).toFixed(Math.abs(value) >= 10 ? 0 : 1)}%</span>;
}

/** Part-to-whole as one segmented bar with a labelled legend, so each share reads without colour. */
export function ShareBar({ segments, label }: { segments: Array<{ label: string; value: number; color: string }>; label: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) return <p className="py-8 text-center text-sm text-muted-foreground">No accounts to show.</p>;
  return <div className="viz">
    <div className="flex h-4 gap-0.5 overflow-hidden rounded-[4px]" role="img" aria-label={label}>
      {segments.filter((segment) => segment.value).map((segment) => <span key={segment.label} title={`${segment.label}: ${segment.value}`} style={{ flexGrow: segment.value, background: segment.color }} />)}
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {segments.map((segment) => <div key={segment.label} className="flex items-start gap-2"><span className="mt-1 size-2.5 shrink-0 rounded-sm" style={{ background: segment.color }} aria-hidden /><div><dt className="text-xs text-muted-foreground">{segment.label}</dt><dd className="text-sm font-semibold tabular-nums">{segment.value.toLocaleString("en-PH")} <span className="font-normal text-muted-foreground">· {((segment.value / total) * 100).toFixed(1)}%</span></dd></div></div>)}
    </dl>
  </div>;
}
