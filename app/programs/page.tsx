"use client";

import { useEffect, useState } from "react";
import {
ChevronDown,
ChevronUp,
Pencil,
Plus,
Search,
Trash2,
X,
} from "lucide-react";

import { InlinePanel } from "@/components/inline-panel";
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
import { describeAgeRestriction } from "@/lib/program-age";
import { normalizeMonthlyMaximum } from "@/lib/program-payment-limit.mjs";
import { ProgramBulkEdit } from "./program-bulk-edit";
import { ProgramCategoriesManager, type ProgramCategory } from "./program-categories";
import { useLiveRefresh } from "@/lib/use-live-refresh";

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
/** Blank = base rates for every branch; otherwise rates for that branch only. */
branchId?: string;
};

type IncentiveTierForm = {
branchId: string;
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
registrationFeeRequired: boolean;
registrationAmount: number;
payBalanceTotal: number;
saleIncentiveType?: "" | "fixed" | "percentage";
saleIncentiveAmount?: number;
ageRestricted: boolean;
minAge: number | null;
maxAge: number | null;
incentiveTiers: IncentiveTier[];
categoryId?: string;
newSaleAmountEditable?: boolean;
collectionAmountEditable?: boolean;
flexible?: boolean;
maxMonthlyPayment?: number | null;
};

type ProgramForm = {
categoryId: string;
/** Flexible payments: Base Pay is the minimum monthly payment; amounts follow what is paid. */
flexible: boolean;
hasMonthlyMaximum: boolean;
maxMonthlyPayment: string;
newSaleAmountEditable: boolean;
collectionAmountEditable: boolean;
code: string;
name: string;
basePay: string;
description: string;
registrationFeeRequired: boolean;
registrationAmount: string;
payBalanceTotal: string;
saleIncentiveType: "" | "fixed" | "percentage";
saleIncentiveAmount: string;
ageRestricted: boolean;
minAge: string;
maxAge: string;
status: "active" | "inactive";
incentiveTiers: IncentiveTierForm[];
};

function createEmptyTier(): IncentiveTierForm {
return {
branchId: "",
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
categoryId: "",
flexible: false,
hasMonthlyMaximum: false,
maxMonthlyPayment: "",
newSaleAmountEditable: false,
collectionAmountEditable: false,
code: "",
name: "",
basePay: "",
description: "",
registrationFeeRequired: false,
registrationAmount: "0",
payBalanceTotal: "0",
saleIncentiveType: "",
saleIncentiveAmount: "0",
ageRestricted: false,
minAge: "",
maxAge: "",
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
const numericAmount = typeof amount === "number" ? amount : Number(amount ?? 0);
return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number.isFinite(numericAmount) ? numericAmount : 0);
}

