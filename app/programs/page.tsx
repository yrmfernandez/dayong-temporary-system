"use client";

import { useEffect, useState } from "react";
import {
ChevronDown,
ChevronUp,
Pencil,
Plus,
Trash2,
X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
Card,
CardContent,
CardHeader,
CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type IncentiveType = "percentage" | "fixed";

type IncentiveRole = "MAS" | "Collector";

type PeriodUnit = "month" | "year";

type IncentiveTier = {
id?: string;
programId?: string;
role: IncentiveRole;
fromMonth: number;
toMonth: number;
incentiveType: IncentiveType;
markUp: number;
incentiveAmount: number;
};

type IncentiveTierForm = {
fromValue: string;
fromUnit: PeriodUnit;

toValue: string;
toUnit: PeriodUnit;

incentiveType: IncentiveType;

markUp: string;

totalIncentive: string;
masIncentive: string;
collectorIncentive: string;
};

type Program = {
id: string;
code: string;
name: string;
basePay: number;
status: "active" | "inactive";
description: string;
incentiveTiers: IncentiveTier[];
};

type ProgramForm = {
code: string;
name: string;
basePay: string;
description: string;
status: "active" | "inactive";
incentiveTiers: IncentiveTierForm[];
};

function createEmptyTier(): IncentiveTierForm {
return {
fromValue: "1",
fromUnit: "month",

toValue: "6",
toUnit: "month",

incentiveType: "percentage",

markUp: "0",

totalIncentive: "50",
masIncentive: "30",
collectorIncentive: "20",

};
}

function createEmptyForm(): ProgramForm {
return {
code: "",
name: "",
basePay: "",
description: "",
status: "active",

incentiveTiers: [
  createEmptyTier(),
],

};
}

function periodToMonths(
value: string,
unit: PeriodUnit,
) {
const numericValue = Number(value);

if (
!Number.isFinite(numericValue) ||
numericValue < 1
) {
return NaN;
}

return unit === "year"
? numericValue * 12
: numericValue;
}

function formatPeso(
amount: number | string | undefined,
) {
const numericAmount =
typeof amount === "number"
? amount
: Number(amount ?? 0);

if (!Number.isFinite(numericAmount)) {
return "₱0.00";
}

return `₱${numericAmount.toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`;
}

function formatIncentive(
amount: number | string | undefined,
type: IncentiveType | undefined,
) {
const numericAmount =
typeof amount === "number"
? amount
: Number(amount ?? 0);

if (!Number.isFinite(numericAmount)) {
return type === "fixed"
? "₱0.00"
: "0%";
}

if (type === "fixed") {
return formatPeso(numericAmount);
}

return `${numericAmount}%`;
}

function formatMonthRange(
fromMonth: number,
toMonth: number,
) {
if (fromMonth === toMonth) {
return `Month ${fromMonth}`;
}

if (toMonth >= 999999) {
return `Month ${fromMonth}+`;
}

return `Months ${fromMonth}–${toMonth}`;
}

function formatPeriodInput(
value: string,
unit: PeriodUnit,
) {
const numericValue = Number(value);

if (
!Number.isFinite(numericValue) ||
numericValue < 1
) {
return "";
}

return `${numericValue} ${
    unit === "year"
      ? numericValue === 1
        ? "Year"
        : "Years"
      : numericValue === 1
        ? "Month"
        : "Months"
  }`;
}

function calculateIncentive(
basePay: number,
markUp: number,
incentiveType: IncentiveType,
incentiveAmount: number,
) {
const safeBasePay =
Number.isFinite(basePay)
? basePay
: 0;

const safeMarkUp =
Number.isFinite(markUp)
? markUp
: 0;

const safeAmount =
Number.isFinite(incentiveAmount)
? incentiveAmount
: 0;

if (incentiveType === "percentage") {
const incentiveBase =
Math.max(
safeBasePay - safeMarkUp,
0,
);

return (
  incentiveBase *
  (safeAmount / 100)
);

}

return safeAmount;
}

function calculateTotalRemittance(
basePay: number,
markUp: number,
incentiveType: IncentiveType,
totalIncentive: number,
) {
const incentive =
calculateIncentive(
basePay,
markUp,
incentiveType,
totalIncentive,
);

return incentive + markUp;
}

function getSplitTotal(
mas: string,
collector: string,
) {
return (
(Number(mas) || 0) +
(Number(collector) || 0)
);
}

export default function ProgramsPage() {
const [programs, setPrograms] =
useState<Program[]>([]);

const [form, setForm] =
useState<ProgramForm>(
createEmptyForm(),
);

const [editingId, setEditingId] =
useState<string | null>(null);

const [loadError, setLoadError] = useState("");
const [loading, setLoading] =
useState(true);

const [saving, setSaving] =
useState(false);

const [showForm, setShowForm] =
useState(false);
const [canManage, setCanManage] = useState(false);

const [expandedPrograms, setExpandedPrograms] =
useState<Record<string, boolean>>({});

async function loadPrograms() {
setLoadError("");
try {
setLoading(true);

  const response = await fetch(
    "/api/programs",
    {
      method: "GET",
      cache: "no-store",
    },
  );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error ||
        "Failed to load programs.",
    );
  }

  const loadedPrograms =
    Array.isArray(data.programs)
      ? data.programs
      : [];
  setCanManage(Boolean(data.canManage));

  setPrograms(
    loadedPrograms.map(
      (program: Program) => ({
        ...program,

        incentiveTiers:
          Array.isArray(
            program.incentiveTiers,
          )
            ? program.incentiveTiers.map(
                (tier) => ({
                  ...tier,
                  markUp:
                    Number(
                      tier.markUp ?? 0,
                    ),
                  incentiveAmount:
                    Number(
                      tier.incentiveAmount ??
                        0,
                    ),
                }),
              )
            : [],
      }),
    ),
  );
 } catch (error) {
  setLoadError(error instanceof Error ? error.message : "Failed to load programs.");
} finally {
  setLoading(false);
}

}

