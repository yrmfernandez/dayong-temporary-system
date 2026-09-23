"use client";

import { useEffect, useState } from "react";
import {
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

type IncentiveType =
  | "percentage"
  | "fixed";

type IncentiveRole =
  | "MAS"
  | "Collector";

type PeriodUnit =
  | "month"
  | "year";

type IncentiveTier = {
  id?: string;
  programId?: string;
  role: IncentiveRole;
  fromMonth: number;
  toMonth: number;
  incentiveType: IncentiveType;
  incentiveAmount: number;
};

type IncentiveTierForm = {
  role: IncentiveRole;

  fromValue: string;
  fromUnit: PeriodUnit;

  toValue: string;
  toUnit: PeriodUnit;

  incentiveType: IncentiveType;
  incentiveAmount: string;
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

function createEmptyTier(
  role: IncentiveRole,
): IncentiveTierForm {
  return {
    role,

    fromValue: "1",
    fromUnit: "month",

    toValue: "6",
    toUnit: "month",

    incentiveType: "percentage",
    incentiveAmount: "0",
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
      createEmptyTier("MAS"),
      createEmptyTier("Collector"),
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
    return `₱${numericAmount.toLocaleString(
      "en-PH",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    )}`;
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

export default function ProgramsPage() {
  const [programs, setPrograms] = useState<
    Program[]
  >([]);

  const [form, setForm] =
    useState<ProgramForm>(
      createEmptyForm(),
    );

  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  async function loadPrograms() {
    try {
      setLoading(true);

      const response = await fetch(
        "/api/programs",
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const data = await response.json();

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

      setPrograms(
        loadedPrograms.map(
          (program: Program) => ({
            ...program,

            incentiveTiers:
              Array.isArray(
                program.incentiveTiers,
              )
                ? program.incentiveTiers
                : [],
          }),
        ),
      );
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : "Failed to load programs.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPrograms();
  }, []);

  function resetForm() {
    setForm(createEmptyForm());
    setEditingId(null);
  }

  function updateForm(
    field: keyof ProgramForm,
    value:
      | string
      | IncentiveTierForm[],
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

  function addTier(
    role: IncentiveRole,
  ) {
    setForm((current) => ({
      ...current,

      incentiveTiers: [
        ...current.incentiveTiers,
        createEmptyTier(role),
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

  function getRoleTiers(
    role: IncentiveRole,
  ) {
    return form.incentiveTiers
      .map((tier, index) => ({
        tier,
        index,
      }))
      .filter(
        ({ tier }) =>
          tier.role === role,
      );
  }

  function validateTiers() {
    if (
      form.incentiveTiers.length === 0
    ) {
      alert(
        "Please add at least one incentive tier.",
      );

      return false;
    }

    for (
      let index = 0;
      index <
      form.incentiveTiers.length;
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

      const amount =
        Number(tier.incentiveAmount);

      if (
        !tier.fromValue.trim() ||
        !Number.isFinite(fromMonth) ||
        fromMonth < 1
      ) {
        alert(
          `${tier.role} Tier ${
            index + 1
          }: From period must be 1 or greater.`,
        );

        return false;
      }

      if (
        !tier.toValue.trim() ||
        !Number.isFinite(toMonth) ||
        toMonth < fromMonth
      ) {
        alert(
          `${tier.role} Tier ${
            index + 1
          }: To period must be greater than or equal to From period.`,
        );

        return false;
      }

      if (
        !Number.isInteger(fromMonth) ||
        !Number.isInteger(toMonth)
      ) {
        alert(
          `${tier.role} Tier ${
            index + 1
          }: Month values must be whole numbers.`,
        );

        return false;
      }

      if (
        !tier.incentiveAmount.trim() ||
        !Number.isFinite(amount) ||
        amount < 0
      ) {
        alert(
          `${tier.role} Tier ${
            index + 1
          }: Incentive must be 0 or greater.`,
        );

        return false;
      }

      if (
        tier.incentiveType ===
          "percentage" &&
        amount > 100
      ) {
        alert(
          `${tier.role} Tier ${
            index + 1
          }: Percentage incentive cannot be greater than 100%.`,
        );

        return false;
      }
    }

    /*
     * Check overlapping month ranges
     * within the same role.
     */
    const roles: IncentiveRole[] = [
      "MAS",
      "Collector",
    ];

    for (const role of roles) {
      const tiers = form.incentiveTiers
        .filter(
          (tier) =>
            tier.role === role,
        )
        .map((tier) => ({
          from: periodToMonths(
            tier.fromValue,
            tier.fromUnit,
          ),
          to: periodToMonths(
            tier.toValue,
            tier.toUnit,
          ),
        }))
        .sort(
          (a, b) =>
            a.from - b.from,
        );

      for (
        let index = 1;
        index < tiers.length;
        index++
      ) {
        const previous =
          tiers[index - 1];

        const current =
          tiers[index];

        if (
          current.from <=
          previous.to
        ) {
          alert(
            `${role} incentive tiers have overlapping periods. Please adjust the ranges.`,
          );

          return false;
        }
      }
    }

    return true;
  }

  async function saveProgram() {
    if (!form.code.trim()) {
      alert("Please enter a program code.");
      return;
    }

    if (!form.name.trim()) {
      alert("Please enter a program name.");
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
       * Convert all Month/Year inputs
       * into months before sending them
       * to the API.
       *
       * Example:
       * 1 Year = 12 months
       * 2 Years = 24 months
       */
      const incentiveTiers =
        form.incentiveTiers.map(
          (tier) => ({
            role: tier.role,

            fromMonth:
              periodToMonths(
                tier.fromValue,
                tier.fromUnit,
              ),

            toMonth:
              periodToMonths(
                tier.toValue,
                tier.toUnit,
              ),

            incentiveType:
              tier.incentiveType,

            incentiveAmount:
              Number(
                tier.incentiveAmount,
              ),
          }),
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

          body: JSON.stringify(payload),
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

    const existingTiers =
      Array.isArray(
        program.incentiveTiers,
      )
        ? program.incentiveTiers
        : [];

    /*
     * Existing data is stored in months,
     * so when editing we initially show
     * the values as months.
     *
     * The encoder can switch them to
     * years if preferred.
     */
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
        existingTiers.length > 0
          ? existingTiers.map(
              (tier) => ({
                role: tier.role,

                fromValue: String(
                  tier.fromMonth ?? 1,
                ),
                fromUnit: "month",

                toValue: String(
                  tier.toMonth ??
                    999999,
                ),
                toUnit: "month",

                incentiveType:
                  tier.incentiveType ??
                  "percentage",

                incentiveAmount:
                  String(
                    tier.incentiveAmount ??
                      0,
                  ),
              }),
            )
          : [
              createEmptyTier("MAS"),
              createEmptyTier(
                "Collector",
              ),
            ],
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
    return (
      <div
        key={index}
        className="rounded-lg border p-4"
      >
        {/* TIER HEADER */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">
              {tier.role} Tier
            </p>

            <p className="text-xs text-muted-foreground">
              Configure the incentive and
              payment period.
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() =>
              removeTier(index)
            }
            aria-label={`Remove ${tier.role} tier`}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          {/* TYPE FIRST */}
          <div className="space-y-2">
            <Label>
              Type
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

          {/* AMOUNT SECOND */}
          <div className="space-y-2">
            <Label>
              Incentive
            </Label>

            <Input
              type="number"
              min="0"
              step="0.01"
              value={
                tier.incentiveAmount
              }
              onChange={(event) =>
                updateTier(
                  index,
                  "incentiveAmount",
                  event.target.value,
                )
              }
              onWheel={(event) => {
                event.currentTarget.blur();
              }}
              placeholder={
                tier.incentiveType ===
                "percentage"
                  ? "50"
                  : "500"
              }
            />

            <p className="text-xs text-muted-foreground">
              {tier.incentiveType ===
              "percentage"
                ? "Enter percentage."
                : "Enter peso amount."}
            </p>
          </div>

          {/* FROM */}
          <div className="space-y-2">
            <Label>
              From
            </Label>

            <div className="grid grid-cols-2 gap-2">
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

            <div className="grid grid-cols-2 gap-2">
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

        {/* SUMMARY */}
        <div className="mt-4 rounded-md bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {formatMonthRange(
              periodToMonths(
                tier.fromValue,
                tier.fromUnit,
              ) || 1,
              periodToMonths(
                tier.toValue,
                tier.toUnit,
              ) || 1,
            )}{" "}
            •{" "}
            {formatIncentive(
              tier.incentiveAmount,
              tier.incentiveType,
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* PAGE HEADER */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Programs
        </h1>

        <p className="text-sm text-muted-foreground">
          Manage Dayong programs, base pay,
          and role-based incentive tiers.
        </p>
      </div>

      {/* PROGRAM FORM */}
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
              {/* BASE PAY */}
              <div className="space-y-2">
                <Label>
                  Base Pay *
                </Label>

                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.basePay}
                  onChange={(event) =>
                    updateForm(
                      "basePay",
                      event.target.value,
                    )
                  }
                  onWheel={(event) => {
                    event.currentTarget.blur();
                  }}
                  placeholder="290"
                />

                <p className="text-xs text-muted-foreground">
                  Used for TMD and Balance
                  calculations.
                </p>
              </div>

              {/* STATUS */}
              <div className="space-y-2">
                <Label>
                  Status
                </Label>

                <Select
                  value={form.status}
                  onValueChange={(value) =>
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
            <div className="mb-4">
              <h3 className="text-sm font-semibold">
                Incentive Tiers
              </h3>

              <p className="mt-1 text-xs text-muted-foreground">
                Configure incentives according
                to how long the member has been
                paying the program.
              </p>
            </div>

            {/* SIDE-BY-SIDE MAS / COLLECTOR */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* MAS */}
              <div className="rounded-xl border p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">
                      MAS Incentive
                    </h4>

                    <p className="text-xs text-muted-foreground">
                      Marketing Account Staff
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      addTier("MAS")
                    }
                  >
                    <Plus className="mr-2 size-4" />
                    Add Tier
                  </Button>
                </div>

                <div className="space-y-3">
                  {getRoleTiers("MAS")
                    .length === 0 ? (
                    <div className="rounded-lg border border-dashed p-5 text-center">
                      <p className="text-sm text-muted-foreground">
                        No MAS incentive tiers.
                      </p>
                    </div>
                  ) : (
                    getRoleTiers("MAS").map(
                      ({
                        tier,
                        index,
                      }) =>
                        renderIncentiveTier(
                          tier,
                          index,
                        ),
                    )
                  )}
                </div>
              </div>

              {/* COLLECTOR */}
              <div className="rounded-xl border p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">
                      Collector Incentive
                    </h4>

                    <p className="text-xs text-muted-foreground">
                      Collector
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      addTier(
                        "Collector",
                      )
                    }
                  >
                    <Plus className="mr-2 size-4" />
                    Add Tier
                  </Button>
                </div>

                <div className="space-y-3">
                  {getRoleTiers(
                    "Collector",
                  ).length === 0 ? (
                    <div className="rounded-lg border border-dashed p-5 text-center">
                      <p className="text-sm text-muted-foreground">
                        No Collector incentive
                        tiers.
                      </p>
                    </div>
                  ) : (
                    getRoleTiers(
                      "Collector",
                    ).map(
                      ({
                        tier,
                        index,
                      }) =>
                        renderIncentiveTier(
                          tier,
                          index,
                        ),
                    )
                  )}
                </div>
              </div>
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
                Add your first program above.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {programs.map(
                (program) => {
                  const masTiers =
                    program.incentiveTiers.filter(
                      (tier) =>
                        tier.role === "MAS",
                    );

                  const collectorTiers =
                    program.incentiveTiers.filter(
                      (tier) =>
                        tier.role ===
                        "Collector",
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
                                {program.name}
                              </p>

                              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                                {program.id}
                              </span>

                              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                                Code:{" "}
                                {program.code}
                              </span>

                              <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                                {
                                  program.status
                                }
                              </span>
                            </div>

                            <p className="text-sm text-muted-foreground">
                              Base Pay: ₱
                              {Number(
                                program.basePay ??
                                  0,
                              ).toLocaleString(
                                "en-PH",
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                },
                              )}
                            </p>

                            {program.description && (
                              <p className="text-sm">
                                {
                                  program.description
                                }
                              </p>
                            )}
                          </div>

                          <div className="flex shrink-0 gap-2">
                            <Button
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
                            </Button>

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

                        {/* INCENTIVE SUMMARY */}
                        <div className="grid gap-4 md:grid-cols-2">
                          {/* MAS */}
                          <div className="rounded-lg border bg-muted/20 p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <p className="font-semibold">
                                MAS Incentive
                              </p>

                              <span className="text-xs text-muted-foreground">
                                {
                                  masTiers.length
                                }{" "}
                                tier
                                {masTiers.length !==
                                1
                                  ? "s"
                                  : ""}
                              </span>
                            </div>

                            {masTiers.length ===
                            0 ? (
                              <p className="text-sm text-muted-foreground">
                                No incentive
                                configured.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {masTiers.map(
                                  (
                                    tier,
                                    index,
                                  ) => (
                                    <div
                                      key={
                                        tier.id ??
                                        `${program.id}-mas-${index}`
                                      }
                                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                                    >
                                      <div>
                                        <p className="text-sm font-medium">
                                          {formatMonthRange(
                                            tier.fromMonth,
                                            tier.toMonth,
                                          )}
                                        </p>

                                        <p className="text-xs text-muted-foreground">
                                          {
                                            tier.incentiveType ===
                                            "percentage"
                                              ? "Percentage"
                                              : "Fixed Amount"
                                          }
                                        </p>
                                      </div>

                                      <p className="font-semibold">
                                        {formatIncentive(
                                          tier.incentiveAmount,
                                          tier.incentiveType,
                                        )}
                                      </p>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                          </div>

                          {/* COLLECTOR */}
                          <div className="rounded-lg border bg-muted/20 p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <p className="font-semibold">
                                Collector Incentive
                              </p>

                              <span className="text-xs text-muted-foreground">
                                {
                                  collectorTiers.length
                                }{" "}
                                tier
                                {collectorTiers.length !==
                                1
                                  ? "s"
                                  : ""}
                              </span>
                            </div>

                            {collectorTiers.length ===
                            0 ? (
                              <p className="text-sm text-muted-foreground">
                                No incentive
                                configured.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {collectorTiers.map(
                                  (
                                    tier,
                                    index,
                                  ) => (
                                    <div
                                      key={
                                        tier.id ??
                                        `${program.id}-collector-${index}`
                                      }
                                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                                    >
                                      <div>
                                        <p className="text-sm font-medium">
                                          {formatMonthRange(
                                            tier.fromMonth,
                                            tier.toMonth,
                                          )}
                                        </p>

                                        <p className="text-xs text-muted-foreground">
                                          {
                                            tier.incentiveType ===
                                            "percentage"
                                              ? "Percentage"
                                              : "Fixed Amount"
                                          }
                                        </p>
                                      </div>

                                      <p className="font-semibold">
                                        {formatIncentive(
                                          tier.incentiveAmount,
                                          tier.incentiveType,
                                        )}
                                      </p>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                          </div>
                        </div>
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