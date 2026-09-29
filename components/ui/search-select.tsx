"use client"

import * as React from "react"
import { Combobox } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type SearchSelectOption = {
  value: string
  label: string
  /** Secondary text shown under the label and matched by the search. */
  description?: string
  /** Extra text matched by the search but not shown (IDs, codes, territory). */
  keywords?: string
}

type SearchSelectProps = {
  options: SearchSelectOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  id?: string
  className?: string
  "aria-label"?: string
  /** Shows an × button that resets the value to "" (use for "All ..." filters). */
  clearable?: boolean
  /** Called as the user types, for lists that load more matches from the server. */
  onSearchChange?: (query: string) => void
  /** Caps rendered rows so very large lists stay fast; the search still covers every option. */
  limit?: number
}

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")

function matches(option: SearchSelectOption, query: string) {
  const haystack = normalize(`${option.label} ${option.description ?? ""} ${option.keywords ?? ""} ${option.value}`)
  return normalize(query).split(/\s+/).filter(Boolean).every((token) => haystack.includes(token))
}

/** A dropdown whose options can be narrowed by typing. Values are plain strings, like a native select. */
export function SearchSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select...",
  emptyText = "No matches found.",
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
  clearable,
  onSearchChange,
  limit = 200,
}: SearchSelectProps) {
  const selected = React.useMemo(() => options.find((option) => option.value === value) ?? null, [options, value])

  return (
    <Combobox.Root<SearchSelectOption>
      items={options}
      value={selected}
      onValueChange={(option) => onValueChange(option?.value ?? "")}
      onInputValueChange={(query) => { if (onSearchChange && query !== selected?.label) onSearchChange(query) }}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      isItemEqualToValue={(item, current) => item.value === current.value}
      filter={(option, query) => matches(option, query)}
      limit={limit}
      disabled={disabled}
      autoHighlight
    >
      <Combobox.InputGroup
        className={cn(
          "relative flex h-8 w-full min-w-0 items-center rounded-lg border border-input bg-white/70 shadow-sm transition-all hover:border-violet-70 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:bg-input/50 data-disabled:opacity-50 dark:bg-input/30",
          className
        )}
      >
        <Combobox.Input
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        {clearable && value && (
          <Combobox.Clear aria-label="Clear selection" className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground">
            <XIcon className="size-3.5" />
          </Combobox.Clear>
        )}
        <Combobox.Trigger aria-label="Show options" className="flex h-full shrink-0 items-center px-2 text-muted-foreground">
          <ChevronDownIcon className="size-4" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50">
          <Combobox.Popup className="max-h-[min(var(--available-height),20rem)] w-(--anchor-width) min-w-48 overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <Combobox.Empty className="px-2 py-3 text-sm text-muted-foreground empty:hidden">{emptyText}</Combobox.Empty>
            <Combobox.List>
              {(option: SearchSelectOption) => (
                <Combobox.Item
                  key={option.value}
                  value={option}
                  className="relative flex cursor-default items-start gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description && <span className="block truncate text-xs text-muted-foreground">{option.description}</span>}
                  </span>
                  <Combobox.ItemIndicator className="absolute right-2 top-2">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
