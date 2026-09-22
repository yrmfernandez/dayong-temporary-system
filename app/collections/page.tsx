"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  User,
  History,
  Save,
  RotateCcw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { mockMembers } from "@/lib/mock-members";
import type { Member } from "@/lib/types";

type ProgramOption = {
  id: string;
  code: string;
  name: string;
  basePay: number;
};

type CollectionHistory = {
  id: string;
  memberId: string;
  programId: string;
  orNumber: string;
  orDate: string;
  amountCollected: number;
  monthOf: string;
  nop: number;
  dateRemitted: string;
};

type CollectionEntry = {
  id: string;

  memberSearch: string;
  memberId: string;
  programId: string;

  monthFrom: string;
  monthTo: string;

  nopFrom: number | null;
  nopTo: number | null;

  amountCollected: string;

  orNumber: string;
  orDate: string;

  reactivation: string;
  transferred: string;
  ifSuspended: string;
  originalMasOfficerName: string;

  status: string;

  isExpanded: boolean;
};

const mockPrograms: ProgramOption[] = [
  {
    id: "program-001",
    code: "D-290",
    name: "Dayong 290 Program",
    basePay: 290,
  },
  {
    id: "program-002",
    code: "D-150",
    name: "Dayong 150 Program",
    basePay: 150,
  },
  {
    id: "program-003",
    code: "D-300",
    name: "Dayong 300 Program",
    basePay: 300,
  },
];

const mockCollectionHistory: CollectionHistory[] = [
  {
    id: "collection-history-001",
    memberId: "member-001",
    programId: "program-001",
    orNumber: "OR-10001",
    orDate: "2026-08-10",
    amountCollected: 290,
    monthOf: "2026-08",
    nop: 1,
    dateRemitted: "2026-08-11",
  },
  {
    id: "collection-history-002",
    memberId: "member-001",
    programId: "program-001",
    orNumber: "OR-10045",
    orDate: "2026-09-10",
    amountCollected: 290,
    monthOf: "2026-09",
    nop: 2,
    dateRemitted: "2026-09-11",
  },
];