function formatIncentive(
amount: number | string | undefined,
type: IncentiveType | undefined,
) {
const numericAmount = typeof amount === "number" ? amount : Number(amount ?? 0);
if (!Number.isFinite(numericAmount)) return type === "fixed" ? formatPeso(0) : "0%";
return type === "fixed" ? formatPeso(numericAmount) : `${numericAmount}%`;
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

return `Months ${fromMonth}-${toMonth}`;
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

// Remittance = ((base pay - mark-up) - incentive) + mark-up, for whoever collected (MAS or Collector).
function calculateRemittanceFor(
basePay: number,
markUp: number,
incentiveType: IncentiveType,
roleIncentive: number,
) {
const incentive =
calculateIncentive(
basePay,
markUp,
incentiveType,
roleIncentive,
);

return Math.max(0, basePay - markUp - incentive) + markUp;
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
// Branches for branch-specific incentive rates, and the editable program categories.
const [branchOptions, setBranchOptions] = useState<Array<{ id: string; name: string; territory: string; status: string }>>([]);
const [categories, setCategories] = useState<ProgramCategory[]>([]);
const branchName = (id: string) => { const found = branchOptions.find((item) => item.id === id); return found ? `${found.name}${found.territory ? ` · ${found.territory}` : ""}` : id; };
const categoryName = (id: string) => categories.find((item) => item.id === id)?.name ?? id;
async function loadReference() {
  try {
    const [branchResponse, categoryResponse] = await Promise.all([fetch("/api/branches", { cache: "no-store" }), fetch("/api/program-categories", { cache: "no-store" })]);
    const branchData = await branchResponse.json(), categoryData = await categoryResponse.json();
    if (Array.isArray(branchData.branches)) setBranchOptions(branchData.branches);
    if (Array.isArray(categoryData.categories)) setCategories(categoryData.categories);
  } catch { /* the form still works with base rates and no category */ }
}
// Copies the base (all-branch) periods to a branch so its own rates can be edited from there.
function copyBaseRatesToBranch(branchId: string) {
  if (!branchId) return;
  setForm((current) => {
    if (current.incentiveTiers.some((tier) => tier.branchId === branchId)) { alert(`${branchName(branchId)} already has its own periods.`); return current; }
    const base = current.incentiveTiers.filter((tier) => !tier.branchId);
    return { ...current, incentiveTiers: [...current.incentiveTiers, ...(base.length ? base : [createEmptyTier()]).map((tier) => ({ ...tier, branchId }))] };
  });
}

const [expandedProgramId, setExpandedProgramId] = useState<string | null>(null);
// Programs ticked for Edit selected (program-bulk-edit.tsx).
const [selectedIds, setSelectedIds] = useState<string[]>([]);
// Search box: matches code, name, ID, category, status and description, ignoring case.
const [search, setSearch] = useState("");
const searchWords = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
const visiblePrograms = searchWords.length ? programs.filter((program) => { const haystack = [program.code, program.name, program.id, program.status, program.description, program.categoryId ? categoryName(program.categoryId) : "", program.flexible ? "flexible" : ""].join(" ").toLowerCase(); return searchWords.every((word) => haystack.includes(word)); }) : programs;
const toggleSelected = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

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
void loadReference();
}, []);
// Live updates: reload when another user saves (lib/use-live-refresh.ts). Not while a program form is open.
useLiveRefresh(["programs", "program_incentives"], () => { if (!showForm && !editingId) void loadPrograms(); });
useLiveRefresh(["program_categories", "branches"], loadReference);

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
setExpandedProgramId((current) => current === programId ? null : programId);
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
  branch: string;
  from: number;
  to: number;
}[] = [];

if (!form.incentiveTiers.some((tier) => !tier.branchId)) {
  alert("Add at least one period for All branches (base rates). Branch periods only replace the base rates in that branch.");
  return false;
}

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
    branch: tier.branchId,
    from: fromMonth,
    to: toMonth,
  });
}

