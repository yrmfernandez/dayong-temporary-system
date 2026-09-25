"use client";

import { useEffect, useState } from "react";

import {
  ChevronDown,
  ChevronUp,
} from "lucide-react";

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

type Branch = {
  id: string;
  name: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  country: string;
  postalCode: string;
  contactNumber: string;
  email: string;
  dateOpened: string;
  dateClosed: string;
  status: "active" | "inactive";
};

type BranchForm = Omit<Branch, "id">;

const emptyBranchForm: BranchForm = {
  name: "",
  barangay: "",
  cityMunicipality: "",
  province: "",
  country: "Philippines",
  postalCode: "",
  contactNumber: "",
  email: "",
  dateOpened: "",
  dateClosed: "",
  status: "active",
};

type BranchResponse = {
  success: boolean;
  branches?: Branch[];
  message?: string;
};

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState<BranchForm>(emptyBranchForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expandedBranches, setExpandedBranches] = useState<
    Record<string, boolean>
  >({});

  const loadBranches = async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/branches", {
        cache: "no-store",
      });
      const result = (await response.json()) as BranchResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load branches.");
      }

      setBranches(result.branches ?? []);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load branches.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBranches();
  }, []);

  const saveBranch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");

    if (!form.name.trim()) {
      setMessage("Branch Name / Code is required.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = (await response.json()) as {
        success: boolean;
        message?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to save branch.");
      }

      setForm(emptyBranchForm);
      setMessage("Branch saved successfully.");
      setShowForm(false);
      await loadBranches();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save branch.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleBranch = (branchId: string) => {
    setExpandedBranches((current) => ({
      ...current,
      [branchId]: !current[branchId],
    }));
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Branches</h1>
          <p className="text-sm text-muted-foreground">
            Add and manage the branches available for sales and operations.
          </p>
        </div>

        <Button type="button" onClick={() => setShowForm(true)}>
          Add Branch
        </Button>
      </div>

      {showForm && (
        <Card>
        <CardHeader>
          <CardTitle>Add Branch</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={saveBranch}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="branch-name">Branch Name / Code *</Label>
                <Input id="branch-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Main Branch" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-barangay">Barangay</Label>
                <Input id="branch-barangay" value={form.barangay} onChange={(event) => setForm((current) => ({ ...current, barangay: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-city">City / Municipality</Label>
                <Input id="branch-city" value={form.cityMunicipality} onChange={(event) => setForm((current) => ({ ...current, cityMunicipality: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-province">Province</Label>
                <Input id="branch-province" value={form.province} onChange={(event) => setForm((current) => ({ ...current, province: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-country">Country</Label>
                <Input id="branch-country" value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-postal-code">Postal Code</Label>
                <Input id="branch-postal-code" value={form.postalCode} onChange={(event) => setForm((current) => ({ ...current, postalCode: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-contact">Contact Number</Label>
                <Input id="branch-contact" value={form.contactNumber} onChange={(event) => setForm((current) => ({ ...current, contactNumber: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-email">Email</Label>
                <Input id="branch-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-date-opened">Date Opened</Label>
                <Input id="branch-date-opened" type="date" value={form.dateOpened} onChange={(event) => setForm((current) => ({ ...current, dateOpened: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-date-closed">Date Closed</Label>
                <Input id="branch-date-closed" type="date" value={form.dateClosed} onChange={(event) => setForm((current) => ({ ...current, dateClosed: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value === "inactive" ? "inactive" : "active" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Add Branch"}
            </Button>
          </form>

          {message && (
            <p className="mt-4 text-sm text-muted-foreground">{message}</p>
          )}
        </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Branch List</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading branches...</p>
          ) : branches.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">No branches yet.</p>
              <p className="text-sm text-muted-foreground">Add your first branch above.</p>
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {branches.map((branch) => {
                const isExpanded = expandedBranches[branch.id] ?? false;

                return (
                  <div key={branch.id} className="space-y-4 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{branch.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {branch.id}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={branch.status === "active" ? "default" : "secondary"}>
                          {branch.status === "active" ? "Active" : "Inactive"}
                        </Badge>
                        <Button
                          type="button"
                          variant="outline"
                          aria-expanded={isExpanded}
                          onClick={() => toggleBranch(branch.id)}
                        >
                          {isExpanded ? (
                            <ChevronUp className="mr-2 size-4" />
                          ) : (
                            <ChevronDown className="mr-2 size-4" />
                          )}
                          {isExpanded ? "Collapse" : "Expand"}
                        </Button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-muted-foreground">Address</p>
                          <p>
                            {[branch.barangay, branch.cityMunicipality, branch.province]
                              .filter(Boolean)
                              .join(", ") || "Not provided"}
                          </p>
                        </div>

                        <div>
                          <p className="text-muted-foreground">Contact</p>
                          <p>
                            {[branch.contactNumber, branch.email]
                              .filter(Boolean)
                              .join(" · ") || "Not provided"}
                          </p>
                        </div>

                        <div>
                          <p className="text-muted-foreground">Country</p>
                          <p>{branch.country || "Not provided"}</p>
                        </div>

                        <div>
                          <p className="text-muted-foreground">Postal Code</p>
                          <p>{branch.postalCode || "Not provided"}</p>
                        </div>

                        <div>
                          <p className="text-muted-foreground">Date Opened</p>
                          <p>{branch.dateOpened || "Not provided"}</p>
                        </div>

                        <div>
                          <p className="text-muted-foreground">Date Closed</p>
                          <p>{branch.dateClosed || "Not provided"}</p>
                        </div>
                      </div>
                    )}
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
