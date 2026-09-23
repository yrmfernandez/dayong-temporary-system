"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
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

import { programs as initialPrograms } from "@/lib/programs";
import type { Program } from "@/lib/types";

type CommissionRole = "MAS" | "Collector";

type CommissionType = "fixed" | "percentage";

type CommissionTier = {
  id: string;
  role: CommissionRole;
  fromMonth: number;
  toMonth: number;
  amount: number;
  commissionType: CommissionType;
};

type ManagedProgram = Program & {
  commissionTiers: CommissionTier[];
};

function createEmptyCommissionTier(
  role: CommissionRole = "MAS",
): CommissionTier {
  return {
    id: crypto.randomUUID(),
    role,
    fromMonth: 1,
    toMonth: 6,
    amount: 0,
    commissionType: "percentage",
  };
}

function createEmptyProgram(): ManagedProgram {
  return {
    id: crypto.randomUUID(),
    code: "",
    name: "",
    basePay: 0,

    /*
     * These old fields remain here because we are
     * intentionally not changing lib/types.ts yet.
     *
     * The actual commission setup is now handled
     * by commissionTiers below.
     */
    masCommission: 0,
    collectorCommission: 0,

    commissionType: "percentage",

    description: "",

    dateStarted: "",
    dateEnded: null,

    status: "active",

    commissionTiers: [
      createEmptyCommissionTier("MAS"),
      createEmptyCommissionTier("Collector"),
    ],
  };
}

function convertInitialPrograms(): ManagedProgram[] {
  return initialPrograms.map((program) => ({
    ...program,
    commissionTiers: [],
  }));
}

function formatCommission(tier: CommissionTier) {
  if (tier.commissionType === "percentage") {
    return `${tier.amount}%`;
  }

  return `₱${tier.amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
  })}`;
}

/**
 * Finds the first overlapping pair for one role.
 *
 * Gaps are allowed.
 *
 * Example:
 * 1–6 and 7–12 = valid
 * 1–6 and 8–12 = valid
 * 1–6 and 6–12 = invalid
 * 1–6 and 5–10 = invalid
 */
function findOverlappingTier(
  tiers: CommissionTier[],
): [CommissionTier, CommissionTier] | null {
  const sortedTiers = [...tiers].sort(
    (a, b) => a.fromMonth - b.fromMonth,
  );

  for (let index = 0; index < sortedTiers.length - 1; index++) {
    const current = sortedTiers[index];
    const next = sortedTiers[index + 1];

    if (current.toMonth >= next.fromMonth) {
      return [current, next];
    }
  }

  return null;
}

