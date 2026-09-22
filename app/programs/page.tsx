"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

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

export default function ProgramsPage() {
  const [programs, setPrograms] =
    useState<Program[]>(initialPrograms);

  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [form, setForm] = useState<Program>(
    createEmptyProgram(),
  );

  function createEmptyProgram(): Program {
    return {
      id: crypto.randomUUID(),

      code: "",
      name: "",

      basePay: 0,

      masCommission: 0,
      collectorCommission: 0,

      commissionType: "fixed",

      description: "",

      dateStarted: "",
      dateEnded: null,

      status: "active",
    };
  }

  function resetForm() {
    setForm(createEmptyProgram());
    setEditingId(null);
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

  function editProgram(program: Program) {
    setForm({
      ...program,
    });

    setEditingId(program.id);

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Programs
        </h1>

        <p className="text-sm text-muted-foreground">
          Manage Dayong programs, base pay, and
          commission settings.
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Program Code *</Label>

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
              <Label>Program Name *</Label>

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

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Base Pay *</Label>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.basePay || ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    basePay:
                      Number(
                        event.target.value,
                      ) || 0,
                  }))
                }
                placeholder="290"
              />

              <p className="text-xs text-muted-foreground">
                Used for TMD and Balance
                calculations.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Commission Type</Label>

              <Select
                value={form.commissionType}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,

                    commissionType:
                      (value as
                        | "fixed"
                        | "percentage") ??
                      "fixed",
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="fixed">
                    Fixed Amount
                  </SelectItem>

                  <SelectItem value="percentage">
                    Percentage
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>

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

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                MAS Commission
              </Label>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={
                  form.masCommission || ""
                }
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,

                    masCommission:
                      Number(
                        event.target.value,
                      ) || 0,
                  }))
                }
                placeholder="0"
              />
            </div>

            <div className="space-y-2">
              <Label>
                Collector Commission
              </Label>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={
                  form.collectorCommission ||
                  ""
                }
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,

                    collectorCommission:
                      Number(
                        event.target.value,
                      ) || 0,
                  }))
                }
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Date Started</Label>

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
              <Label>Date Ended</Label>

              <Input
                type="date"
                value={form.dateEnded ?? ""}
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

          <div className="space-y-2">
            <Label>Description</Label>

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

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
            <div className="space-y-3">
              {programs.map((program) => (
                <div
                  key={program.id}
                  className="rounded-lg border p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">
                          {program.name}
                        </p>

                        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                          {program.code}
                        </span>

                        <span className="rounded-md bg-muted px-2 py-1 text-xs">
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

                      <p className="text-sm text-muted-foreground">
                        MAS Commission:{" "}
                        {program.commissionType ===
                        "percentage"
                          ? `${program.masCommission}%`
                          : `₱${program.masCommission.toLocaleString(
                              "en-PH",
                              {
                                minimumFractionDigits: 2,
                              },
                            )}`}
                      </p>

                      <p className="text-sm text-muted-foreground">
                        Collector Commission:{" "}
                        {program.commissionType ===
                        "percentage"
                          ? `${program.collectorCommission}%`
                          : `₱${program.collectorCommission.toLocaleString(
                              "en-PH",
                              {
                                minimumFractionDigits: 2,
                              },
                            )}`}
                      </p>

                      {program.description && (
                        <p className="pt-2 text-sm">
                          {program.description}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2">
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}