useEffect(() => {
// Loading begins after the component is mounted and synchronizes with the API.
// eslint-disable-next-line react-hooks/set-state-in-effect
loadPrograms();
}, []);

function resetForm() {
setForm(createEmptyForm());
setEditingId(null);
setShowForm(false);
}

function startAddingProgram() {
resetForm();
setShowForm(true);
}

function toggleProgram(programId: string) {
setExpandedPrograms((current) => ({
  ...current,
  [programId]: !current[programId],
}));
}

function updateForm(
field: keyof ProgramForm,
value:
| string
| IncentiveTierForm[]
| "active"
| "inactive",
) {
setForm((current) => ({
...current,
[field]: value,
}));
}

function updateTier(
index: number,
field: keyof IncentiveTierForm,
value: string,
) {
setForm((current) => {
const tiers = [
...current.incentiveTiers,
];

  tiers[index] = {
    ...tiers[index],
    [field]: value,
  };

  return {
    ...current,
    incentiveTiers: tiers,
  };
});

}

function addTier() {
setForm((current) => ({
...current,

  incentiveTiers: [
    ...current.incentiveTiers,
    createEmptyTier(),
  ],
}));

}

function removeTier(index: number) {
setForm((current) => ({
...current,

  incentiveTiers:
    current.incentiveTiers.filter(
      (_, tierIndex) =>
        tierIndex !== index,
    ),
}));

}