normalizedPeriods.sort(
  (a, b) => a.branch.localeCompare(b.branch) || a.from - b.from,
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
    current.branch === previous.branch &&
    current.from <=
    previous.to
  ) {
    alert(
      "Incentive periods for the same branch cannot overlap. Please adjust the ranges.",
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
    form.flexible ? "Minimum monthly payment must be greater than 0." : "Base Pay must be greater than 0.",
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
   * Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ MAS
   * Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ Collector
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

  let maxMonthlyPayment: number | null = null;
  try {
    if (form.flexible && form.hasMonthlyMaximum) {
      if (!form.maxMonthlyPayment.trim()) throw new Error("Enter the maximum monthly payment.");
      maxMonthlyPayment = normalizeMonthlyMaximum({ flexible: true, basePay, maxMonthlyPayment: form.maxMonthlyPayment });
    }
  } catch (error) {
    alert(error instanceof Error ? error.message : "Enter a valid maximum monthly payment.");
    return;
  }

  const payload = {
    code: form.code.trim(),

    name: form.name.trim(),

    basePay,

    // Each form period becomes a MAS and a Collector tier, both for the period\'s branch.

    incentiveTiers: incentiveTiers.map((item, position) => ({ ...item, branchId: form.incentiveTiers[Math.floor(position / 2)]?.branchId ?? "" })),

    categoryId: form.categoryId,

    description:
      form.description.trim(),

    registrationFeeRequired: form.registrationFeeRequired,
    newSaleAmountEditable: form.newSaleAmountEditable,
    collectionAmountEditable: form.collectionAmountEditable,
    flexible: form.flexible,
    maxMonthlyPayment,
    registrationAmount: Number(form.registrationAmount) || 0,
    payBalanceTotal: Number(form.payBalanceTotal) || 0,
    saleIncentiveType: form.registrationFeeRequired ? form.saleIncentiveType : "",
    saleIncentiveAmount: Number(form.saleIncentiveAmount) || 0,
    ageRestricted: form.ageRestricted,
    minAge: form.ageRestricted ? form.minAge.trim() : "",
    maxAge: form.ageRestricted ? form.maxAge.trim() : "",

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

// Edit opens inside the program's card; clicking Edit again closes it.
function editProgram(
program: Program,
) {
if (editingId === program.id) {
  resetForm();
  return;
}
setEditingId(program.id);
setShowForm(false);

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
      tier.branchId ?? "",
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
      branchId: tier.branchId ?? "",
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
  categoryId: program.categoryId ?? "",
  code: program.code ?? "",

  name: program.name ?? "",

  basePay: String(
    program.basePay ?? 0,
  ),

  description:
    program.description ?? "",

  registrationFeeRequired: Boolean(program.registrationFeeRequired),
  flexible: Boolean(program.flexible),
  hasMonthlyMaximum: program.maxMonthlyPayment != null,
  maxMonthlyPayment: program.maxMonthlyPayment == null ? "" : String(program.maxMonthlyPayment),
  newSaleAmountEditable: Boolean(program.newSaleAmountEditable),
  collectionAmountEditable: Boolean(program.collectionAmountEditable),
  registrationAmount: String(program.registrationAmount ?? 0),
  payBalanceTotal: String(program.payBalanceTotal ?? 0),
  saleIncentiveType: program.saleIncentiveType ?? "",
  saleIncentiveAmount: String(program.saleIncentiveAmount ?? 0),
  ageRestricted: Boolean(program.ageRestricted),
  minAge: program.minAge === null || program.minAge === undefined ? "" : String(program.minAge),
  maxAge: program.maxAge === null || program.maxAge === undefined ? "" : String(program.maxAge),

  status:
    program.status === "inactive"
      ? "inactive"
      : "active",

  incentiveTiers:
    combinedTiers.length > 0
      ? combinedTiers
      : [createEmptyTier()],
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

const masRemittance = calculateRemittanceFor(basePay, markUp, tier.incentiveType, masIncentive);
const collectorRemittance = calculateRemittanceFor(basePay, markUp, tier.incentiveType, collectorIncentive);

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

    {/* BRANCH */}
    <div className="mb-4 space-y-2">
      <Label>Branch</Label>
      <Select value={tier.branchId || "all"} onValueChange={(value) => updateTier(index, "branchId", !value || value === "all" ? "" : value)}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All branches (base rates)</SelectItem>
          {branchOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.territory ? ` · ${item.territory}` : ""}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Base rates apply in every branch. A branch with its own periods uses only those for that role, so give it every period it needs.</p>
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
                : "pl-12"
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
              PHP
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
            PHP
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
            className="pl-12"
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
                  : "pl-12"
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
                PHP
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
                  : "pl-12"
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
                PHP
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
            Remittance if MAS collects</p><p className="text-sm font-bold">{formatPeso(masRemittance)}</p><p className="mt-1 text-xs text-muted-foreground">If Collector collects</p><p className="text-sm font-bold">{formatPeso(collectorRemittance)}</p>
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

const programForm = (
  <div className="space-y-6">
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
            <Label htmlFor="program-base-pay">
              Base Pay{form.flexible ? "" : " *"}
            </Label>

            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                PHP
              </span>

              <Input
                id="program-base-pay"
                type="number"
                min="0"
                step="0.01"
                disabled={form.flexible}
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
                className="pl-12"
                placeholder="350"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {form.flexible
                ? "Flexible payments are on: Base Pay is the minimum monthly payment, set under Flexible payments below."
                : "Used for TMD, Balance, and incentive calculations."}
            </p>
          </div>

          <div className="space-y-2">

            <Label>Category</Label>

            <Select value={form.categoryId || "none"} onValueChange={(value) => setForm((current) => ({ ...current, categoryId: !value || value === "none" ? "" : value }))}>

              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>

              <SelectContent>

                <SelectItem value="none">No category</SelectItem>

                {categories.filter((item) => item.status === "active" || item.id === form.categoryId).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.status === "inactive" ? " (inactive)" : ""}</SelectItem>)}

              </SelectContent>

            </Select>

            <p className="text-xs text-muted-foreground">Categories are edited under Program Categories on this page.</p>

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

      <div className="rounded-xl border bg-muted/20 p-4">
        <h3 className="text-sm font-semibold">Enrollment and payoff rules</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.registrationFeeRequired} onChange={(event) => setForm((current) => ({ ...current, registrationFeeRequired: event.target.checked, registrationAmount: event.target.checked ? current.registrationAmount : "0" }))} />
            Registration fee required
          </label>
          <div className="space-y-2"><Label>Registration amount</Label><Input type="number" min="0" step="0.01" disabled={!form.registrationFeeRequired} value={form.registrationAmount} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateForm("registrationAmount", event.target.value)} /></div>
          <div className="space-y-2"><Label>Total amount payable</Label><Input type="number" min="0" step="0.01" value={form.payBalanceTotal} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateForm("payBalanceTotal", event.target.value)} /><p className="text-xs text-muted-foreground">The full amount a member pays to complete the program. Set to 0 when there is no fixed total.</p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Flexible payments</p>
            <p className="text-xs text-muted-foreground">On: members pay at least the minimum each month, with an optional monthly maximum. Base Pay becomes the minimum monthly payment, and incentives and remittances follow the amount actually paid. The total amount payable still applies when set. Off: every month is exactly the base pay.</p>
          </div>
          <button type="button" role="switch" aria-checked={form.flexible} aria-label="Flexible payments" onClick={() => setForm((current) => ({ ...current, flexible: !current.flexible }))}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${form.flexible ? "bg-primary" : "bg-muted-foreground/30"}`}>
            <span aria-hidden="true" className={`absolute left-0 top-1 size-4 rounded-full bg-white shadow-sm transition-transform ${form.flexible ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
        {form.flexible && <div className="mt-4 grid gap-4 rounded-lg border p-3 md:grid-cols-3">
          {/* The minimum is the program's Base Pay; it is entered here, beside the maximum, while payments are flexible. */}
          <div className="space-y-2">
            <Label htmlFor="program-min-monthly-payment">Minimum monthly payment *</Label>
            <Input id="program-min-monthly-payment" type="number" min="0.01" step="0.01" required value={form.basePay} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateForm("basePay", event.target.value)} placeholder="150" />
            <p className="text-xs text-muted-foreground">The least a member pays for one month. Saved as the program&apos;s Base Pay.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="program-monthly-maximum">Maximum monthly payment?</Label>
            <select id="program-monthly-maximum" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.hasMonthlyMaximum ? "yes" : "no"} onChange={(event) => setForm((current) => ({ ...current, hasMonthlyMaximum: event.target.value === "yes" }))}>
              <option value="no">No maximum</option>
              <option value="yes">Yes, set a maximum</option>
            </select>
            <p className="text-xs text-muted-foreground">This limits each covered month, separately from the total amount payable.</p>
          </div>
          {form.hasMonthlyMaximum && <div className="space-y-2">
            <Label htmlFor="program-max-monthly-payment">Maximum monthly payment *</Label>
            <Input id="program-max-monthly-payment" type="number" min={form.basePay || "0.01"} step="0.01" required value={form.maxMonthlyPayment} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateForm("maxMonthlyPayment", event.target.value)} />
            <p className="text-xs text-muted-foreground">Must be at least the minimum monthly payment. A receipt covering two months may pay up to twice this amount.</p>
          </div>}
        </div>}
        <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="new-sale-amount-editable">New Sales: amount paid can be edited</Label>
            <select id="new-sale-amount-editable" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.newSaleAmountEditable ? "true" : "false"} onChange={(event) => setForm((current) => ({ ...current, newSaleAmountEditable: event.target.value === "true" }))}>
              <option value="false">False (locked)</option>
              <option value="true">True (editable)</option>
            </select>
            <p className="text-xs text-muted-foreground">False fixes the amount to the registration amount, or one month&apos;s base pay when there is no registration fee.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="collection-amount-editable">Collections: amount collected can be edited</Label>
            <select id="collection-amount-editable" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.collectionAmountEditable ? "true" : "false"} onChange={(event) => setForm((current) => ({ ...current, collectionAmountEditable: event.target.value === "true" }))}>
              <option value="false">False (locked)</option>
              <option value="true">True (editable)</option>
            </select>
            <p className="text-xs text-muted-foreground">False fixes the amount to covered months × base pay; the exact remaining payoff is offered as a button.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-3">
          <div className="md:col-span-3"><h4 className="text-sm font-semibold">New Sale MAS incentive</h4><p className="text-xs text-muted-foreground">{form.registrationFeeRequired ? "What the MAS keeps from the registration paid on a new sale. MAS Fidelity on a New Sales batch comes out of this." : "Without a registration fee, a new sale pays the first month, so the month-1 MAS incentive tier below applies to the base pay."}</p></div>
          {form.registrationFeeRequired && <>
            <div className="space-y-2"><Label>Incentive type</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.saleIncentiveType} onChange={(event) => setForm((current) => ({ ...current, saleIncentiveType: event.target.value as ProgramForm["saleIncentiveType"] }))}><option value="">No New Sale incentive</option><option value="fixed">Fixed amount (₱)</option><option value="percentage">Percentage of amount paid</option></select></div>
            <div className="space-y-2"><Label>{form.saleIncentiveType === "percentage" ? "Incentive (%)" : "Incentive (₱)"}</Label><Input type="number" min="0" max={form.saleIncentiveType === "percentage" ? 100 : undefined} step="0.01" disabled={!form.saleIncentiveType} value={form.saleIncentiveAmount} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateForm("saleIncentiveAmount", event.target.value)} /></div>
            <p className="self-end text-xs text-muted-foreground">{form.saleIncentiveType === "percentage" ? `On ₱${Number(form.registrationAmount || 0).toLocaleString("en-PH")}: MAS keeps ₱${((Number(form.registrationAmount) || 0) * (Number(form.saleIncentiveAmount) || 0) / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}.` : form.saleIncentiveType === "fixed" ? `MAS keeps ₱${Number(form.saleIncentiveAmount || 0).toLocaleString("en-PH")} per new sale.` : "The full registration is remitted."}</p>
          </>}
        </div>
        <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Age restriction</Label>
            <div role="radiogroup" aria-label="Age restriction" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/50 p-1">
              {([false, true] as const).map((value) => (
                <button key={String(value)} type="button" role="radio" aria-checked={form.ageRestricted === value}
                  onClick={() => setForm((current) => ({ ...current, ageRestricted: value, minAge: value ? current.minAge : "", maxAge: value ? current.maxAge : "" }))}
                  className={`rounded-md px-2 py-1.5 text-sm font-semibold transition-colors ${form.ageRestricted === value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {value ? "True" : "False"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">When true, New Sales only enrolls members whose age is within the range.</p>
          </div>
          {form.ageRestricted && <>
            <div className="space-y-2"><Label htmlFor="program-min-age">Minimum age *</Label><Input id="program-min-age" type="number" min="0" max="120" step="1" required value={form.minAge} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateForm("minAge", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="program-max-age">Maximum age</Label><Input id="program-max-age" type="number" min={form.minAge || "0"} max="120" step="1" placeholder="No maximum" value={form.maxAge} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateForm("maxAge", event.target.value)} /><p className="text-xs text-muted-foreground">Leave blank if there is no maximum age.</p></div>
          </>}
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
          <Select value="" onValueChange={(value) => copyBaseRatesToBranch(value ?? "")}>
            <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Add rates for a branch" /></SelectTrigger>
            <SelectContent>{branchOptions.filter((item) => item.status !== "inactive").map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.territory ? ` · ${item.territory}` : ""}</SelectItem>)}</SelectContent>
          </Select>
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
  </div>
);

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
  {showForm && !editingId && (
  <Card>
    <CardHeader>
      <CardTitle>
        Add Program
      </CardTitle>
    </CardHeader>

    <CardContent>
      {programForm}
    </CardContent>
  </Card>
  )}

  {canManage && <ProgramCategoriesManager categories={categories} onChanged={loadReference} />}

  {/* PROGRAM LIST */}
  <Card>
    <CardHeader>
      <CardTitle>
        Program List
      </CardTitle>
      {programs.length > 0 && <div className="relative mt-2 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" aria-label="Search programs" className="pl-9" placeholder="Search code, name, category or status" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>}
      {searchWords.length > 0 && <p className="text-xs text-muted-foreground">{visiblePrograms.length} of {programs.length} programs match &ldquo;{search.trim()}&rdquo;</p>}
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
          {canManage && <ProgramBulkEdit allIds={visiblePrograms.map((program) => program.id)} selected={selectedIds} onSelectedChange={setSelectedIds} categories={categories} onSaved={loadPrograms} />}
          {searchWords.length > 0 && !visiblePrograms.length && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No program matches &ldquo;{search.trim()}&rdquo;. <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSearch("")}>Clear search</button></div>}
          {visiblePrograms.map(
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
                          tier.branchId ?? "",
                        ].join("|"),
                        tier,
                      ],
                    ),
                  ).values(),
                ).sort((a, b) => Number(Boolean(a.branchId)) - Number(Boolean(b.branchId)) || (a.branchId ?? "").localeCompare(b.branchId ?? "") || a.fromMonth - b.fromMonth);

              return (
                <div
                  key={program.id}
                  className={`rounded-xl border p-5 ${selectedIds.includes(program.id) ? "border-primary/60 bg-primary/5" : ""}`}
                >
                  <div className="flex flex-col gap-5">
                    {/* HEADER */}
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {canManage && <input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={`Select ${program.name}`} checked={selectedIds.includes(program.id)} onChange={() => toggleSelected(program.id)} />}
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
                          {program.categoryId && <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{categoryName(program.categoryId)}</span>}
                        </div>

                        <p className="text-sm text-muted-foreground">
                          Base Pay:{" "}
                          {formatPeso(
                            program.basePay,
                          )}
                          {" · "}Total amount payable:{" "}
                          {program.payBalanceTotal > 0 ? formatPeso(program.payBalanceTotal) : "No fixed total"}
                          {program.flexible && <>{" · "}Monthly maximum: {program.maxMonthlyPayment == null ? "No maximum" : formatPeso(program.maxMonthlyPayment)}</>}
                        </p>

                      </div>

                      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          aria-expanded={
                            expandedProgramId === program.id
                          }
                          onClick={() =>
                            toggleProgram(program.id)
                          }
                        >
                          {expandedProgramId === program.id ? (
                            <ChevronUp className="mr-2 size-4" />
                          ) : (
                            <ChevronDown className="mr-2 size-4" />
                          )}
                          {expandedProgramId === program.id
                            ? "Collapse"
                            : "Expand"}
                        </Button>

                        {canManage && <Button
                          type="button"
                          variant={editingId === program.id ? "default" : "outline"}
                          aria-expanded={editingId === program.id}
                          onClick={() =>
                            editProgram(
                              program,
                            )
                          }
                        >
                          <Pencil className="mr-2 size-4" />
                          {editingId === program.id ? "Editing" : "Edit"}
                        </Button>}

                        {canManage && <Button
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
                        </Button>}
                      </div>
                    </div>

                    {editingId === program.id && (
                      <InlinePanel>
                        <p className="mb-3 text-sm font-semibold">Edit {program.code} - {program.name}</p>
                        {programForm}
                      </InlinePanel>
                    )}

                    {expandedProgramId === program.id && (
                      <>
                        {program.description && (
                          <p className="text-sm">
                            {program.description}
                          </p>
                        )}

                        <p className="text-sm">
                          <span className="text-muted-foreground">Age restriction: </span>
                          <strong>{describeAgeRestriction(program)}</strong>
                        </p>

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
                                    baseTier.markUp &&
                                    (tier.branchId ?? "") === (baseTier.branchId ?? ""),
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
                                    baseTier.markUp &&
                                    (tier.branchId ?? "") === (baseTier.branchId ?? ""),
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

                            const masRemittance = calculateRemittanceFor(program.basePay, baseTier.markUp, baseTier.incentiveType, masAmount);
const collectorRemittance = calculateRemittanceFor(program.basePay, baseTier.markUp, baseTier.incentiveType, collectorAmount);

                            return (
                              <div
                                key={`${program.id}-${index}`}
                                className="rounded-lg border bg-muted/20 p-4"
                              >
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{baseTier.branchId ? `Branch rates: ${branchName(baseTier.branchId)}` : "All branches (base rates)"}</p>
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
                                      Remittance if MAS collects</p><p className="text-sm font-bold">{formatPeso(masRemittance)}</p><p className="mt-1 text-xs text-muted-foreground">If Collector collects</p><p className="text-sm font-bold">{formatPeso(collectorRemittance)}</p>
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