function createEmptyCollection(id: string): CollectionEntry {
  return {
    id,

    memberSearch: "",
    memberId: "",
    programId: "",

    monthFrom: "",
    monthTo: "",

    nopFrom: null,
    nopTo: null,

    amountCollected: "",

    orNumber: "",
    orDate: "",

    reactivation: "No",
    transferred: "No",
    ifSuspended: "",
    originalMasOfficerName: "",

    status: "Active",

    isExpanded: true,
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatMonth(value: string) {
  if (!value) return "—";

  const date = new Date(`${value}-01T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDate(value: string) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

function getMemberFullName(member: Member) {
  return [
    member.name.firstName,
    member.name.middleName,
    member.name.surname,
    member.name.nameExtension,
  ]
    .filter(Boolean)
    .join(" ");
}

function getMemberDisplayName(member: Member) {
  return [
    member.name.surname + ",",
    member.name.firstName,
    member.name.middleName,
    member.name.nameExtension,
  ]
    .filter(Boolean)
    .join(" ");
}

function getMonthDifference(from: string, to: string) {
  if (!from || !to) return 0;

  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);

  if (
    !fromYear ||
    !fromMonth ||
    !toYear ||
    !toMonth
  ) {
    return 0;
  }

  return (
    (toYear - fromYear) * 12 +
    (toMonth - fromMonth) +
    1
  );
}

export default function CollectionsPage() {
  const [branch, setBranch] = useState("");
  const [mas, setMas] = useState("");
  const [dateRemitted, setDateRemitted] = useState("");

  const [collections, setCollections] = useState<CollectionEntry[]>([
    createEmptyCollection("collection-1"),
  ]);

  const [activeCollectionId, setActiveCollectionId] =
    useState("collection-1");

  const [nextCollectionId, setNextCollectionId] = useState(2);

  const [showMoreDetails, setShowMoreDetails] = useState(false);

  const [saveMessage, setSaveMessage] = useState("");

  const [saving, setSaving] = useState(false);

  const activeCollection = useMemo(
    () =>
      collections.find(
        (entry) => entry.id === activeCollectionId,
      ) ?? null,
    [collections, activeCollectionId],
  );

  const activeMember = useMemo(() => {
    if (!activeCollection?.memberId) return null;

    return (
      mockMembers.find(
        (member) =>
          member.id === activeCollection.memberId,
      ) ?? null
    );
  }, [activeCollection]);

  const activeProgram = useMemo(() => {
    if (!activeCollection?.programId) return null;

    return (
      mockPrograms.find(
        (program) =>
          program.id === activeCollection.programId,
      ) ?? null
    );
  }, [activeCollection]);

  const activePrograms = useMemo(() => {
    if (!activeMember) return [];

    return mockPrograms;
  }, [activeMember]);

  const matchingMembers = useMemo(() => {
    if (!activeCollection) return [];

    const search =
      activeCollection.memberSearch.trim().toLowerCase();

    if (!search || activeCollection.memberId) {
      return [];
    }

    return mockMembers.filter((member) => {
      const fullName = getMemberFullName(member).toLowerCase();
      const displayName =
        getMemberDisplayName(member).toLowerCase();
      const phNumber =
        member.phMemberNumber.toLowerCase();

      return (
        fullName.includes(search) ||
        displayName.includes(search) ||
        phNumber.includes(search)
      );
    });
  }, [activeCollection]);

  const history = useMemo(() => {
    if (!activeMember || !activeProgram) {
      return [];
    }

    return mockCollectionHistory.filter(
      (item) =>
        item.memberId === activeMember.id &&
        item.programId === activeProgram.id,
    );
  }, [activeMember, activeProgram]);

  const lastHistory =
    history.length > 0
      ? history[history.length - 1]
      : null;

  const totalCollected = collections.reduce(
    (total, entry) =>
      total +
      (Number(entry.amountCollected) || 0),
    0,
  );

  function updateCollection(
    id: string,
    updates: Partial<CollectionEntry>,
  ) {
    setCollections((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              ...updates,
            }
          : entry,
      ),
    );
  }

  function selectMember(
    entryId: string,
    memberId: string,
  ) {
    const member = mockMembers.find(
      (item) => item.id === memberId,
    );

    if (!member) return;

    updateCollection(entryId, {
      memberId: member.id,
      memberSearch: getMemberFullName(member),
      programId: "",
      monthFrom: "",
      monthTo: "",
      nopFrom: null,
      nopTo: null,
    });
  }

  function selectProgram(
    entryId: string,
    programId: string,
  ) {
    const entry = collections.find(
      (item) => item.id === entryId,
    );

    if (!entry || !entry.memberId) return;

    const memberHistory =
      mockCollectionHistory.filter(
        (item) =>
          item.memberId === entry.memberId &&
          item.programId === programId,
      );

    const latestHistory =
      memberHistory.length > 0
        ? memberHistory[memberHistory.length - 1]
        : null;

    const nextNop = latestHistory
      ? latestHistory.nop + 1
      : 1;

    updateCollection(entryId, {
      programId,
      nopFrom: nextNop,
      nopTo: nextNop,
    });
  }

  function updateMonthFrom(
    entryId: string,
    value: string,
  ) {
    const entry = collections.find(
      (item) => item.id === entryId,
    );

    if (!entry) return;

    let nopFrom = entry.nopFrom;

    if (
      entry.programId &&
      entry.memberId &&
      nopFrom === null
    ) {
      const memberHistory =
        mockCollectionHistory.filter(
          (item) =>
            item.memberId === entry.memberId &&
            item.programId === entry.programId,
        );

      const latestHistory =
        memberHistory.length > 0
          ? memberHistory[memberHistory.length - 1]
          : null;

      nopFrom = latestHistory
        ? latestHistory.nop + 1
        : 1;
    }

    const monthCount = getMonthDifference(
      value,
      entry.monthTo,
    );

    updateCollection(entryId, {
      monthFrom: value,
      nopFrom,
      nopTo:
        nopFrom !== null && monthCount > 0
          ? nopFrom + monthCount - 1
          : nopFrom,
    });
  }

  function updateMonthTo(
    entryId: string,
    value: string,
  ) {
    const entry = collections.find(
      (item) => item.id === entryId,
    );

    if (!entry) return;

    const monthCount = getMonthDifference(
      entry.monthFrom,
      value,
    );

    updateCollection(entryId, {
      monthTo: value,
      nopTo:
        entry.nopFrom !== null && monthCount > 0
          ? entry.nopFrom + monthCount - 1
          : entry.nopFrom,
    });
  }

  function validateEntry(
    entry: CollectionEntry,
  ) {
    if (!branch) return "Branch is required.";

    if (!mas) return "MAS is required.";

    if (!dateRemitted) {
      return "Date Remitted is required.";
    }

    if (!entry.memberId) {
      return "Please select a member.";
    }

    if (!entry.programId) {
      return "Please select a program.";
    }

    if (!entry.monthFrom) {
      return "Month From is required.";
    }

    if (!entry.monthTo) {
      return "Month To is required.";
    }

    if (
      entry.nopFrom === null ||
      entry.nopTo === null
    ) {
      return "NOP cannot be empty.";
    }

    if (
      !entry.amountCollected ||
      Number(entry.amountCollected) <= 0
    ) {
      return "Amount Collected must be greater than zero.";
    }

    if (!entry.orNumber.trim()) {
      return "OR Number is required.";
    }

    if (!entry.orDate) {
      return "OR Date is required.";
    }

    if (
      entry.reactivation === "Yes" &&
      !entry.originalMasOfficerName.trim()
    ) {
      return "Original MAS / Officer Name is required for reactivation.";
    }

    return null;
  }

  function handleAddAnotherCollection() {
    if (!activeCollection) return;

    const error = validateEntry(activeCollection);

    if (error) {
      setSaveMessage(error);
      return;
    }

    setCollections((current) =>
      current.map((entry) => ({
        ...entry,
        isExpanded: false,
      })),
    );

    const newId = `collection-${nextCollectionId}`;

    setCollections((current) => [
      ...current,
      createEmptyCollection(newId),
    ]);

    setActiveCollectionId(newId);
    setNextCollectionId(
      (current) => current + 1,
    );

    setSaveMessage("");
    setShowMoreDetails(false);
  }

  function removeCollection(id: string) {
    if (collections.length === 1) {
      setCollections([
        createEmptyCollection("collection-1"),
      ]);
      setActiveCollectionId("collection-1");
      setShowMoreDetails(false);
      return;
    }

    const remaining = collections.filter(
      (entry) => entry.id !== id,
    );

    setCollections(remaining);

    if (activeCollectionId === id) {
      setActiveCollectionId(
        remaining[remaining.length - 1].id,
      );
    }
  }

  function editCollection(id: string) {
    setCollections((current) =>
      current.map((entry) => ({
        ...entry,
        isExpanded: entry.id === id,
      })),
    );

    setActiveCollectionId(id);
    setShowMoreDetails(false);
    setSaveMessage("");
  }

  async function saveRemittance() {
    setSaveMessage("");

    if (!branch) {
      setSaveMessage("Please select a branch.");
      return;
    }

    if (!mas) {
      setSaveMessage("Please select a MAS.");
      return;
    }

    if (!dateRemitted) {
      setSaveMessage(
        "Please enter the actual Date Remitted.",
      );
      return;
    }

    for (let index = 0; index < collections.length; index++) {
      const error = validateEntry(
        collections[index],
      );

      if (error) {
        setActiveCollectionId(
          collections[index].id,
        );

        setCollections((current) =>
          current.map((entry) => ({
            ...entry,
            isExpanded:
              entry.id === collections[index].id,
          })),
        );

        setSaveMessage(
          `Collection ${index + 1}: ${error}`,
        );

        return;
      }
    }

    setSaving(true);

    await new Promise((resolve) =>
      setTimeout(resolve, 700),
    );

    setSaving(false);

    setSaveMessage(
      `Remittance saved successfully. ${collections.length} collection${
        collections.length > 1 ? "s" : ""
      } included.`,
    );
  }

  function resetForm() {
    const firstCollection =
      createEmptyCollection("collection-1");

    setBranch("");
    setMas("");
    setDateRemitted("");
    setCollections([firstCollection]);
    setActiveCollectionId("collection-1");
    setNextCollectionId(2);
    setShowMoreDetails(false);
    setSaveMessage("");
  }

  return (
    <div className="space-y-6">
      {/* PAGE HEADER */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Collections
        </h1>

        <p className="text-sm text-muted-foreground">
          Encode existing member collections and
          remittances.
        </p>
      </div>

      {/* REMITTANCE HEADER */}
      <Card>
        <CardHeader>
          <CardTitle>
            Remittance Information
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
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="Mintal">
                    Mintal
                  </SelectItem>

                  <SelectItem value="Davao">
                    Davao
                  </SelectItem>

                  <SelectItem value="Toril">
                    Toril
                  </SelectItem>

                  <SelectItem value="Calinan">
                    Calinan
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>MAS *</Label>

              <Select
                value={mas}
                onValueChange={(value) =>
                  setMas(value ?? "")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select MAS" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="MACALOS, E.">
                    MACALOS, E.
                  </SelectItem>

                  <SelectItem value="SANTOS, J.">
                    SANTOS, J.
                  </SelectItem>

                  <SelectItem value="DELA CRUZ, M.">
                    DELA CRUZ, M.
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date Remitted *</Label>

              <Input
                type="date"
                value={dateRemitted}
                onChange={(event) =>
                  setDateRemitted(
                    event.target.value,
                  )
                }
              />

              <p className="text-xs text-muted-foreground">
                Manually enter the actual remittance
                date. This date is shared by all
                collections in this batch.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MAIN TWO COLUMN AREA */}
      <div className="grid min-h-0 gap-6 lg:grid-cols-2">
        {/* LEFT COLLECTION PANEL */}
        <Card className="flex h-[calc(100vh-220px)] min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 border-b">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>
                  Collection Entries
                </CardTitle>

                <p className="mt-1 text-sm text-muted-foreground">
                  Add multiple collections under the
                  same MAS and remittance date.
                </p>
              </div>

              <Badge variant="secondary">
                {collections.length}{" "}
                {collections.length === 1
                  ? "Entry"
                  : "Entries"}
              </Badge>
            </div>
          </CardHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <CardContent className="space-y-4 p-4">
              {collections.map(
                (entry, index) => {
                  const entryMember =
                    entry.memberId
                      ? mockMembers.find(
                          (member) =>
                            member.id ===
                            entry.memberId,
                        ) ?? null
                      : null;

                  const entryProgram =
                    entry.programId
                      ? mockPrograms.find(
                          (program) =>
                            program.id ===
                            entry.programId,
                        ) ?? null
                      : null;

                  const isActive =
                    activeCollectionId ===
                    entry.id;

                  return (
                    <div
                      key={entry.id}
                      className="overflow-hidden rounded-xl border"
                    >
                      {/* COLLAPSED HEADER */}
                      {!entry.isExpanded ? (
                        <div className="bg-muted/30 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">
                                  Collection{" "}
                                  {index + 1}
                                </Badge>

                                {entryMember && (
                                  <Badge>
                                    {
                                      entryMember.phMemberNumber
                                    }
                                  </Badge>
                                )}
                              </div>

                              <p className="mt-2 truncate font-semibold">
                                {entryMember
                                  ? getMemberDisplayName(
                                      entryMember,
                                    )
                                  : "No member selected"}
                              </p>

                              <p className="text-sm text-muted-foreground">
                                {entryProgram
                                  ? `${entryProgram.code} — ${entryProgram.name}`
                                  : "No program selected"}
                              </p>

                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                  From:{" "}
                                  {formatMonth(
                                    entry.monthFrom,
                                  )}
                                </span>

                                <span>
                                  To:{" "}
                                  {formatMonth(
                                    entry.monthTo,
                                  )}
                                </span>

                                <span>
                                  NOP:{" "}
                                  {entry.nopFrom ??
                                    "—"}{" "}
                                  -{" "}
                                  {entry.nopTo ??
                                    "—"}
                                </span>

                                <span>
                                  Amount:{" "}
                                  {entry.amountCollected
                                    ? formatCurrency(
                                        Number(
                                          entry.amountCollected,
                                        ),
                                      )
                                    : "—"}
                                </span>

                                <span>
                                  OR:{" "}
                                  {entry.orNumber ||
                                    "—"}
                                </span>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  editCollection(
                                    entry.id,
                                  )
                                }
                              >
                                <Pencil className="mr-2 size-4" />
                                Edit
                              </Button>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  removeCollection(
                                    entry.id,
                                  )
                                }
                              >
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-5 p-4">
                          {/* ENTRY TITLE */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                Collection{" "}
                                {index + 1}
                              </Badge>

                              {isActive && (
                                <Badge>
                                  Active
                                </Badge>
                              )}
                            </div>

                            {collections.length >
                              1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  removeCollection(
                                    entry.id,
                                  )
                                }
                              >
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            )}
                          </div>

                          {/* MEMBER SEARCH */}
                          <div className="space-y-2">
                            <Label>
                              Search Member by Full Name *
                            </Label>

                            <div className="relative">
                              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />

                              <Input
                                className="pl-9"
                                placeholder="Type member full name..."
                                value={
                                  entry.memberSearch
                                }
                                onChange={(
                                  event,
                                ) => {
                                  updateCollection(
                                    entry.id,
                                    {
                                      memberSearch:
                                        event.target
                                          .value,
                                      memberId: "",
                                      programId: "",
                                      monthFrom:
                                        "",
                                      monthTo: "",
                                      nopFrom: null,
                                      nopTo: null,
                                    },
                                  );
                                }}
                              />

                              {activeCollectionId ===
                                entry.id &&
                                !entry.memberId &&
                                entry.memberSearch.trim() &&
                                matchingMembers.length >
                                  0 && (
                                  <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-background shadow-xl">
                                    {matchingMembers.map(
                                      (
                                        member,
                                      ) => (
                                        <button
                                          key={
                                            member.id
                                          }
                                          type="button"
                                          className="block w-full border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted"
                                          onMouseDown={(
                                            event,
                                          ) =>
                                            event.preventDefault()
                                          }
                                          onClick={() =>
                                            selectMember(
                                              entry.id,
                                              member.id,
                                            )
                                          }
                                        >
                                          <p className="font-medium">
                                            {
                                              member
                                                .name
                                                .surname
                                            }
                                            ,{" "}
                                            {
                                              member
                                                .name
                                                .firstName
                                            }{" "}
                                            {
                                              member
                                                .name
                                                .middleName
                                            }
                                          </p>

                                          <p className="text-xs text-muted-foreground">
                                            {
                                              member.phMemberNumber
                                            }{" "}
                                            ·{" "}
                                            {
                                              member.contactNumber
                                            }
                                          </p>
                                        </button>
                                      ),
                                    )}
                                  </div>
                                )}
                            </div>

                            {entry.memberSearch.trim() &&
                              matchingMembers.length ===
                                0 &&
                              !entry.memberId && (
                                <p className="text-xs text-muted-foreground">
                                  No matching member
                                  found.
                                </p>
                              )}
                          </div>

                          {/* SELECTED MEMBER */}
                          {entryMember && (
                            <div className="rounded-lg border bg-muted/40 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex gap-3">
                                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background">
                                    <User className="size-5 text-muted-foreground" />
                                  </div>

                                  <div>
                                    <p className="font-semibold">
                                      {getMemberDisplayName(
                                        entryMember,
                                      )}
                                    </p>

                                    <p className="text-sm text-muted-foreground">
                                      PH/Member Number:{" "}
                                      {
                                        entryMember.phMemberNumber
                                      }
                                    </p>

                                    <p className="text-sm text-muted-foreground">
                                      Contact:{" "}
                                      {
                                        entryMember.contactNumber
                                      }
                                    </p>
                                  </div>
                                </div>

                                <Badge>
                                  Member Selected
                                </Badge>
                              </div>
                            </div>
                          )}

                          {/* PROGRAM */}
                          <div className="space-y-2">
                            <Label>
                              Dayong Program *
                            </Label>

                            <Select
                              value={
                                entry.programId
                              }
                              onValueChange={(
                                value,
                              ) =>
                                selectProgram(
                                  entry.id,
                                  value ?? "",
                                )
                              }
                              disabled={
                                !entry.memberId
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue
                                  placeholder={
                                    entry.memberId
                                      ? "Select program"
                                      : "Select a member first"
                                  }
                                />
                              </SelectTrigger>

                              <SelectContent>
                                {activeCollectionId ===
                                  entry.id &&
                                  activePrograms.map(
                                    (
                                      program,
                                    ) => (
                                      <SelectItem
                                        key={
                                          program.id
                                        }
                                        value={
                                          program.id
                                        }
                                      >
                                        {
                                          program.code
                                        }{" "}
                                        —{" "}
                                        {
                                          program.name
                                        }
                                      </SelectItem>
                                    ),
                                  )}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* PAYMENT PERIOD */}
                          <div className="space-y-3">
                            <div>
                              <Label>
                                Payment Period *
                              </Label>

                              <p className="text-xs text-muted-foreground">
                                Select the first and
                                last month covered by
                                this payment.
                              </p>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-2">
                                <Label className="text-xs">
                                  Month From
                                </Label>

                                <Input
                                  type="month"
                                  value={
                                    entry.monthFrom
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    updateMonthFrom(
                                      entry.id,
                                      event.target
                                        .value,
                                    )
                                  }
                                  disabled={
                                    !entry.programId
                                  }
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-xs">
                                  Month To
                                </Label>

                                <Input
                                  type="month"
                                  min={
                                    entry.monthFrom ||
                                    undefined
                                  }
                                  value={
                                    entry.monthTo
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    updateMonthTo(
                                      entry.id,
                                      event.target
                                        .value,
                                    )
                                  }
                                  disabled={
                                    !entry.monthFrom
                                  }
                                />
                              </div>
                            </div>
                          </div>

                          {/* NOP */}
                          <div className="space-y-3">
                            <div>
                              <Label>
                                NOP
                              </Label>

                              <p className="text-xs text-muted-foreground">
                                NOP is automatically
                                calculated from the
                                member's previous
                                collection history and
                                payment period.
                              </p>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-2">
                                <Label className="text-xs">
                                  NOP From
                                </Label>

                                <Input
                                  type="number"
                                  value={
                                    entry.nopFrom ??
                                    ""
                                  }
                                  readOnly
                                  tabIndex={-1}
                                  className="bg-muted/50"
                                  placeholder="Auto"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-xs">
                                  NOP To
                                </Label>

                                <Input
                                  type="number"
                                  value={
                                    entry.nopTo ??
                                    ""
                                  }
                                  readOnly
                                  tabIndex={-1}
                                  className="bg-muted/50"
                                  placeholder="Auto"
                                />
                              </div>
                            </div>
                          </div>

                          {/* AMOUNT */}
                          <div className="space-y-2">
                            <Label>
                              Amount Collected *
                            </Label>

                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={
                                entry.amountCollected
                              }
                              onChange={(event) =>
                                updateCollection(
                                  entry.id,
                                  {
                                    amountCollected:
                                      event.target
                                        .value,
                                  },
                                )
                              }
                              onWheel={(event) => {
                                event.currentTarget.blur();
                              }}
                              placeholder="0.00"
                            />

                            <p className="text-xs text-muted-foreground">
                              Mouse-wheel scrolling is
                              disabled for this field
                              to prevent accidental
                              amount changes.
                            </p>
                          </div>

                          {/* OR DETAILS */}
                          <div className="space-y-3">
                            <div>
                              <Label>
                                OR Details
                              </Label>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-2">
                                <Label className="text-xs">
                                  OR Number *
                                </Label>

                                <Input
                                  value={
                                    entry.orNumber
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    updateCollection(
                                      entry.id,
                                      {
                                        orNumber:
                                          event.target
                                            .value,
                                      },
                                    )
                                  }
                                  placeholder="Enter OR number"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-xs">
                                  OR Date *
                                </Label>

                                <Input
                                  type="date"
                                  value={
                                    entry.orDate
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    updateCollection(
                                      entry.id,
                                      {
                                        orDate:
                                          event.target
                                            .value,
                                      },
                                    )
                                  }
                                />
                              </div>
                            </div>
                          </div>

                          {/* DATE REMITTED DISPLAY */}
                          <div className="rounded-lg border bg-muted/30 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium">
                                  Date Remitted
                                </p>

                                <p className="text-xs text-muted-foreground">
                                  Controlled by the
                                  remittance header.
                                </p>
                              </div>

                              <Badge variant="secondary">
                                {dateRemitted
                                  ? formatDate(
                                      dateRemitted,
                                    )
                                  : "Not set"}
                              </Badge>
                            </div>
                          </div>

                          {/* MORE DETAILS */}
                          <div className="rounded-lg border">
                            <button
                              type="button"
                              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
                              onClick={() =>
                                setShowMoreDetails(
                                  (current) =>
                                    !current,
                                )
                              }
                            >
                              <span>
                                Additional Details
                              </span>

                              {showMoreDetails ? (
                                <ChevronUp className="size-4" />
                              ) : (
                                <ChevronDown className="size-4" />
                              )}
                            </button>

                            {showMoreDetails && (
                              <div className="space-y-4 border-t p-4">
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <div className="space-y-2">
                                    <Label>
                                      Reactivation
                                    </Label>

                                    <Select
                                      value={
                                        entry.reactivation
                                      }
                                      onValueChange={(
                                        value,
                                      ) =>
                                        updateCollection(
                                          entry.id,
                                          {
                                            reactivation:
                                              value ??
                                              "No",
                                          },
                                        )
                                      }
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue />
                                      </SelectTrigger>

                                      <SelectContent>
                                        <SelectItem value="No">
                                          No
                                        </SelectItem>

                                        <SelectItem value="Yes">
                                          Yes
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  <div className="space-y-2">
                                    <Label>
                                      Transferred
                                    </Label>

                                    <Select
                                      value={
                                        entry.transferred
                                      }
                                      onValueChange={(
                                        value,
                                      ) =>
                                        updateCollection(
                                          entry.id,
                                          {
                                            transferred:
                                              value ??
                                              "No",
                                          },
                                        )
                                      }
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue />
                                      </SelectTrigger>

                                      <SelectContent>
                                        <SelectItem value="No">
                                          No
                                        </SelectItem>

                                        <SelectItem value="Yes">
                                          Yes
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <Label>
                                    If Suspended
                                  </Label>

                                  <Select
                                    value={
                                      entry.ifSuspended
                                    }
                                    onValueChange={(
                                      value,
                                    ) =>
                                      updateCollection(
                                        entry.id,
                                        {
                                          ifSuspended:
                                            value ??
                                            "",
                                        },
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select if applicable" />
                                    </SelectTrigger>

                                    <SelectContent>
                                      <SelectItem value="Waiver">
                                        Waiver
                                      </SelectItem>

                                      <SelectItem value="Visitation Form">
                                        Visitation Form
                                      </SelectItem>

                                      <SelectItem value="Other">
                                        Other
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-2">
                                  <Label>
                                    Original MAS /
                                    Officer's Name
                                  </Label>

                                  <Input
                                    value={
                                      entry.originalMasOfficerName
                                    }
                                    onChange={(
                                      event,
                                    ) =>
                                      updateCollection(
                                        entry.id,
                                        {
                                          originalMasOfficerName:
                                            event
                                              .target
                                              .value,
                                        },
                                      )
                                    }
                                    placeholder="Enter original MAS / Officer"
                                  />
                                </div>

                                <div className="space-y-2">
                                  <Label>
                                    Status
                                  </Label>

                                  <Select
                                    value={
                                      entry.status
                                    }
                                    onValueChange={(
                                      value,
                                    ) =>
                                      updateCollection(
                                        entry.id,
                                        {
                                          status:
                                            value ??
                                            "Active",
                                        },
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>

                                    <SelectContent>
                                      <SelectItem value="Active">
                                        Active
                                      </SelectItem>

                                      <SelectItem value="Inactive">
                                        Inactive
                                      </SelectItem>

                                      <SelectItem value="DTO">
                                        DTO
                                      </SelectItem>

                                      <SelectItem value="Collector">
                                        Collector
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* ADD ANOTHER */}
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={
                              handleAddAnotherCollection
                            }
                          >
                            <Plus className="mr-2 size-4" />
                            Add Another Collection
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                },
              )}

              {/* TOTAL */}
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Total Amount Collected
                  </span>

                  <span className="text-lg font-semibold">
                    {formatCurrency(totalCollected)}
                  </span>
                </div>
              </div>

              {/* SAVE / RESET */}
              <div className="space-y-3 border-t pt-4">
                {saveMessage && (
                  <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
                    {saveMessage}
                  </div>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={saveRemittance}
                    disabled={saving}
                  >
                    <Save className="mr-2 size-4" />

                    {saving
                      ? "Saving..."
                      : "Save Remittance"}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                    disabled={saving}
                  >
                    <RotateCcw className="mr-2 size-4" />
                    Reset
                  </Button>
                </div>
              </div>
            </CardContent>
          </div>
        </Card>

        {/* RIGHT HISTORY PANEL */}
        <Card className="flex h-[calc(100vh-220px)] min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 border-b">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <History className="size-5" />
              </div>

              <div>
                <CardTitle>
                  Member Collection History
                </CardTitle>

                <p className="mt-1 text-sm text-muted-foreground">
                  History for the selected member and
                  program.
                </p>
              </div>
            </div>
          </CardHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <CardContent className="space-y-5 p-4">
              {!activeMember ? (
                <div className="flex min-h-[300px] items-center justify-center rounded-xl border border-dashed">
                  <div className="text-center">
                    <User className="mx-auto mb-3 size-10 text-muted-foreground" />

                    <p className="font-medium">
                      No Member Selected
                    </p>

                    <p className="mt-1 text-sm text-muted-foreground">
                      Search and select a member from
                      the collection form.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* ACCOUNT SUMMARY */}
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {getMemberDisplayName(
                            activeMember,
                          )}
                        </p>

                        <p className="text-sm text-muted-foreground">
                          {
                            activeMember.phMemberNumber
                          }
                        </p>

                        <p className="text-sm text-muted-foreground">
                          {
                            activeMember.contactNumber
                          }
                        </p>
                      </div>

                      <Badge>
                        {activeMember.id}
                      </Badge>
                    </div>
                  </div>

                  {/* PROGRAM */}
                  {activeProgram ? (
                    <div className="rounded-xl border p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Selected Program
                      </p>

                      <p className="mt-1 font-semibold">
                        {activeProgram.code}
                      </p>

                      <p className="text-sm text-muted-foreground">
                        {activeProgram.name}
                      </p>

                      <p className="mt-2 text-sm">
                        Base Pay:{" "}
                        <span className="font-medium">
                          {formatCurrency(
                            activeProgram.basePay,
                          )}
                        </span>
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                      Select a program to view its
                      collection history.
                    </div>
                  )}

                  {/* SUMMARY CARDS */}
                  {activeProgram && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border p-4">
                        <p className="text-xs text-muted-foreground">
                          Collections
                        </p>

                        <p className="mt-1 text-xl font-semibold">
                          {history.length}
                        </p>
                      </div>

                      <div className="rounded-xl border p-4">
                        <p className="text-xs text-muted-foreground">
                          Latest NOP
                        </p>

                        <p className="mt-1 text-xl font-semibold">
                          {lastHistory?.nop ??
                            "—"}
                        </p>
                      </div>

                      <div className="rounded-xl border p-4">
                        <p className="text-xs text-muted-foreground">
                          Last Payment
                        </p>

                        <p className="mt-1 text-xl font-semibold">
                          {lastHistory
                            ? formatCurrency(
                                lastHistory.amountCollected,
                              )
                            : "—"}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* HISTORY */}
                  {activeProgram && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">
                          Previous Collections
                        </h3>

                        <Badge variant="secondary">
                          {history.length}
                        </Badge>
                      </div>

                      {history.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-6 text-center">
                          <p className="font-medium">
                            No previous collections
                          </p>

                          <p className="mt-1 text-sm text-muted-foreground">
                            This appears to be the first
                            collection for this program.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {history.map((item) => (
                            <div
                              key={item.id}
                              className="rounded-xl border p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium">
                                    {formatMonth(
                                      item.monthOf,
                                    )}
                                  </p>

                                  <p className="text-xs text-muted-foreground">
                                    OR{" "}
                                    {
                                      item.orNumber
                                    }
                                  </p>
                                </div>

                                <Badge variant="outline">
                                  NOP{" "}
                                  {item.nop}
                                </Badge>
                              </div>

                              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    Amount
                                  </p>

                                  <p className="font-semibold">
                                    {formatCurrency(
                                      item.amountCollected,
                                    )}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    OR Date
                                  </p>

                                  <p className="text-sm font-medium">
                                    {formatDate(
                                      item.orDate,
                                    )}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    Date Remitted
                                  </p>

                                  <p className="text-sm font-medium">
                                    {formatDate(
                                      item.dateRemitted,
                                    )}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    Month Of
                                  </p>

                                  <p className="text-sm font-medium">
                                    {formatMonth(
                                      item.monthOf,
                                    )}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* CURRENT ENTRY CHECK */}
                  {activeCollection &&
                    activeMember &&
                    activeProgram && (
                      <div className="rounded-xl border bg-muted/30 p-4">
                        <p className="text-sm font-semibold">
                          Current Entry
                        </p>

                        <div className="mt-3 space-y-2 text-sm">
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">
                              Payment Period
                            </span>

                            <span className="font-medium">
                              {formatMonth(
                                activeCollection.monthFrom,
                              )}{" "}
                              —{" "}
                              {formatMonth(
                                activeCollection.monthTo,
                              )}
                            </span>
                          </div>

                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">
                              NOP
                            </span>

                            <span className="font-medium">
                              {activeCollection
                                .nopFrom ??
                                "—"}{" "}
                              —{" "}
                              {activeCollection
                                .nopTo ?? "—"}
                            </span>
                          </div>

                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">
                              Amount
                            </span>

                            <span className="font-medium">
                              {activeCollection
                                .amountCollected
                                ? formatCurrency(
                                    Number(
                                      activeCollection.amountCollected,
                                    ),
                                  )
                                : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                </>
              )}
            </CardContent>
          </div>
        </Card>
      </div>
    </div>
  );
}