function validateTiers() {
if (
form.incentiveTiers.length === 0
) {
alert(
"Please add at least one incentive period.",
);

  return false;
}

const normalizedPeriods: {
  from: number;
  to: number;
}[] = [];

for (
  let index = 0;
  index < form.incentiveTiers.length;
  index++
) {
  const tier =
    form.incentiveTiers[index];

  const fromMonth =
    periodToMonths(
      tier.fromValue,
      tier.fromUnit,
    );

  const toMonth =
    periodToMonths(
      tier.toValue,
      tier.toUnit,
    );

  const markUp =
    Number(tier.markUp);

  const totalIncentive =
    Number(tier.totalIncentive);

  const masIncentive =
    Number(tier.masIncentive);

  const collectorIncentive =
    Number(
      tier.collectorIncentive,
    );

  const splitTotal =
    getSplitTotal(
      tier.masIncentive,
      tier.collectorIncentive,
    );

  if (
    !tier.fromValue.trim() ||
    !Number.isFinite(fromMonth) ||
    fromMonth < 1
  ) {
    alert(
      `Tier ${index + 1}: From period must be 1 or greater.`,
    );

    return false;
  }

  if (
    !tier.toValue.trim() ||
    !Number.isFinite(toMonth) ||
    toMonth < fromMonth
  ) {
    alert(
      `Tier ${index + 1}: To period must be greater than or equal to From period.`,
    );

    return false;
  }

  if (
    !Number.isInteger(fromMonth) ||
    !Number.isInteger(toMonth)
  ) {
    alert(
      `Tier ${index + 1}: Period values must be whole numbers.`,
    );

    return false;
  }

  if (
    !tier.markUp.trim() ||
    !Number.isFinite(markUp) ||
    markUp < 0
  ) {
    alert(
      `Tier ${index + 1}: Mark Up must be 0 or greater.`,
    );

    return false;
  }

  if (
    !tier.totalIncentive.trim() ||
    !Number.isFinite(
      totalIncentive,
    ) ||
    totalIncentive < 0
  ) {
    alert(
      `Tier ${index + 1}: Total incentive must be 0 or greater.`,
    );

    return false;
  }

  if (
    !tier.masIncentive.trim() ||
    !Number.isFinite(
      masIncentive,
    ) ||
    masIncentive < 0
  ) {
    alert(
      `Tier ${index + 1}: MAS incentive must be 0 or greater.`,
    );

    return false;
  }

  if (
    !tier.collectorIncentive.trim() ||
    !Number.isFinite(
      collectorIncentive,
    ) ||
    collectorIncentive < 0
  ) {
    alert(
      `Tier ${index + 1}: Collector incentive must be 0 or greater.`,
    );

    return false;
  }

  if (
    tier.incentiveType ===
      "percentage" &&
    totalIncentive > 100
  ) {
    alert(
      `Tier ${index + 1}: Total percentage cannot be greater than 100%.`,
    );

    return false;
  }

  if (
    tier.incentiveType ===
      "percentage" &&
    splitTotal > 100
  ) {
    alert(
      `Tier ${index + 1}: MAS and Collector percentages cannot exceed 100% combined.`,
    );

    return false;
  }

  if (
    Math.abs(
      splitTotal -
        totalIncentive,
    ) > 0.0001
  ) {
    alert(
      `Tier ${index + 1}: MAS and Collector must add up to the Total Incentive.`,
    );

    return false;
  }

  normalizedPeriods.push({
    from: fromMonth,
    to: toMonth,
  });
}

normalizedPeriods.sort(
  (a, b) => a.from - b.from,
);

for (
  let index = 1;
  index <
  normalizedPeriods.length;
  index++
) {
  const previous =
    normalizedPeriods[index - 1];

  const current =
    normalizedPeriods[index];

  if (
    current.from <=
    previous.to
  ) {
    alert(
      "Incentive periods cannot overlap. Please adjust the ranges.",
    );

    return false;
  }
}

return true;

}

async function saveProgram() {
if (!form.code.trim()) {
alert(
"Please enter a program code.",
);
return;
}

if (!form.name.trim()) {
  alert(
    "Please enter a program name.",
  );
  return;
}

const basePay =
  Number(form.basePay);

if (
  !form.basePay.trim() ||
  !Number.isFinite(basePay) ||
  basePay <= 0
) {
  alert(
    "Base Pay must be greater than 0.",
  );
  return;
}

if (!validateTiers()) {
  return;
}

try {
  setSaving(true);

  /*
   * The UI uses one combined tier:
   *
   * Total Incentive
   * ├── MAS
   * └── Collector
   *
   * The API/database still receives
   * separate role records.
   */
  const incentiveTiers =
    form.incentiveTiers.flatMap(
      (tier) => {
        const fromMonth =
          periodToMonths(
            tier.fromValue,
            tier.fromUnit,
          );

        const toMonth =
          periodToMonths(
            tier.toValue,
            tier.toUnit,
          );

        const markUp =
          Number(tier.markUp);

        const masAmount =
          Number(
            tier.masIncentive,
          );

        const collectorAmount =
          Number(
            tier.collectorIncentive,
          );

        return [
          {
            role: "MAS" as const,

            fromMonth,

            toMonth,

            incentiveType:
              tier.incentiveType,

            markUp,

            incentiveAmount:
              masAmount,
          },

          {
            role:
              "Collector" as const,

            fromMonth,

            toMonth,

            incentiveType:
              tier.incentiveType,

            markUp,

            incentiveAmount:
              collectorAmount,
          },
        ];
      },
    );

  const payload = {
    code: form.code.trim(),

    name: form.name.trim(),

    basePay,

    incentiveTiers,

    description:
      form.description.trim(),

    status: form.status,
  };

  const response = await fetch(
    editingId
      ? `/api/programs?id=${encodeURIComponent(
          editingId,
        )}`
      : "/api/programs",
    {
      method: editingId
        ? "PUT"
        : "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify(
        payload,
      ),
    },
  );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error ||
        "Failed to save program.",
    );
  }

  const savedEditingId =
    editingId;

  resetForm();

  await loadPrograms();

  alert(
    savedEditingId
      ? "Program updated successfully."
      : `Program saved successfully. ID: ${
          data.program?.id ?? ""
        }`,
  );
} catch (error) {
  console.error(
    "Failed to save program:",
    error,
  );

  alert(
    error instanceof Error
      ? error.message
      : "Failed to save program.",
  );
} finally {
  setSaving(false);
}

}

