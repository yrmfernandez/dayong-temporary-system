"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { readTheme, setTheme, watchTheme, type ThemePreference } from "@/lib/theme";

const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreference(readTheme());
    return watchTheme(setPreference);
  }, []);
  return preference;
}

/** Compact segmented control: Light / Dark / System. */
export function ThemeToggle({ className = "", showLabels = false }: { className?: string; showLabels?: boolean }) {
  const preference = useThemePreference();
  return (
    <div role="radiogroup" aria-label="Color theme" className={`inline-flex items-center gap-0.5 rounded-full border bg-muted/70 p-0.5 ${className}`}>
      {options.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={active} title={`${label} theme`} onClick={() => setTheme(value)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium transition-colors ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon className="size-3.5" />{showLabels ? label : <span className="sr-only">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