export default function ProgramsPage() {
  const [programs, setPrograms] = useState<
    ManagedProgram[]
  >(convertInitialPrograms());

  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [form, setForm] =
    useState<ManagedProgram>(
      createEmptyProgram(),
    );

  const [showMasCommission, setShowMasCommission] =
    useState(true);

  const [
    showCollectorCommission,
    setShowCollectorCommission,
  ] = useState(true);

  function resetForm() {
    setForm(createEmptyProgram());
    setEditingId(null);
    setShowMasCommission(true);
    setShowCollectorCommission(true);
  }

  function saveProgram() {
    if (!form.code.trim()) {
      alert("Please enter a program code.");
      return;
    }

    if (!form.name.trim()) {
      alert("Please enter a program name.");
      return;
    }

    if (form.basePay <= 0) {
      alert("Base pay must be greater than 0.");
      return;
    }

    for (const tier of form.commissionTiers) {
      if (tier.fromMonth <= 0) {
        alert(
          `${tier.role} Commission: From Month must be greater than 0.`,
        );
        return;
      }

      if (tier.toMonth < tier.fromMonth) {
        alert(
          `${tier.role} Commission: To Month cannot be less than From Month.`,
        );
        return;
      }

      if (tier.amount < 0) {
        alert(
          `${tier.role} Commission: Commission amount cannot be negative.`,
        );
        return;
      }

      if (
        tier.commissionType === "percentage" &&
        tier.amount > 100
      ) {
        alert(
          `${tier.role} Commission: Percentage commission cannot be greater than 100%.`,
        );
        return;
      }
    }

    const masTiers = form.commissionTiers.filter(
      (tier) => tier.role === "MAS",
    );

    const collectorTiers = form.commissionTiers.filter(
      (tier) => tier.role === "Collector",
    );

    const masOverlap =
      findOverlappingTier(masTiers);

    if (masOverlap) {
      const [first, second] = masOverlap;

      alert(
        `MAS Commission tiers overlap: Month ${first.fromMonth}–${first.toMonth} overlaps with Month ${second.fromMonth}–${second.toMonth}. Please adjust the month ranges.`,
      );

      setShowMasCommission(true);
      return;
    }

    const collectorOverlap =
      findOverlappingTier(
        collectorTiers,
      );

    if (collectorOverlap) {
      const [first, second] =
        collectorOverlap;

      alert(
        `Collector Commission tiers overlap: Month ${first.fromMonth}–${first.toMonth} overlaps with Month ${second.fromMonth}–${second.toMonth}. Please adjust the month ranges.`,
      );

      setShowCollectorCommission(true);
      return;
    }

    if (editingId) {
      setPrograms((current) =>
        current.map((program) =>
          program.id === editingId
            ? form
            : program,
        ),
      );
    } else {
      setPrograms((current) => [
        ...current,
        form,
      ]);
    }

    resetForm();
  }

  function editProgram(
    program: ManagedProgram,
  ) {
    setForm({
      ...program,

      commissionTiers: program.commissionTiers.map(
        (tier) => ({
          ...tier,
        }),
      ),
    });

    setEditingId(program.id);

    setShowMasCommission(true);
    setShowCollectorCommission(true);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function deleteProgram(id: string) {
    const confirmed = window.confirm(
      "Are you sure you want to delete this program?",
    );

    if (!confirmed) return;

    setPrograms((current) =>
      current.filter(
        (program) => program.id !== id,
      ),
    );

    if (editingId === id) {
      resetForm();
    }
  }

  function addCommissionTier(
    role: CommissionRole,
  ) {
    setForm((current) => ({
      ...current,

      commissionTiers: [
        ...current.commissionTiers,
        createEmptyCommissionTier(role),
      ],
    }));
  }

  function updateCommissionTier(
    id: string,
    updates: Partial<CommissionTier>,
  ) {
    setForm((current) => ({
      ...current,

      commissionTiers:
        current.commissionTiers.map(
          (tier) =>
            tier.id === id
              ? {
                  ...tier,
                  ...updates,
                }
              : tier,
        ),
    }));
  }

  function deleteCommissionTier(
    id: string,
  ) {
    setForm((current) => ({
      ...current,

      commissionTiers:
        current.commissionTiers.filter(
          (tier) => tier.id !== id,
        ),
    }));
  }

  function getTiersByRole(
    role: CommissionRole,
  ) {
    return form.commissionTiers.filter(
      (tier) => tier.role === role,
    );
  }

  function getProgramTiersByRole(
    program: ManagedProgram,
    role: CommissionRole,
  ) {
    return program.commissionTiers.filter(
      (tier) => tier.role === role,
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
          Manage Dayong programs, base pay, and
          flexible commission schedules.
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
          {/* BASIC PROGRAM INFORMATION */}
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
                    setForm((current) => ({
                      ...current,
                      code: event.target.value,
                    }))
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
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Example: Program 290"
                />
              </div>
            </div>
          </div>

          {/* BASE PAY / STATUS */}
          <div>
            <h3 className="mb-4 text-sm font-semibold">
              Program Settings
            </h3>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Base Pay *
                </Label>

                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.basePay || ""
                  }
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      basePay:
                        Number(
                          event.target.value,
                        ) || 0,
                    }))
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

              <div className="space-y-2">
                <Label>
                  Status
                </Label>

                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      status:
                        (value as
                          | "active"
                          | "inactive") ??
                        "active",
                    }))
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

          {/* COMMISSION INFORMATION */}
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-1">
              <h3 className="font-semibold">
                Commission Schedule
              </h3>

              <p className="text-sm text-muted-foreground">
                Commission is configured separately
                for MAS and Collector. Each role can
                have as many payment-duration tiers as
                needed. Gaps between tiers are allowed,
                but overlapping month ranges are not.
              </p>
            </div>
          </div>

          {/* MAS COMMISSION */}
          <div className="rounded-xl border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-muted/40"
              onClick={() =>
                setShowMasCommission(
                  (current) => !current,
                )
              }
            >
              <div>
                <p className="font-semibold">
                  MAS Commission
                </p>

                <p className="text-xs text-muted-foreground">
                  Commission paid to Marketing
                  Account Staff.
                </p>
              </div>

              {showMasCommission ? (
                <ChevronUp className="size-5" />
              ) : (
                <ChevronDown className="size-5" />
              )}
            </button>

            {showMasCommission && (
              <div className="space-y-4 border-t p-4">
                {getTiersByRole("MAS").length ===
                0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <p className="text-sm font-medium">
                      No MAS commission tiers
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Add a tier to configure MAS
                      commission.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {getTiersByRole("MAS").map(
                      (tier, index) => (
                        <div
                          key={tier.id}
                          className="rounded-lg border p-4"
                        >
                          <div className="mb-4 flex items-center justify-between">
                            <p className="text-sm font-semibold">
                              MAS Tier{" "}
                              {index + 1}
                            </p>

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                deleteCommissionTier(
                                  tier.id,
                                )
                              }
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>

                          <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                              <Label>
                                From Month *
                              </Label>

                              <Input
                                type="number"
                                min="1"
                                step="1"
                                value={
                                  tier.fromMonth
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateCommissionTier(
                                    tier.id,
                                    {
                                      fromMonth:
                                        Number(
                                          event
                                            .target
                                            .value,
                                        ) || 1,
                                    },
                                  )
                                }
                                onWheel={(event) => {
                                  event.currentTarget.blur();
                                }}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>
                                To Month *
                              </Label>

                              <Input
                                type="number"
                                min={
                                  tier.fromMonth
                                }
                                step="1"
                                value={
                                  tier.toMonth
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateCommissionTier(
                                    tier.id,
                                    {
                                      toMonth:
                                        Number(
                                          event
                                            .target
                                            .value,
                                        ) ||
                                        tier.fromMonth,
                                    },
                                  )
                                }
                                onWheel={(event) => {
                                  event.currentTarget.blur();
                                }}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>
                                Commission Type
                              </Label>

                              <Select
                                value={
                                  tier.commissionType
                                }
                                onValueChange={(
                                  value,
                                ) =>
                                  updateCommissionTier(
                                    tier.id,
                                    {
                                      commissionType:
                                        (value as CommissionType) ??
                                        "percentage",
                                    },
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
                          </div>

                          <div className="mt-4 space-y-2">
                            <Label>
                              Commission *
                            </Label>

                            <Input
                              type="number"
                              min="0"
                              max={
                                tier.commissionType ===
                                "percentage"
                                  ? 100
                                  : undefined
                              }
                              step="0.01"
                              value={
                                tier.amount || ""
                              }
                              onChange={(
                                event,
                              ) =>
                                updateCommissionTier(
                                  tier.id,
                                  {
                                    amount:
                                      Number(
                                        event
                                          .target
                                          .value,
                                      ) || 0,
                                  },
                                )
                              }
                              onWheel={(event) => {
                                event.currentTarget.blur();
                              }}
                              placeholder={
                                tier.commissionType ===
                                "percentage"
                                  ? "50"
                                  : "100"
                              }
                            />

                            <p className="text-xs text-muted-foreground">
                              {tier.commissionType ===
                              "percentage"
                                ? "Enter the commission percentage."
                                : "Enter the fixed commission amount in pesos."}
                            </p>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    addCommissionTier(
                      "MAS",
                    )
                  }
                >
                  <Plus className="mr-2 size-4" />
                  Add MAS Commission Tier
                </Button>
              </div>
            )}
          </div>

          {/* COLLECTOR COMMISSION */}
          <div className="rounded-xl border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-muted/40"
              onClick={() =>
                setShowCollectorCommission(
                  (current) => !current,
                )
              }
            >
              <div>
                <p className="font-semibold">
                  Collector Commission
                </p>

                <p className="text-xs text-muted-foreground">
                  Commission paid to Collectors.
                </p>
              </div>

              {showCollectorCommission ? (
                <ChevronUp className="size-5" />
              ) : (
                <ChevronDown className="size-5" />
              )}
            </button>

            {showCollectorCommission && (
              <div className="space-y-4 border-t p-4">
                {getTiersByRole(
                  "Collector",
                ).length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <p className="text-sm font-medium">
                      No Collector commission
                      tiers
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Add a tier to configure
                      Collector commission.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {getTiersByRole(
                      "Collector",
                    ).map((tier, index) => (
                      <div
                        key={tier.id}
                        className="rounded-lg border p-4"
                      >
                        <div className="mb-4 flex items-center justify-between">
                          <p className="text-sm font-semibold">
                            Collector Tier{" "}
                            {index + 1}
                          </p>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              deleteCommissionTier(
                                tier.id,
                              )
                            }
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                          <div className="space-y-2">
                            <Label>
                              From Month *
                            </Label>

                            <Input
                              type="number"
                              min="1"
                              step="1"
                              value={
                                tier.fromMonth
                              }
                              onChange={(
                                event,
                              ) =>
                                updateCommissionTier(
                                  tier.id,
                                  {
                                    fromMonth:
                                      Number(
                                        event
                                          .target
                                          .value,
                                      ) || 1,
                                  },
                                )
                              }
                              onWheel={(event) => {
                                event.currentTarget.blur();
                              }}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>
                              To Month *
                            </Label>

                            <Input
                              type="number"
                              min={
                                tier.fromMonth
                              }
                              step="1"
                              value={
                                tier.toMonth
                              }
                              onChange={(
                                event,
                              ) =>
                                updateCommissionTier(
                                  tier.id,
                                  {
                                    toMonth:
                                      Number(
                                        event
                                          .target
                                          .value,
                                      ) ||
                                      tier.fromMonth,
                                  },
                                )
                              }
                              onWheel={(event) => {
                                event.currentTarget.blur();
                              }}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>
                              Commission Type
                            </Label>

                            <Select
                              value={
                                tier.commissionType
                              }
                              onValueChange={(
                                value,
                              ) =>
                                updateCommissionTier(
                                  tier.id,
                                  {
                                    commissionType:
                                      (value as CommissionType) ??
                                      "percentage",
                                  },
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
                        </div>

                        <div className="mt-4 space-y-2">
                          <Label>
                            Commission *
                          </Label>

                          <Input
                            type="number"
                            min="0"
                            max={
                              tier.commissionType ===
                              "percentage"
                                ? 100
                                : undefined
                            }
                            step="0.01"
                            value={
                              tier.amount || ""
                            }
                            onChange={(
                              event,
                            ) =>
                              updateCommissionTier(
                                tier.id,
                                {
                                  amount:
                                    Number(
                                      event
                                        .target
                                        .value,
                                    ) || 0,
                                },
                              )
                            }
                            onWheel={(event) => {
                              event.currentTarget.blur();
                            }}
                            placeholder={
                              tier.commissionType ===
                              "percentage"
                                ? "50"
                                : "100"
                            }
                          />

                          <p className="text-xs text-muted-foreground">
                            {tier.commissionType ===
                            "percentage"
                              ? "Enter the commission percentage."
                              : "Enter the fixed commission amount in pesos."}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    addCommissionTier(
                      "Collector",
                    )
                  }
                >
                  <Plus className="mr-2 size-4" />
                  Add Collector Commission
                  Tier
                </Button>
              </div>
            )}
          </div>

          {/* DATE SETTINGS */}
          <div>
            <h3 className="mb-4 text-sm font-semibold">
              Program Dates
            </h3>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Date Started
                </Label>

                <Input
                  type="date"
                  value={form.dateStarted}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dateStarted:
                        event.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Date Ended
                </Label>

                <Input
                  type="date"
                  value={
                    form.dateEnded ?? ""
                  }
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dateEnded:
                        event.target.value ||
                        null,
                    }))
                  }
                />
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
                setForm((current) => ({
                  ...current,
                  description:
                    event.target.value,
                }))
              }
              placeholder="Program description, terms, notes, etc."
            />
          </div>

          {/* FORM BUTTONS */}
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            {editingId && (
              <Button
                type="button"
                variant="outline"
                onClick={resetForm}
              >
                Cancel
              </Button>
            )}

            <Button
              type="button"
              onClick={saveProgram}
            >
              <Plus className="mr-2 size-4" />

              {editingId
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
          {programs.length === 0 ? (
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
              {programs.map((program) => {
                const masTiers =
                  getProgramTiersByRole(
                    program,
                    "MAS",
                  );

                const collectorTiers =
                  getProgramTiersByRole(
                    program,
                    "Collector",
                  );

                return (
                  <div
                    key={program.id}
                    className="rounded-xl border p-5"
                  >
                    <div className="flex flex-col gap-5">
                      {/* PROGRAM HEADER */}
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">
                              {program.name}
                            </p>

                            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                              {program.code}
                            </span>

                            <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                              {program.status}
                            </span>
                          </div>

                          <p className="text-sm text-muted-foreground">
                            Base Pay: ₱
                            {program.basePay.toLocaleString(
                              "en-PH",
                              {
                                minimumFractionDigits: 2,
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
                                program.id,
                              )
                            }
                          >
                            <Trash2 className="mr-2 size-4" />
                            Delete
                          </Button>
                        </div>
                      </div>

                      {/* COMMISSION SUMMARY */}
                      <div className="grid gap-4 md:grid-cols-2">
                        {/* MAS */}
                        <div className="rounded-lg border bg-muted/20 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="font-semibold">
                              MAS Commission
                            </p>

                            <span className="text-xs text-muted-foreground">
                              {
                                masTiers.length
                              }{" "}
                              {masTiers.length ===
                              1
                                ? "tier"
                                : "tiers"}
                            </span>
                          </div>

                          {masTiers.length ===
                          0 ? (
                            <p className="text-sm text-muted-foreground">
                              No commission tiers
                              configured.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {masTiers.map(
                                (tier) => (
                                  <div
                                    key={
                                      tier.id
                                    }
                                    className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
                                  >
                                    <span className="text-sm">
                                      Month{" "}
                                      {
                                        tier.fromMonth
                                      }{" "}
                                      –{" "}
                                      {
                                        tier.toMonth
                                      }
                                    </span>

                                    <span className="text-sm font-semibold">
                                      {formatCommission(
                                        tier,
                                      )}
                                    </span>
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
                              Collector Commission
                            </p>

                            <span className="text-xs text-muted-foreground">
                              {
                                collectorTiers.length
                              }{" "}
                              {collectorTiers.length ===
                              1
                                ? "tier"
                                : "tiers"}
                            </span>
                          </div>

                          {collectorTiers.length ===
                          0 ? (
                            <p className="text-sm text-muted-foreground">
                              No commission tiers
                              configured.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {collectorTiers.map(
                                (tier) => (
                                  <div
                                    key={
                                      tier.id
                                    }
                                    className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
                                  >
                                    <span className="text-sm">
                                      Month{" "}
                                      {
                                        tier.fromMonth
                                      }{" "}
                                      –{" "}
                                      {
                                        tier.toMonth
                                      }
                                    </span>

                                    <span className="text-sm font-semibold">
                                      {formatCommission(
                                        tier,
                                      )}
                                    </span>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* DATES */}
                      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
                        <span>
                          Started:{" "}
                          {program.dateStarted ||
                            "Not set"}
                        </span>

                        <span>
                          Ended:{" "}
                          {program.dateEnded ||
                            "Not set"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}