function editProgram(
program: Program,
) {
setEditingId(program.id);
setShowForm(true);

const existingTiers =
  Array.isArray(
    program.incentiveTiers,
  )
    ? program.incentiveTiers
    : [];

/*
 * Convert the backend's separate
 * MAS / Collector records back
 * into combined UI tiers.
 */
const grouped = new Map<
  string,
  IncentiveTierForm
>();

existingTiers.forEach(
  (tier) => {
    const key = [
      tier.fromMonth,
      tier.toMonth,
      tier.incentiveType,
      tier.markUp,
    ].join("|");

    const existing =
      grouped.get(key);

    if (existing) {
      if (
        tier.role === "MAS"
      ) {
        existing.masIncentive =
          String(
            tier.incentiveAmount ??
              0,
          );
      }

      if (
        tier.role ===
        "Collector"
      ) {
        existing.collectorIncentive =
          String(
            tier.incentiveAmount ??
              0,
          );
      }

      existing.totalIncentive =
        String(
          Number(
            existing.masIncentive,
          ) +
            Number(
              existing.collectorIncentive,
            ),
        );

      return;
    }

    grouped.set(key, {
      fromValue: String(
        tier.fromMonth ?? 1,
      ),

      fromUnit: "month",

      toValue: String(
        tier.toMonth ?? 999999,
      ),

      toUnit: "month",

      incentiveType:
        tier.incentiveType ??
        "percentage",

      markUp: String(
        tier.markUp ?? 0,
      ),

      totalIncentive: String(
        tier.incentiveAmount ?? 0,
      ),

      masIncentive:
        tier.role === "MAS"
          ? String(
              tier.incentiveAmount ??
                0,
            )
          : "0",

      collectorIncentive:
        tier.role ===
        "Collector"
          ? String(
              tier.incentiveAmount ??
                0,
            )
          : "0",
    });
  },
);

const combinedTiers =
  Array.from(
    grouped.values(),
  );

setForm({
  code: program.code ?? "",

  name: program.name ?? "",

  basePay: String(
    program.basePay ?? 0,
  ),

  description:
    program.description ?? "",

  status:
    program.status === "inactive"
      ? "inactive"
      : "active",

  incentiveTiers:
    combinedTiers.length > 0
      ? combinedTiers
      : [createEmptyTier()],
});

window.scrollTo({
  top: 0,
  behavior: "smooth",
});

}

async function deleteProgram(
program: Program,
) {
const confirmed =
window.confirm(
`Are you sure you want to delete ${program.id} - ${program.name}?`,
);

if (!confirmed) {
  return;
}

try {
  const response = await fetch(
    `/api/programs?id=${encodeURIComponent(
      program.id,
    )}`,
    {
      method: "DELETE",
    },
  );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error ||
        "Failed to delete program.",
    );
  }

  if (editingId === program.id) {
    resetForm();
  }

  await loadPrograms();

  alert(
    "Program deleted successfully.",
  );
} catch (error) {
  console.error(
    "Failed to delete program:",
    error,
  );

  alert(
    error instanceof Error
      ? error.message
      : "Failed to delete program.",
  );
}

}

