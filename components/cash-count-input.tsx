"use client";

import { Input } from "@/components/ui/input";
import { cashCountTotal, DENOMINATIONS, type CashCount } from "@/lib/cash-count";

const peso = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

/** Pieces of each bill and coin; the total is calculated, never typed. */
export function CashCountInput({ value, onChange, disabled }: { value: CashCount; onChange: (value: CashCount) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        {DENOMINATIONS.map((denomination) => (
          <label key={denomination} className="space-y-1 text-xs">
            <span className="block font-medium text-muted-foreground">₱{denomination.toLocaleString("en-PH")}</span>
            <Input
              type="number" min="0" step="1" inputMode="numeric" disabled={disabled} aria-label={`Number of ₱${denomination} bills or coins`}
              value={value[denomination] ?? ""} placeholder="0"
              onWheel={(event) => event.currentTarget.blur()}
              onChange={(event) => onChange({ ...value, [denomination]: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
            />
          </label>
        ))}
      </div>
      <p className="text-sm">Counted total: <strong>{peso(cashCountTotal(value))}</strong></p>
    </div>
  );
}
