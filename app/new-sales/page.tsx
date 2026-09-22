"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

import { programs } from "@/lib/programs";

type Beneficiary = {
  id: number;
};

type Sale = {
  id: number;
  expanded: boolean;
  existingMember: boolean;
  memberNumber: string;
  beneficiaries: Beneficiary[];
  programId: string;
};

export default function NewSalesPage() {
  const [branch, setBranch] = useState("");
  const [mas, setMas] = useState("");

  const [sales, setSales] = useState<Sale[]>([
    {
      id: 1,
      expanded: true,
      existingMember: false,
      memberNumber: "",
      beneficiaries: [],
      programId: "",
    },
  ]);

  const addSale = () => {
    setSales((current) => [
      ...current,
      {
        id: Date.now(),
        expanded: true,
        existingMember: false,
        memberNumber: "",
        beneficiaries: [],
        programId: "",
      },
    ]);
  };

  const removeSale = (id: number) => {
    if (sales.length === 1) return;

    setSales((current) =>
      current.filter((sale) => sale.id !== id),
    );
  };

  const toggleSale = (id: number) => {
    setSales((current) =>
      current.map((sale) =>
        sale.id === id
          ? { ...sale, expanded: !sale.expanded }
          : sale,
      ),
    );
  };

  const addBeneficiary = (saleId: number) => {
    setSales((current) =>
      current.map((sale) =>
        sale.id === saleId
          ? {
              ...sale,
              beneficiaries: [
                ...sale.beneficiaries,
                { id: Date.now() },
              ],
            }
          : sale,
      ),
    );
  };

  const removeBeneficiary = (
    saleId: number,
    beneficiaryId: number,
  ) => {
    setSales((current) =>
      current.map((sale) =>
        sale.id === saleId
          ? {
              ...sale,
              beneficiaries:
                sale.beneficiaries.filter(
                  (beneficiary) =>
                    beneficiary.id !== beneficiaryId,
                ),
            }
          : sale,
      ),
    );
  };

  const updateSale = (
    saleId: number,
    updates: Partial<Sale>,
  ) => {
    setSales((current) =>
      current.map((sale) =>
        sale.id === saleId
          ? { ...sale, ...updates }
          : sale,
      ),
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          New Sales
        </h1>

        <p className="text-sm text-muted-foreground">
          Encode multiple new sales from the same MAS in one batch.
        </p>
      </div>

      {/* Batch information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Batch Information
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Branch *</Label>

              <Select
                value={branch}
                onValueChange={(value) =>
                  setBranch(value ?? "")
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="mintal">
                    Mintal
                  </SelectItem>

                  <SelectItem value="main">
                    Main Branch
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                Marketing Account Staff *
              </Label>

              <Select
                value={mas}
                onValueChange={(value) =>
                  setMas(value ?? "")
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select MAS" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="macalos">
                    MACALOS, E.
                  </SelectItem>

                  <SelectItem value="mas-2">
                    Other MAS
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date Remitted</Label>

              <Input
                type="date"
                value={
                  new Date()
                    .toISOString()
                    .split("T")[0]
                }
                readOnly
              />

              <p className="text-xs text-muted-foreground">
                Automatically recorded by the system.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sales */}
      <div className="space-y-4">
        {sales.map((sale, index) => (
          <Card key={sale.id}>
            {/* Sale header */}
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">
                    Sale #{index + 1}
                  </Badge>

                  {sale.memberNumber && (
                    <span className="text-sm text-muted-foreground">
                      PH/Member: {sale.memberNumber}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {sales.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        removeSale(sale.id)
                      }
                      title="Remove sale"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      toggleSale(sale.id)
                    }
                    title={
                      sale.expanded
                        ? "Collapse"
                        : "Expand"
                    }
                  >
                    {sale.expanded ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>

            {sale.expanded && (
              <CardContent className="space-y-8 pt-6">
                {/* Member search */}
                <section className="space-y-4">
                  <div>
                    <h2 className="font-semibold">
                      Member
                    </h2>

                    <p className="text-sm text-muted-foreground">
                      Search first to avoid creating a duplicate
                      member.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-2">
                      <Label>
                        PH / Member Number
                      </Label>

                      <Input
                        placeholder="Enter PH / Member Number"
                        value={sale.memberNumber}
                        onChange={(event) =>
                          updateSale(sale.id, {
                            memberNumber:
                              event.target.value,
                          })
                        }
                      />
                    </div>

                    <Button variant="outline">
                      <Search className="mr-2 size-4" />
                      Search
                    </Button>
                  </div>

                  {sale.existingMember && (
                    <div className="rounded-lg border bg-muted/40 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">
                            Existing member found
                          </p>

                          <p className="text-sm text-muted-foreground">
                            Member information will be loaded.
                          </p>
                        </div>

                        <Badge>
                          Existing Member
                        </Badge>
                      </div>
                    </div>
                  )}
                </section>

                <Separator />

                {/* Personal data */}
                <section className="space-y-4">
                  <div>
                    <h2 className="font-semibold">
                      A. Personal Data
                    </h2>

                    <p className="text-sm text-muted-foreground">
                      Complete this section only for a new member.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Surname *</Label>
                      <Input placeholder="Surname" />
                    </div>

                    <div className="space-y-2">
                      <Label>First Name *</Label>
                      <Input placeholder="First Name" />
                    </div>

                    <div className="space-y-2">
                      <Label>Middle Name</Label>
                      <Input placeholder="Middle Name" />
                    </div>

                    <div className="space-y-2">
                      <Label>Name Extension</Label>
                      <Input placeholder="Jr., Sr., III" />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Birthdate *</Label>
                      <Input type="date" />
                    </div>

                    <div className="space-y-2">
                      <Label>Birthplace</Label>
                      <Input placeholder="Birthplace" />
                    </div>

                    <div className="space-y-2">
                      <Label>Gender *</Label>

                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="male">
                            Male
                          </SelectItem>

                          <SelectItem value="female">
                            Female
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Age</Label>

                      <Input
                        type="number"
                        placeholder="Auto-calculated"
                        readOnly
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Civil Status *</Label>

                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="single">
                            Single
                          </SelectItem>

                          <SelectItem value="married">
                            Married
                          </SelectItem>

                          <SelectItem value="widow">
                            Widow
                          </SelectItem>

                          <SelectItem value="live-in">
                            Live in
                          </SelectItem>

                          <SelectItem value="others">
                            Others
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Contact Number *</Label>
                      <Input placeholder="09XXXXXXXXX" />
                    </div>
                  </div>

                  {/* Member Address */}
                  <div className="space-y-4">
                    <div>
                      <Label>
                        Present Address *
                      </Label>

                      <p className="text-sm text-muted-foreground">
                        Enter the complete address using the appropriate
                        fields.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>
                          House / Block / Lot No.
                        </Label>

                        <Input placeholder="House / Block / Lot No." />
                      </div>

                      <div className="space-y-2">
                        <Label>Street</Label>
                        <Input placeholder="Street" />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Subdivision / Village
                        </Label>

                        <Input placeholder="Subdivision / Village" />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Barangay *
                        </Label>

                        <Input placeholder="Barangay" />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Municipality / City *
                        </Label>

                        <Input placeholder="Municipality / City" />
                      </div>

                      <div className="space-y-2">
                        <Label>Province *</Label>

                        <Input placeholder="Province" />
                      </div>

                      <div className="space-y-2">
                        <Label>ZIP Code</Label>

                        <Input
                          type="text"
                          inputMode="numeric"
                          placeholder="ZIP Code"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <Separator />

                {/* Beneficiaries */}
                <section className="space-y-4">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <h2 className="font-semibold">
                        B. Beneficiaries
                      </h2>

                      <p className="text-sm text-muted-foreground">
                        Add only when applicable to the program.
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      onClick={() =>
                        addBeneficiary(sale.id)
                      }
                    >
                      <Plus className="mr-2 size-4" />
                      Add Beneficiary
                    </Button>
                  </div>

                  {sale.beneficiaries.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        No beneficiaries added.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {sale.beneficiaries.map(
                        (
                          beneficiary,
                          beneficiaryIndex,
                        ) => (
                          <div
                            key={beneficiary.id}
                            className="rounded-lg border p-4"
                          >
                            <div className="mb-4 flex items-center justify-between">
                              <p className="font-medium">
                                Beneficiary{" "}
                                {beneficiaryIndex + 1}
                              </p>

                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  removeBeneficiary(
                                    sale.id,
                                    beneficiary.id,
                                  )
                                }
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>

                            <div className="grid gap-4 md:grid-cols-3">
                              <Input placeholder="Surname" />
                              <Input placeholder="First Name" />
                              <Input placeholder="Middle Name" />

                              <Input
                                type="number"
                                placeholder="Age"
                              />

                              <Input type="date" />

                              <Input placeholder="Relationship" />
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </section>

                <Separator />

                {/* Claimant */}
                <section className="space-y-4">
                  <div>
                    <h2 className="font-semibold">
                      C. Claimant / Contact Person
                    </h2>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>
                        Complete Name *
                      </Label>

                      <Input placeholder="Complete name" />
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Contact Number *
                      </Label>

                      <Input placeholder="09XXXXXXXXX" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <Label>Address *</Label>

                      <p className="text-sm text-muted-foreground">
                        Enter the complete address using the appropriate
                        fields.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>
                          House / Block / Lot No.
                        </Label>

                        <Input placeholder="House / Block / Lot No." />
                      </div>

                      <div className="space-y-2">
                        <Label>Street</Label>

                        <Input placeholder="Street" />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Subdivision / Village
                        </Label>

                        <Input placeholder="Subdivision / Village" />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Barangay *
                        </Label>

                        <Input placeholder="Barangay" />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Municipality / City *
                        </Label>

                        <Input placeholder="Municipality / City" />
                      </div>

                      <div className="space-y-2">
                        <Label>Province *</Label>

                        <Input placeholder="Province" />
                      </div>

                      <div className="space-y-2">
                        <Label>ZIP Code</Label>

                        <Input
                          type="text"
                          inputMode="numeric"
                          placeholder="ZIP Code"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <Separator />

                {/* Program */}
                <section className="space-y-4">
                  <div>
                    <h2 className="font-semibold">
                      D. Program Details
                    </h2>

                    <p className="text-sm text-muted-foreground">
                      Select an active program configured in Program
                      Management.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>
                        Program Type *
                      </Label>

                      <Select
                        value={sale.programId}
                        onValueChange={(value) =>
                          updateSale(sale.id, {
                            programId:
                              value ?? "",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select program" />
                        </SelectTrigger>

                        <SelectContent>
                          {programs
                            .filter(
                              (program) =>
                                program.status ===
                                "active",
                            )
                            .map((program) => (
                              <SelectItem
                                key={program.id}
                                value={program.id}
                              >
                                {program.code} —{" "}
                                {program.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>

                      {programs.filter(
                        (program) =>
                          program.status ===
                          "active",
                      ).length === 0 && (
                        <p className="text-xs text-destructive">
                          No active programs available. Add a program
                          first in Program Management.
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Date Enrolled *
                      </Label>

                      <Input type="date" />
                    </div>
                  </div>

                  {/* Selected program information */}
                  {sale.programId && (
                    <div className="rounded-lg border bg-muted/40 p-4">
                      {(() => {
                        const selectedProgram =
                          programs.find(
                            (program) =>
                              program.id ===
                              sale.programId,
                          );

                        if (!selectedProgram) {
                          return null;
                        }

                        return (
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                Program
                              </p>

                              <p className="font-medium">
                                {selectedProgram.code} —{" "}
                                {selectedProgram.name}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs text-muted-foreground">
                                Base Pay
                              </p>

                              <p className="font-medium">
                                ₱
                                {selectedProgram.basePay.toLocaleString(
                                  "en-PH",
                                  {
                                    minimumFractionDigits: 2,
                                  },
                                )}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs text-muted-foreground">
                                Status
                              </p>

                              <Badge>
                                {selectedProgram.status}
                              </Badge>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>
                        Mode of Payment *
                      </Label>

                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder="Payment method" />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="cash">
                            Cash
                          </SelectItem>

                          <SelectItem value="gcash">
                            GCash
                          </SelectItem>

                          <SelectItem value="maya">
                            Maya
                          </SelectItem>

                          <SelectItem value="bank">
                            Bank
                          </SelectItem>

                          <SelectItem value="others">
                            Others
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Registration Fee *
                      </Label>

                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder="Yes / No" />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="yes">
                            Yes
                          </SelectItem>

                          <SelectItem value="no">
                            No
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Registration Amount
                      </Label>

                      <Input
                        type="number"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Amount Paid *
                    </Label>

                    <Input
                      type="number"
                      placeholder="0.00"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Program Terms
                    </Label>

                    <Textarea placeholder="Program terms and conditions" />
                  </div>
                </section>

                <Separator />

                {/* Payment */}
                <section className="space-y-4">
                  <div>
                    <h2 className="font-semibold">
                      E. Payment / OR Details
                    </h2>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>
                        Application No.
                      </Label>

                      <Input placeholder="Application number" />
                    </div>

                    <div className="space-y-2">
                      <Label>
                        OR Number *
                      </Label>

                      <Input placeholder="Official receipt number" />
                    </div>

                    <div className="space-y-2">
                      <Label>
                        OR Date *
                      </Label>

                      <Input type="date" />
                    </div>
                  </div>

                  <div className="rounded-lg bg-muted/50 p-4">
                    <p className="text-sm font-medium">
                      Date Remitted
                    </p>

                    <p className="mt-1 text-sm text-muted-foreground">
                      Automatically recorded when the Entry Clerk
                      encodes the transaction.
                    </p>
                  </div>
                </section>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Add sale */}
      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={addSale}
      >
        <Plus className="mr-2 size-4" />
        Add New Sale
      </Button>

      {/* Summary */}
      <Card>
        <CardContent className="flex flex-col justify-between gap-4 pt-6 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold">
              {sales.length}{" "}
              {sales.length === 1
                ? "Sale"
                : "Sales"}
            </p>

            <p className="text-sm text-muted-foreground">
              {branch
                ? `Branch: ${branch}`
                : "Branch not selected"}{" "}
              ·{" "}
              {mas
                ? `MAS: ${mas}`
                : "MAS not selected"}
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline">
              Cancel
            </Button>

            <Button size="lg">
              Save All New Sales
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}