function renderIncentiveTier(
tier: IncentiveTierForm,
index: number,
) {
const basePay =
Number(form.basePay) || 0;

const markUp =
  Number(tier.markUp) || 0;

const totalIncentive =
  Number(
    tier.totalIncentive,
  ) || 0;

const masIncentive =
  Number(tier.masIncentive) || 0;

const collectorIncentive =
  Number(
    tier.collectorIncentive,
  ) || 0;

const splitTotal =
  masIncentive +
  collectorIncentive;

const splitMatches =
  Math.abs(
    splitTotal -
      totalIncentive,
  ) < 0.0001;

const incentive =
  calculateIncentive(
    basePay,
    markUp,
    tier.incentiveType,
    totalIncentive,
  );

const totalRemittance =
  calculateTotalRemittance(
    basePay,
    markUp,
    tier.incentiveType,
    totalIncentive,
  );

const incentiveBase =
  Math.max(
    basePay - markUp,
    0,
  );

return (
  <div
    key={index}
    className="rounded-xl border bg-background p-5"
  >
    {/* HEADER */}
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {index + 1}
          </span>

          <h4 className="font-semibold">
            Incentive Period
          </h4>
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          Set the payment period,
          mark up, and split the
          incentive between MAS and
          Collector.
        </p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() =>
          removeTier(index)
        }
        aria-label="Remove incentive period"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>

    {/* PERIOD */}
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="mb-3">
        <p className="text-sm font-semibold">
          Payment Period
        </p>

        <p className="text-xs text-muted-foreground">
          How long has the member been
          paying this program?
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* FROM */}
        <div className="space-y-2">
          <Label>
            From
          </Label>

          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Input
              type="number"
              min="1"
              step="1"
              value={
                tier.fromValue
              }
              onChange={(event) =>
                updateTier(
                  index,
                  "fromValue",
                  event.target.value,
                )
              }
              onWheel={(event) => {
                event.currentTarget.blur();
              }}
              placeholder="1"
            />

            <Select
              value={
                tier.fromUnit
              }
              onValueChange={(
                value,
              ) =>
                updateTier(
                  index,
                  "fromUnit",
                  value === "year"
                    ? "year"
                    : "month",
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="month">
                  Month
                </SelectItem>

                <SelectItem value="year">
                  Year
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            {formatPeriodInput(
              tier.fromValue,
              tier.fromUnit,
            )}
          </p>
        </div>

        {/* TO */}
        <div className="space-y-2">
          <Label>
            To
          </Label>

          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Input
              type="number"
              min="1"
              step="1"
              value={
                tier.toValue
              }
              onChange={(event) =>
                updateTier(
                  index,
                  "toValue",
                  event.target.value,
                )
              }
              onWheel={(event) => {
                event.currentTarget.blur();
              }}
              placeholder="6"
            />

            <Select
              value={
                tier.toUnit
              }
              onValueChange={(
                value,
              ) =>
                updateTier(
                  index,
                  "toUnit",
                  value === "year"
                    ? "year"
                    : "month",
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="month">
                  Month
                </SelectItem>

                <SelectItem value="year">
                  Year
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            {formatPeriodInput(
              tier.toValue,
              tier.toUnit,
            )}
          </p>
        </div>
      </div>
    </div>

    {/* INCENTIVE SETTINGS */}
    <div className="mt-4 grid gap-4 md:grid-cols-3">
      {/* TYPE */}
      <div className="space-y-2">
        <Label>
          Incentive Type
        </Label>

        <Select
          value={
            tier.incentiveType
          }
          onValueChange={(
            value,
          ) =>
            updateTier(
              index,
              "incentiveType",
              value === "fixed"
                ? "fixed"
                : "percentage",
            )
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="percentage">
              Percentage
            </SelectItem>

            <SelectItem value="fixed">
              Fixed Amount
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* TOTAL INCENTIVE */}
      <div className="space-y-2">
        <Label>
          Total Incentive
        </Label>

        <div className="relative">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={
              tier.totalIncentive
            }
            onChange={(event) =>
              updateTier(
                index,
                "totalIncentive",
                event.target.value,
              )
            }
            onWheel={(event) => {
              event.currentTarget.blur();
            }}
            className={
              tier.incentiveType ===
              "percentage"
                ? "pr-8"
                : "pl-8"
            }
            placeholder={
              tier.incentiveType ===
              "percentage"
                ? "50"
                : "500"
            }
          />

          {tier.incentiveType ===
            "percentage" && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              %
            </span>
          )}

          {tier.incentiveType ===
            "fixed" && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              ₱
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          The total amount available
          to split between MAS and
          Collector.
        </p>
      </div>

      {/* MARK UP */}
      <div className="space-y-2">
        <Label>
          Mark Up
        </Label>

        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            ₱
          </span>

          <Input
            type="number"
            min="0"
            step="0.01"
            value={tier.markUp}
            onChange={(event) =>
              updateTier(
                index,
                "markUp",
                event.target.value,
              )
            }
            onWheel={(event) => {
              event.currentTarget.blur();
            }}
            className="pl-8"
            placeholder="50"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Enter once. Applied to the
          tier&apos;s remittance.
        </p>
      </div>
    </div>

    {/* ROLE SPLIT */}
    <div className="mt-5 rounded-lg border p-4">
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              Incentive Split
            </p>

            <p className="text-xs text-muted-foreground">
              Divide the total incentive
              between MAS and Collector.
            </p>
          </div>

          <div
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              splitMatches
                ? "bg-muted"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {formatIncentive(
              splitTotal,
              tier.incentiveType,
            )}{" "}
            /{" "}
            {formatIncentive(
              totalIncentive,
              tier.incentiveType,
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* MAS */}
        <div className="rounded-lg border p-4">
          <div className="mb-3">
            <p className="font-semibold">
              MAS
            </p>

            <p className="text-xs text-muted-foreground">
              Marketing Account Staff
            </p>
          </div>

          <div className="relative">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={
                tier.masIncentive
              }
              onChange={(event) =>
                updateTier(
                  index,
                  "masIncentive",
                  event.target.value,
                )
              }
              onWheel={(event) => {
                event.currentTarget.blur();
              }}
              className={
                tier.incentiveType ===
                "percentage"
                  ? "pr-8"
                  : "pl-8"
              }
              placeholder={
                tier.incentiveType ===
                "percentage"
                  ? "30"
                  : "300"
              }
            />

            {tier.incentiveType ===
              "percentage" && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            )}

            {tier.incentiveType ===
              "fixed" && (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ₱
              </span>
            )}
          </div>
        </div>

        {/* COLLECTOR */}
        <div className="rounded-lg border p-4">
          <div className="mb-3">
            <p className="font-semibold">
              Collector
            </p>

            <p className="text-xs text-muted-foreground">
              Collection staff
            </p>
          </div>

          <div className="relative">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={
                tier.collectorIncentive
              }
              onChange={(event) =>
                updateTier(
                  index,
                  "collectorIncentive",
                  event.target.value,
                )
              }
              onWheel={(event) => {
                event.currentTarget.blur();
              }}
              className={
                tier.incentiveType ===
                "percentage"
                  ? "pr-8"
                  : "pl-8"
              }
              placeholder={
                tier.incentiveType ===
                "percentage"
                  ? "20"
                  : "200"
              }
            />

            {tier.incentiveType ===
              "percentage" && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            )}

            {tier.incentiveType ===
              "fixed" && (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ₱
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SPLIT VALIDATION */}
      <div
        className={`mt-4 rounded-md px-3 py-2 text-sm ${
          splitMatches
            ? "bg-muted"
            : "bg-destructive/10 text-destructive"
        }`}
      >
        {splitMatches ? (
          <div className="flex items-center justify-between gap-3">
            <span>
              MAS + Collector
            </span>

            <span className="font-semibold">
              {formatIncentive(
                splitTotal,
                tier.incentiveType,
              )}{" "}
              ✓
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span>
              Remaining to allocate
            </span>

            <span className="font-semibold">
              {formatIncentive(
                totalIncentive -
                  splitTotal,
                tier.incentiveType,
              )}
            </span>
          </div>
        )}
      </div>
    </div>

    {/* CALCULATION */}
    <div className="mt-5 rounded-lg bg-muted/40 p-4">
      <div className="mb-3">
        <p className="text-sm font-semibold">
          Calculation Preview
        </p>

        <p className="text-xs text-muted-foreground">
          This is calculated from the
          program Base Pay.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">
            Base Pay
          </p>

          <p className="text-sm font-semibold">
            {formatPeso(basePay)}
          </p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">
            Incentive Base
          </p>

          <p className="text-sm font-semibold">
            {formatPeso(
              incentiveBase,
            )}
          </p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">
            Total Incentive
          </p>

          <p className="text-sm font-semibold">
            {formatPeso(
              incentive,
            )}
          </p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">
            Total Remittance
          </p>

          <p className="text-sm font-bold">
            {formatPeso(
              totalRemittance,
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>
            {formatMonthRange(
              periodToMonths(
                tier.fromValue,
                tier.fromUnit,
              ) || 1,
              periodToMonths(
                tier.toValue,
                tier.toUnit,
              ) || 1,
            )}
          </span>

          <span>
            Mark Up:{" "}
            {formatPeso(markUp)}
          </span>

          <span>
            MAS:{" "}
            {formatIncentive(
              masIncentive,
              tier.incentiveType,
            )}
          </span>

          <span>
            Collector:{" "}
            {formatIncentive(
              collectorIncentive,
              tier.incentiveType,
            )}
          </span>
        </div>
      </div>
    </div>
  </div>
);

}

return ( <div className="mx-auto max-w-7xl space-y-6">
{loadError && <div role="alert" className="rounded-md border border-destructive p-3 text-sm">{loadError}<Button variant="outline" disabled={loading} onClick={() => void loadPrograms()} className="ml-3">Retry</Button></div>}
{/* PAGE HEADER */} <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
  <div>
    <h1 className="text-2xl font-bold tracking-tight">
      Programs
    </h1>

    <p className="text-sm text-muted-foreground">
      Manage Dayong programs, base
      pay, mark up, and incentive
      sharing between MAS and
      Collector.
    </p>
  </div>

  {canManage && <Button type="button" onClick={startAddingProgram}>
    <Plus className="mr-2 size-4" />
    Add Program
  </Button>}
</div>

  {/* PROGRAM FORM */}
  {showForm && (
  <Card>
    <CardHeader>
      <CardTitle>
        {editingId
          ? "Edit Program"
          : "Add Program"}
      </CardTitle>
    </CardHeader>

    <CardContent className="space-y-6">
      {/* PROGRAM INFORMATION */}
      <div>
        <h3 className="mb-4 text-sm font-semibold">
          Program Information
        </h3>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>
              Program Code *
            </Label>

            <Input
              value={form.code}
              onChange={(event) =>
                updateForm(
                  "code",
                  event.target.value,
                )
              }
              placeholder="Example: 290"
            />
          </div>

          <div className="space-y-2">
            <Label>
              Program Name *
            </Label>

            <Input
              value={form.name}
              onChange={(event) =>
                updateForm(
                  "name",
                  event.target.value,
                )
              }
              placeholder="Example: Program 290"
            />
          </div>
        </div>
      </div>

      {/* PROGRAM SETTINGS */}
      <div>
        <h3 className="mb-4 text-sm font-semibold">
          Program Settings
        </h3>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>
              Base Pay *
            </Label>

            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ₱
              </span>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={
                  form.basePay
                }
                onChange={(event) =>
                  updateForm(
                    "basePay",
                    event.target.value,
                  )
                }
                onWheel={(event) => {
                  event.currentTarget.blur();
                }}
                className="pl-8"
                placeholder="350"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Used for TMD, Balance,
              and incentive calculations.
            </p>
          </div>

          <div className="space-y-2">
            <Label>
              Status
            </Label>

            <Select
              value={form.status}
              onValueChange={(
                value,
              ) =>
                updateForm(
                  "status",
                  value ===
                    "inactive"
                    ? "inactive"
                    : "active",
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="active">
                  Active
                </SelectItem>

                <SelectItem value="inactive">
                  Inactive
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* INCENTIVE TIERS */}
      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              Incentive Schedule
            </h3>

            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Create one incentive period,
              then divide the total incentive
              between MAS and Collector.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTier}
          >
            <Plus className="mr-2 size-4" />
            Add Period
          </Button>
        </div>

        <div className="space-y-4">
          {form.incentiveTiers.map(
            (tier, index) =>
              renderIncentiveTier(
                tier,
                index,
              ),
          )}
        </div>
      </div>

      {/* DESCRIPTION */}
      <div className="space-y-2">
        <Label>
          Description
        </Label>

        <Textarea
          value={form.description}
          onChange={(event) =>
            updateForm(
              "description",
              event.target.value,
            )
          }
          placeholder="Program description, rules, notes, etc."
        />
      </div>

      {/* BUTTONS */}
      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        {editingId && (
          <Button
            type="button"
            variant="outline"
            onClick={resetForm}
            disabled={saving}
          >
            <X className="mr-2 size-4" />
            Cancel
          </Button>
        )}

        <Button
          type="button"
          onClick={saveProgram}
          disabled={saving}
        >
          <Plus className="mr-2 size-4" />

          {saving
            ? "Saving..."
            : editingId
              ? "Update Program"
              : "Add Program"}
        </Button>
      </div>
    </CardContent>
  </Card>
  )}

  {/* PROGRAM LIST */}
  <Card>
    <CardHeader>
      <CardTitle>
        Program List
      </CardTitle>
    </CardHeader>

    <CardContent>
      {loading ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Loading programs...
          </p>
        </div>
      ) : programs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">
            No programs yet.
          </p>

          <p className="text-sm text-muted-foreground">
            Add your first program
            above.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {programs.map(
            (program) => {
              const periods =
                Array.from(
                  new Map(
                    program.incentiveTiers.map(
                      (tier) => [
                        [
                          tier.fromMonth,
                          tier.toMonth,
                          tier.incentiveType,
                          tier.markUp,
                        ].join("|"),
                        tier,
                      ],
                    ),
                  ).values(),
                );

              return (
                <div
                  key={program.id}
                  className="rounded-xl border p-5"
                >
                  <div className="flex flex-col gap-5">
                    {/* HEADER */}
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">
                            {
                              program.name
                            }
                          </p>

                          <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                            {
                              program.id
                            }
                          </span>

                          <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                            Code:{" "}
                            {
                              program.code
                            }
                          </span>

                          <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                            {
                              program.status
                            }
                          </span>
                        </div>

                        <p className="text-sm text-muted-foreground">
                          Base Pay:{" "}
                          {formatPeso(
                            program.basePay,
                          )}
                        </p>

                      </div>

                      <div className="flex shrink-0 gap-2">
                        {canManage && <Button
                          type="button"
                          variant="outline"
                          aria-expanded={
                            expandedPrograms[program.id] ?? false
                          }
                          onClick={() =>
                            toggleProgram(program.id)
                          }
                        >
                          {expandedPrograms[program.id] ? (
                            <ChevronUp className="mr-2 size-4" />
                          ) : (
                            <ChevronDown className="mr-2 size-4" />
                          )}
                          {expandedPrograms[program.id]
                            ? "Collapse"
                            : "Expand"}
                        </Button>}

                        {canManage && <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            editProgram(
                              program,
                            )
                          }
                        >
                          <Pencil className="mr-2 size-4" />
                          Edit
                        </Button>}

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            deleteProgram(
                              program,
                            )
                          }
                        >
                          <Trash2 className="mr-2 size-4" />
                          Delete
                        </Button>
                      </div>
                    </div>

                    {expandedPrograms[program.id] && (
                      <>
                        {program.description && (
                          <p className="text-sm">
                            {program.description}
                          </p>
                        )}

                        {/* INCENTIVE SUMMARY */}
                        {periods.length >
                        0 ? (
                          <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">
                            Incentive Schedule
                          </p>

                          <span className="text-xs text-muted-foreground">
                            {
                              periods.length
                            }{" "}
                            period
                            {periods.length !==
                            1
                              ? "s"
                              : ""}
                          </span>
                        </div>

                        {periods.map(
                          (
                            baseTier,
                            index,
                          ) => {
                            const masTier =
                              program.incentiveTiers.find(
                                (
                                  tier,
                                ) =>
                                  tier.role ===
                                    "MAS" &&
                                  tier.fromMonth ===
                                    baseTier.fromMonth &&
                                  tier.toMonth ===
                                    baseTier.toMonth &&
                                  tier.incentiveType ===
                                    baseTier.incentiveType &&
                                  tier.markUp ===
                                    baseTier.markUp,
                              );

                            const collectorTier =
                              program.incentiveTiers.find(
                                (
                                  tier,
                                ) =>
                                  tier.role ===
                                    "Collector" &&
                                  tier.fromMonth ===
                                    baseTier.fromMonth &&
                                  tier.toMonth ===
                                    baseTier.toMonth &&
                                  tier.incentiveType ===
                                    baseTier.incentiveType &&
                                  tier.markUp ===
                                    baseTier.markUp,
                              );

                            const masAmount =
                              masTier?.incentiveAmount ??
                              0;

                            const collectorAmount =
                              collectorTier?.incentiveAmount ??
                              0;

                            const totalIncentive =
                              masAmount +
                              collectorAmount;

                            const incentive =
                              calculateIncentive(
                                program.basePay,
                                baseTier.markUp,
                                baseTier.incentiveType,
                                totalIncentive,
                              );

                            const totalRemittance =
                              calculateTotalRemittance(
                                program.basePay,
                                baseTier.markUp,
                                baseTier.incentiveType,
                                totalIncentive,
                              );

                            return (
                              <div
                                key={`${program.id}-${index}`}
                                className="rounded-lg border bg-muted/20 p-4"
                              >
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                  <div>
                                    <p className="font-semibold">
                                      {formatMonthRange(
                                        baseTier.fromMonth,
                                        baseTier.toMonth,
                                      )}
                                    </p>

                                    <p className="text-xs text-muted-foreground">
                                      {
                                        baseTier.incentiveType ===
                                        "percentage"
                                          ? "Percentage incentive"
                                          : "Fixed incentive"
                                      }{" "}
                                      • Mark Up{" "}
                                      {formatPeso(
                                        baseTier.markUp,
                                      )}
                                    </p>
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    <span className="rounded-md bg-background px-3 py-1.5 text-xs font-medium">
                                      Total:{" "}
                                      {formatIncentive(
                                        totalIncentive,
                                        baseTier.incentiveType,
                                      )}
                                    </span>

                                    <span className="rounded-md bg-background px-3 py-1.5 text-xs font-medium">
                                      MAS:{" "}
                                      {formatIncentive(
                                        masAmount,
                                        baseTier.incentiveType,
                                      )}
                                    </span>

                                    <span className="rounded-md bg-background px-3 py-1.5 text-xs font-medium">
                                      Collector:{" "}
                                      {formatIncentive(
                                        collectorAmount,
                                        baseTier.incentiveType,
                                      )}
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                  <div>
                                    <p className="text-xs text-muted-foreground">
                                      Incentive Base
                                    </p>

                                    <p className="text-sm font-semibold">
                                      {formatPeso(
                                        Math.max(
                                          program.basePay -
                                            baseTier.markUp,
                                          0,
                                        ),
                                      )}
                                    </p>
                                  </div>

                                  <div>
                                    <p className="text-xs text-muted-foreground">
                                      Calculated Incentive
                                    </p>

                                    <p className="text-sm font-semibold">
                                      {formatPeso(
                                        incentive,
                                      )}
                                    </p>
                                  </div>

                                  <div>
                                    <p className="text-xs text-muted-foreground">
                                      Total Remittance
                                    </p>

                                    <p className="text-sm font-bold">
                                      {formatPeso(
                                        totalRemittance,
                                      )}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          },
                        )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No incentive configured.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            },
          )}
        </div>
      )}
    </CardContent>
  </Card>
</div>

);
}
