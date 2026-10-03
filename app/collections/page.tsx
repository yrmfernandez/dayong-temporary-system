"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import { SearchSelect } from "@/components/ui/search-select";
import { useFormDraft } from "@/lib/use-form-draft";
import { formatDeadline, incentiveDeadline, keepsIncentive, manilaNow } from "@/lib/remittance-deadline";
import { BACKDATE_REASON_MIN, controlTotalProblem, needsBackdateReason } from "@/lib/entry-controls";
import { blockingDateProblem, dateWarnings } from "@/lib/date-checks";
import { CashCountInput } from "@/components/cash-count-input";
import { compressReceiptPhoto } from "@/components/receipt-photo";
import { cashCountTotal, formatCashCount, type CashCount } from "@/lib/cash-count";
import { RemittanceSummary } from "@/components/remittance-summary";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Member } from "@/lib/types";
import { calculateRemittance, tiersForBranch, type IncentiveTier } from "@/lib/remittance";

type CollectionChannel = "MAS" | "Collector" | "DTO";
type PaymentMethodOption = { id: string; name: string; isCash: boolean; requiresReference: boolean };
const collectionChannels: Array<{ value: CollectionChannel; label: string; hint: string }> = [
  { value: "MAS", label: "MAS", hint: "Collected by the assigned MAS" },
  { value: "Collector", label: "Collector", hint: "Collected on the MAS's behalf" },
  { value: "DTO", label: "DTO", hint: "Direct to Office" },
];
// DTO keeps the current (MAS) incentive tier; only Collector batches use the Collector tier.
const incentiveRoleFor = (channel: CollectionChannel) => channel === "Collector" ? "Collector" : "MAS";

type ProgramOption = {
  id: string;
  code: string;
  name: string;
  basePay: number;
  payBalanceTotal?: number;
  /** Programs U: false (the default) locks the amount to covered months × base pay. */
  collectionAmountEditable?: boolean;
  incentiveTiers?: IncentiveTier[];
};

type CollectionMember = Member & {
  programIds: string[];
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
  programSearch: string;

  monthFrom: string;
  monthTo: string;

  nopFrom: number | null;
  nopTo: number | null;

  amountCollected: string;

  orNumber: string;
  orDate: string;
  /** Why an OR date more than a day old is encoded late. */
  backdateReason: string;

  reactivation: string;
  transferred: string;
  ifSuspended: string;

  status: string;
  accountStatus: string;
  temporarilySuspended: boolean;
  collectedByRole: string;
  accountLoading: boolean;

  isExpanded: boolean;
};


function createEmptyCollection(id: string): CollectionEntry {
  return {
    id,

    memberSearch: "",
    memberId: "",
    programId: "",
    programSearch: "",

    monthFrom: "",
    monthTo: "",

    nopFrom: null,
    nopTo: null,

    amountCollected: "",

    orNumber: "",
    orDate: "",
    backdateReason: "",

    reactivation: "No",
    transferred: "No",
    ifSuspended: "",

    status: "Active",
    accountStatus: "", temporarilySuspended: false, collectedByRole: "MAS", accountLoading: false,

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
  const collectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [scrollTargetId, setScrollTargetId] = useState("");
  const [members, setMembers] = useState<CollectionMember[]>([]);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; territory?: string; status: string }>>([]);
  const [masStaff, setMasStaff] = useState<Array<{ employeeId: string; fullName: string; branchIds:string[] }>>([]);
  const [histories, setHistories] = useState<Record<string, CollectionHistory[]>>({});
  const selectionVersions = useRef<Record<string, number>>({});

  const [showMoreDetails, setShowMoreDetails] = useState(false);

  const [saveMessage, setSaveMessage] = useState("");

  const [saving, setSaving] = useState(false);
  const [autoApproveRemittance, setAutoApproveRemittance] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  // The total written on the MAS's turnover sheet; the batch saves only when the entries add up to it.
  const [controlTotal, setControlTotal] = useState("");
  // Bills and coins counted when cash is received in full here; "Cash received" is their total.
  const [cashCount, setCashCount] = useState<CashCount>({});
  // Cash received in full approves at once, and approval needs the receipt photo, so it is taken before saving.
  const [receiptPhoto, setReceiptPhoto] = useState<{ dataUrl: string; width: number; height: number; bytes: number } | null>(null);
  const [photoError, setPhotoError] = useState("");
  // When the cash confirmed in full was handed over; incentives are kept only by 10:00 AM the day after the OR date.
  const [timeReceived, setTimeReceived] = useState("");
  // Batch-level: who brought these payments in, and how the MAS remitted them to the office.
  const [collectedBy, setCollectedBy] = useState<CollectionChannel>("MAS");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  // Remittance penalty: charged to the accountable MAS/Collector (their own money), added once to the batch's remittance.
  const [penalty, setPenalty] = useState("");
  const [penaltyNote, setPenaltyNote] = useState("");
  // Fidelity: the accountable employee's own money handed over with this batch, added to its total remittance.
  const [fidelity, setFidelity] = useState("");

  // The unsaved batch survives leaving the page and coming back (member search results included, so picks still show).
  useFormDraft(
    "collections",
    { branch, mas, dateRemitted, collections, activeCollectionId, nextCollectionId, members, histories, collectedBy, paymentMethod, paymentReference, penalty, penaltyNote, fidelity },
    (draft) => {
      setBranch(draft.branch ?? "");
      setMas(draft.mas ?? "");
      setDateRemitted(draft.dateRemitted ?? "");
      if (Array.isArray(draft.collections) && draft.collections.length) setCollections(draft.collections);
      if (draft.activeCollectionId) setActiveCollectionId(draft.activeCollectionId);
      if (draft.nextCollectionId) setNextCollectionId(draft.nextCollectionId);
      setMembers(draft.members ?? []);
      setHistories(draft.histories ?? {});
      if (draft.collectedBy) setCollectedBy(draft.collectedBy);
      if (draft.paymentMethod) setPaymentMethod(draft.paymentMethod);
      setPaymentReference(draft.paymentReference ?? "");
      setPenalty(draft.penalty ?? "");
      setPenaltyNote(draft.penaltyNote ?? "");
      setFidelity(draft.fidelity ?? "");
    },
  );
  const selectedPaymentMethod = paymentMethods.find((method) => method.name === paymentMethod);
  const isCashPayment = selectedPaymentMethod?.isCash ?? false;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/remittance-methods", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        const active: PaymentMethodOption[] = (result.methods ?? []).filter((method: PaymentMethodOption & { status: string }) => method.status === "active");
        setPaymentMethods(active);
        setPaymentMethod((current) => current || active.find((method) => method.isCash)?.name || active[0]?.name || "");
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    const loadOptions = async () => {
      const [programResponse, branchResponse, masResponse] = await Promise.all([
        fetch("/api/programs", { cache: "no-store" }),
        fetch("/api/branches", { cache: "no-store" }),
        fetch("/api/mas", { cache: "no-store" }),
      ]);
      const [programResult, branchResult, masResult] = await Promise.all([
        programResponse.json(),
        branchResponse.json(),
        masResponse.json(),
      ]);

      if (programResponse.ok && programResult.success) {
        setPrograms(programResult.programs ?? []);
      }

      if (branchResponse.ok && branchResult.success) {
        setBranches(
          (branchResult.branches ?? []).filter(
            (item: { status: string }) => item.status === "active",
          ),
        );
      }
      if (masResponse.ok && masResult.success) setMasStaff(masResult.staff ?? []);
    };

    void loadOptions();
  }, []);

  useEffect(() => {
    if (!scrollTargetId) return;

    collectionRefs.current[scrollTargetId]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    const frame = requestAnimationFrame(() => setScrollTargetId(""));
    return () => cancelAnimationFrame(frame);
  }, [collections, scrollTargetId]);

  const searchMembers = async (search: string) => {
    if (!search.trim() || !branch || !mas) return;

    const response = await fetch(
      `/api/members?search=${encodeURIComponent(search)}&branch=${encodeURIComponent(branch)}&mas=${encodeURIComponent(mas)}`,
      { cache: "no-store" },
    );
    const result = await response.json();

    if (response.ok && result.success) {
      setMembers((current) => {
        const next = [...current];

        for (const member of result.members ?? []) {
          if (!next.some((item) => item.id === member.id)) {
            next.push(member);
          }
        }

        return next;
      });
    }
  };

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
        members.find(
        (member) =>
          member.id === activeCollection.memberId,
      ) ?? null
    );
  }, [activeCollection, members]);

  const activeProgram = useMemo(() => {
    if (!activeCollection?.programId) return null;

    return (
      programs.find(
        (program) =>
          program.id === activeCollection.programId,
      ) ?? null
    );
  }, [activeCollection, programs]);

  const history = useMemo(() => {
    if (!activeMember || !activeProgram) {
      return [];
    }

    return (histories[activeCollectionId] ?? []).filter(
      (item) =>
        item.memberId === activeMember.id &&
        item.programId === activeProgram.id,
    );
  }, [activeMember, activeProgram, histories, activeCollectionId]);

  const lastHistory =
    history.length > 0
      ? history[0]
      : null;

  function quoteEntry(entry: CollectionEntry) {
    try {
      const selected = programs.find((p) => p.id === entry.programId);
      const count = getMonthDifference(entry.monthFrom, entry.monthTo);
      if (!selected || count < 1 || !entry.nopFrom || !entry.nopTo || entry.nopTo - entry.nopFrom + 1 !== count) return { error: "Select the program, months, and matching NOP range." };
      return { ...calculateRemittance(selected.basePay, tiersForBranch(selected.incentiveTiers ?? [], branches.find((item) => item.name === branch)?.id ?? ""), incentiveRoleFor(collectedBy), entry.nopFrom, entry.nopTo, Number(entry.amountCollected)), error: "" };
    } catch (error) { return { error: error instanceof Error ? error.message : "Unable to calculate remittance." }; }
  }
  const quotes = collections.map(quoteEntry);
  const totalCollected = collections.reduce((sum, entry) => sum + Math.round(Number(entry.amountCollected || 0) * 100), 0) / 100;
  const totalRemittance = quotes.every((q) => "remittance" in q) ? quotes.reduce((sum, q) => sum + Math.round(("remittance" in q ? q.remittance : 0) * 100), 0) / 100 : null;
  const penaltyAmount = Math.max(0, Math.round((Number(penalty) || 0) * 100) / 100);
  const fidelityAmount = Math.max(0, Math.round((Number(fidelity) || 0) * 100) / 100);
  // The cash due is the company remittance plus Fidelity; a penalty is tracked separately.
  const totalDue = totalRemittance === null ? null : Math.round((totalRemittance + fidelityAmount) * 100) / 100;
  // Cash confirmed in full after an entry's incentive deadline remits that entry's full amount.
  const receivedAt = dateRemitted && timeReceived ? `${dateRemitted} ${timeReceived}` : "";
  const lateIncentive = autoApproveRemittance && receivedAt ? collections.reduce((sum, entry, index) => {
    const quote = quotes[index], amount = Number(entry.amountCollected) || 0;
    return "remittance" in quote && amount > quote.remittance && !keepsIncentive(entry.orDate, receivedAt) ? sum + Math.round((amount - quote.remittance) * 100) : sum;
  }, 0) / 100 : 0;
  const cashDue = totalDue === null ? null : Math.round((totalDue + lateIncentive) * 100) / 100;

  function updateCollection(
    id: string,
    updates: Partial<CollectionEntry>,
  ) {
    setCollections((current) =>
      current.map((entry) =>
        entry.id === id
          ? (() => {
              const next = { ...entry, ...updates };
              const count = getMonthDifference(next.monthFrom, next.monthTo);
              const rate = programs.find((p) => p.id === next.programId)?.basePay;
              const shouldRecalculate = "programId" in updates || "monthFrom" in updates || "monthTo" in updates;
              return { ...next, amountCollected: shouldRecalculate ? (rate && count > 0 ? (Math.round(rate * 100) * count / 100).toFixed(2) : "") : next.amountCollected };
            })()
          : entry,
      ),
    );
  }

  function clearScopedMemberSelections() {
    setMembers([]);
    setHistories({});
    setCollections((current) => current.map((entry) => {
      selectionVersions.current[entry.id] = (selectionVersions.current[entry.id] ?? 0) + 1;
      return { ...entry, memberSearch: "", memberId: "", programId: "", programSearch: "", accountStatus: "", temporarilySuspended: false, accountLoading: false, monthFrom: "", monthTo: "", nopFrom: null, nopTo: null, amountCollected: "" };
    }));
  }

  function selectMember(
    entryId: string,
    memberId: string,
  ) {
    const member = members.find(
      (item) => item.id === memberId,
    );

    if (!member) return;

    selectionVersions.current[entryId] = (selectionVersions.current[entryId] ?? 0) + 1;
    updateCollection(entryId, {
      accountStatus: "", temporarilySuspended: false, accountLoading: false,
      memberId: member.id,
      memberSearch: getMemberFullName(member),
      programId: "",
      programSearch: "",
      monthFrom: "",
      monthTo: "",
      nopFrom: null,
      nopTo: null,
    });
    if (member.programIds.length === 1) {
      void selectProgram(entryId, member.programIds[0], member.id);
    }
  }

  async function selectProgram(
    entryId: string,
    programId: string,
    selectedMemberId?: string,
  ) {
    const entry = collections.find(
      (item) => item.id === entryId,
    );

    const memberId = selectedMemberId || entry?.memberId;
    if (!entry || !memberId) return;

    const version = (selectionVersions.current[entryId] ?? 0) + 1;
    selectionVersions.current[entryId] = version;
    const program = programs.find((item) => item.id === programId);
    updateCollection(entryId, { programId, programSearch: program?.code ?? "", accountStatus: "", accountLoading: true, monthFrom: "", monthTo: "", nopFrom: null, nopTo: null });
    setHistories((current) => ({ ...current, [entryId]: [] }));
    try {
      const response = await fetch(`/api/collections?memberId=${encodeURIComponent(memberId)}&programId=${encodeURIComponent(programId)}&branch=${encodeURIComponent(branch)}&mas=${encodeURIComponent(mas)}`, { cache: "no-store" });
      const result = await response.json();
      if (selectionVersions.current[entryId] !== version) return;
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load account.");
      const account = result.account;
      setHistories((current) => ({ ...current, [entryId]: result.history ?? [] }));
      updateCollection(entryId, { accountStatus: account.status, temporarilySuspended: account.temporarilySuspended, accountLoading: false,
        amountCollected: String(account.monthlyAmount), monthFrom: account.nextMonth, monthTo: account.nextMonth, nopFrom: account.nextNop, nopTo: account.nextNop });
    } catch (error) {
      if (selectionVersions.current[entryId] !== version) return;
      updateCollection(entryId, { accountLoading: false, accountStatus: "" });
      setSaveMessage(error instanceof Error ? error.message : "Unable to load account.");
    }
  }

  function updateMonthFrom(
    entryId: string,
    value: string,
  ) {
    const entry = collections.find(
      (item) => item.id === entryId,
    );

    if (!entry) return;

    const nopFrom = entry.nopFrom;

    const monthCount = getMonthDifference(
      value,
      entry.monthTo,
    );

    updateCollection(entryId, {
      monthFrom: value,
      amountCollected: monthCount > 0 ? String(monthCount * (programs.find((p) => p.id === entry.programId)?.basePay ?? 0)) : "",
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
      amountCollected: monthCount > 0 ? String(monthCount * (programs.find((p) => p.id === entry.programId)?.basePay ?? 0)) : "",
      nopTo:
        entry.nopFrom !== null && monthCount > 0
          ? entry.nopFrom + monthCount - 1
          : entry.nopFrom,
    });
  }

  function validateEntry(
    entry: CollectionEntry,
  ) {
    const quote = quoteEntry(entry);
    if (quote.error) return quote.error;
    if (entry.accountLoading || !entry.accountStatus) return "Load the program account before saving.";
    if (entry.accountStatus === "Forfeited") return "This program account is forfeited. Payments are blocked.";
    if (entry.temporarilySuspended && entry.ifSuspended !== "Waiver") return "Select Waiver under If Suspended.";
    const rate = programs.find((p) => p.id === entry.programId)?.basePay ?? 0;
    const months = getMonthDifference(entry.monthFrom, entry.monthTo);
    if (months < 1 || Number(entry.amountCollected) * 100 < Math.round(rate * 100) * months) return "Amount must cover every selected full monthly installment.";
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

    // Each OR Number is one receipt; the server also checks every earlier batch.
    const receipt = entry.orNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (collections.some((other) => other.id !== entry.id && other.orNumber.toUpperCase().replace(/[^A-Z0-9]/g, "") === receipt)) {
      return `OR Number ${entry.orNumber.trim()} is already entered in this batch. Each OR Number is used once.`;
    }

    if (!entry.orDate) {
      return "OR Date is required.";
    }

    const dateProblem = blockingDateProblem({ receiptDate: entry.orDate, dateRemitted, today: manilaNow().date });
    if (dateProblem) return dateProblem;

    if (needsBackdateReason(entry.orDate) && (entry.backdateReason ?? "").trim().length < BACKDATE_REASON_MIN) {
      return "The OR date is more than a day old. Enter the reason it is being encoded late.";
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
    setScrollTargetId(newId);
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

  async function saveCollections() {
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
        "Please enter the Date Remitted.",
      );
      return;
    }

    if (Number(penalty) < 0) {
      setSaveMessage("The penalty must be zero or a positive amount.");
      return;
    }

    if (penaltyAmount > 0 && penaltyNote.trim().length < 3) {
      setSaveMessage("Explain what the penalty is for.");
      return;
    }

    if (!selectedPaymentMethod) {
      setSaveMessage("Remittance method is required.");
      return;
    }

    if (selectedPaymentMethod.requiresReference && !paymentReference.trim()) {
      setSaveMessage(`Enter the ${selectedPaymentMethod.name} reference number.`);
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

    const controlProblem = controlTotalProblem(controlTotal, collections.map((entry) => Number(entry.amountCollected) || 0));
    if (controlProblem) {
      setSaveMessage(controlProblem);
      return;
    }

    const approveNow = autoApproveRemittance && isCashPayment;
    if (approveNow && !receiptPhoto) {
      setSaveMessage("Cash received in full needs the receipt photo first. Take it under Cash count.");
      return;
    }
    if (approveNow && cashDue !== null && Math.round(cashCountTotal(cashCount) * 100) !== Math.round(cashDue * 100)) {
      setSaveMessage(`The counted cash must equal the cash due of ${formatCurrency(cashDue)}.`);
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch,
          mas,
          accountableEmployeeId: masStaff.find((staff) => staff.fullName === mas)?.employeeId ?? "",
          dateRemitted,
          collectedBy,
          paymentMethod,
          paymentReference: selectedPaymentMethod?.requiresReference ? paymentReference.trim() : "",
          // Saved first; the approved remittance is created below once the receipt photo is attached.
          autoApproveRemittance: false,
          controlTotal: Number(controlTotal),
          penalty: penaltyAmount,
          penaltyNote: penaltyAmount > 0 ? penaltyNote.trim() : "",
          fidelityAmount,
          collections: collections.map((entry) => ({
            ...entry,
            memberNumber: members.find(
              (member) => member.id === entry.memberId,
            )?.phMemberNumber,
          })),
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to save collections.");
      }

      if (approveNow && receiptPhoto) {
        // Saved: attach the receipt photo to the whole batch, then create and approve its remittance.
        const ids: string[] = result.collectionIds ?? [];
        const finish = async () => {
          const photo = await fetch("/api/receipt-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryIds: ids, dataUrl: receiptPhoto.dataUrl, width: receiptPhoto.width, height: receiptPhoto.height }) });
          const photoResult = await photo.json();
          if (!photo.ok || !photoResult.success) throw new Error(photoResult.message || "The receipt photo could not be saved.");
          const remittance = await fetch("/api/remittances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collectionIds: ids, actualAmount: cashCountTotal(cashCount), fidelityAmount: 0, remittanceDate: dateRemitted, remittanceTime: timeReceived, cashCount: formatCashCount(cashCount), remarks: "Cash received in full during collection encoding.", cashConfirmed: true }) });
          const remittanceResult = await remittance.json();
          if (!remittance.ok) throw new Error(remittanceResult.error || "The remittance could not be approved.");
          return remittanceResult.remittance?.id as string;
        };
        try {
          const remittanceId = await finish();
          resetForm();
          setSaveMessage(`${ids.length} collection(s) saved, receipt photo attached, and Remittance ${remittanceId} approved.`);
        } catch (followUp) {
          resetForm();
          setSaveMessage(`${ids.length} collection(s) saved, but ${followUp instanceof Error ? followUp.message : "the remittance could not be approved"} Finish it in My Entries and Remittances.`);
        }
        return;
      }

      resetForm();
      setSaveMessage(result.message);
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Unable to save collections.",
      );
    } finally {
      setSaving(false);
    }
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
    setShowPreview(false);
    setAutoApproveRemittance(false);
    setCashReceived("");
    setControlTotal("");
    setTimeReceived("");
    setCashCount({});
    setReceiptPhoto(null);
    setPhotoError("");
    setPenalty("");
    setPenaltyNote("");
    setFidelity("");
    setCollectedBy("MAS");
    setPaymentMethod(paymentMethods.find((method) => method.isCash)?.name || paymentMethods[0]?.name || "");
    setPaymentReference("");
  }

  return (
    <div className="space-y-4">
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-end justify-between gap-2 rounded-xl page-hero px-5 py-3">
        <div><h1 className="text-xl font-semibold tracking-tight">
          Collections
        </h1>

        <p className="text-xs text-violet-30/80">
          Record member payments and assign cash accountability.
        </p></div><Badge variant="secondary">{collections.length} {collections.length===1?"entry":"entries"}</Badge>
      </div>

      {/* COLLECTION BATCH HEADER */}
      <Card><CardContent className="p-4">
          <p className="mb-3 text-sm font-semibold">Collection Batch</p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Branch *</Label>

              <SearchSelect aria-label="Branch" value={branch} placeholder="Search branch" options={branches.map((item) => ({ value: item.name, label: item.name, description: item.territory || "Unassigned territory" }))} onValueChange={(value) => { setBranch(value); setMas(""); clearScopedMemberSelections(); }}/>
            </div>

            <div className="space-y-2">
              <Label>MAS *</Label>

              <SearchSelect aria-label="MAS" value={mas} placeholder={branch ? "Search employee / MAS" : "Select a branch first"} disabled={!branch} options={masStaff.filter((staff) => { const branchId=branches.find((item) => item.name === branch)?.id; return Boolean(branchId && staff.branchIds.includes(branchId)); }).map((staff) => ({ value: staff.fullName, label: staff.fullName, description: staff.employeeId }))} onValueChange={(value) => { setMas(value); clearScopedMemberSelections(); }}/>
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

              <p className="text-xs text-muted-foreground">Shared by every entry in this batch.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-3">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Collected by *</legend>
              <div role="radiogroup" aria-label="Collected by" className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/50 p-1">
                {collectionChannels.map((channel) => (
                  <button key={channel.value} type="button" role="radio" aria-checked={collectedBy === channel.value} title={channel.hint}
                    onClick={() => setCollectedBy(channel.value)}
                    className={`rounded-md px-2 py-1.5 text-sm font-semibold transition-colors ${collectedBy === channel.value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                    {channel.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{collectionChannels.find((channel) => channel.value === collectedBy)?.hint}. Applies to every entry; DTO uses the current MAS incentive.</p>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="payment-method">Remittance Method *</Label>
              <select id="payment-method" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setPaymentReference(""); }}>
                {!paymentMethods.length && <option value="">No remittance methods configured</option>}
                {paymentMethods.map((method) => <option key={method.id} value={method.name}>{method.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">How the MAS remitted this batch to the office.</p>
            </div>

            {selectedPaymentMethod?.requiresReference ? (
              <div className="space-y-2">
                <Label htmlFor="payment-reference">{selectedPaymentMethod.name} reference no. *</Label>
                <Input id="payment-reference" maxLength={100} value={paymentReference} placeholder="Transaction / deposit slip number" onChange={(event) => setPaymentReference(event.target.value)} />
                <p className="text-xs text-muted-foreground">Finance verifies this before approving the remittance.</p>
              </div>
            ) : (
              <div className="flex items-center rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                {isCashPayment ? "Physical cash: count it on turnover. You can approve immediately below when it matches." : "No reference needed for this method."}
              </div>
            )}

            <fieldset className={`space-y-2 rounded-lg border p-3 md:col-span-3 ${penaltyAmount > 0 ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20" : ""}`}>
              <legend className="px-1 text-sm font-medium">Remittance penalty (optional)</legend>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="penalty-amount">Penalty amount</Label>
                  <Input id="penalty-amount" type="number" min="0" step="0.01" value={penalty} placeholder="0.00" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => { setPenalty(event.target.value); setAutoApproveRemittance(false); }} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="penalty-note">What is the penalty for?{penaltyAmount > 0 ? " *" : ""}</Label>
                  <Input id="penalty-note" maxLength={300} value={penaltyNote} disabled={penaltyAmount <= 0} placeholder={penaltyAmount > 0 ? "e.g. Late turnover: collections held 5 days past schedule" : "Enter a penalty amount first"} onChange={(event) => setPenaltyNote(event.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Charged to the {collectedBy === "Collector" ? "Collector" : "MAS"}, paid from their own money, and added to this batch&apos;s total remittance. Members are not charged.</p>
            </fieldset>

            <fieldset className="space-y-2 rounded-lg border p-3 md:col-span-3">
              <legend className="px-1 text-sm font-medium">Fidelity (optional)</legend>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor="fidelity-amount">Fidelity amount</Label>
                  <Input id="fidelity-amount" type="number" min="0" step="0.01" value={fidelity} placeholder="0.00" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => { setFidelity(event.target.value); setAutoApproveRemittance(false); }} />
                </div>
                <p className="text-xs text-muted-foreground">The {collectedBy === "Collector" ? "Collector" : "MAS"}&apos;s own money handed over for their Fidelity savings. It is added to this batch&apos;s total remittance and does not reduce incentives. There is no limit; the first ₱10,000 of savings is released only when the employee leaves, and anything above it can be withdrawn any time.</p>
              </div>
            </fieldset>
          </div>
        </CardContent>
      </Card>

      {/* MAIN TWO COLUMN AREA */}
      <div className="grid min-h-0 gap-4 lg:grid-cols-2">
        {/* LEFT COLLECTION PANEL */}
        <Card className="flex h-[calc(100vh-180px)] min-h-[34rem] flex-col overflow-hidden">
          <CardHeader className="shrink-0 border-b px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>
                  Collection Entries
                </CardTitle>

                <p className="mt-0.5 text-xs text-muted-foreground">
                  Add multiple collections under the
                  same accountable person and Date Remitted.
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
                      ? members.find(
                          (member) =>
                            member.id ===
                            entry.memberId,
                        ) ?? null
                      : null;

                  const entryProgram =
                    entry.programId
                      ? programs.find(
                          (program) =>
                            program.id ===
                            entry.programId,
                        ) ?? null
                      : null;

                  const entryPrograms = entryMember
                    ? programs.filter((program) => entryMember.programIds.includes(program.id))
                    : [];

                  const isActive =
                    activeCollectionId ===
                    entry.id;

                  return (
                    <div
                      key={entry.id}
                      ref={(element) => {
                        collectionRefs.current[entry.id] = element;
                      }}
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

                            <SearchSelect
                              aria-label="Member"
                              value={entry.memberId}
                              disabled={!branch || !mas}
                              placeholder={branch && mas ? "Type member name or number..." : "Select Branch and MAS first"}
                              emptyText="No matching member found."
                              options={members.map((member) => ({ value: member.id, label: getMemberFullName(member), description: [member.phMemberNumber, member.contactNumber].filter(Boolean).join(" · "), keywords: getMemberDisplayName(member) }))}
                              onSearchChange={(query) => { setActiveCollectionId(entry.id); void searchMembers(query); }}
                              onValueChange={(memberId) => {
                                if (memberId) { selectMember(entry.id, memberId); return; }
                                selectionVersions.current[entry.id] = (selectionVersions.current[entry.id] ?? 0) + 1;
                                updateCollection(entry.id, { memberSearch: "", memberId: "", programId: "", programSearch: "", accountStatus: "", temporarilySuspended: false, accountLoading: false, monthFrom: "", monthTo: "", nopFrom: null, nopTo: null });
                                setHistories((current) => ({ ...current, [entry.id]: [] }));
                              }}
                            />

                            {(!branch || !mas) && (
                              <p className="text-xs text-muted-foreground">Member results are limited to enrollments matching both the selected Branch and MAS.</p>
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

                                    {/* Details to check against the receipt so the payment goes to the right person. */}
                                    <p className="text-sm text-muted-foreground">
                                      Born: {entryMember.birthdate || "not recorded"}{entryMember.age !== null && entryMember.age !== undefined ? ` (age ${entryMember.age})` : ""}
                                      {entryMember.address?.houseBlockLot ? ` · ${entryMember.address.houseBlockLot}` : ""}
                                    </p>

                                    {(() => {
                                      const last = (histories[entry.id] ?? [])[0];
                                      return last ? <p className="text-sm text-muted-foreground">Last payment: OR {last.orNumber || "—"} on {last.orDate} · {formatCurrency(Number(last.amountCollected) || 0)} · NOP {last.nop}</p> : entry.programId && !entry.accountLoading ? <p className="text-sm text-muted-foreground">No payment recorded yet for this program.</p> : null;
                                    })()}
                                  </div>
                                </div>

                                <Badge>
                                  Member Selected
                                </Badge>
                              </div>
                              {(() => {
                                // Another member with the same name is the usual way a payment lands on the wrong person.
                                const nameKey = (member: Member) => `${member.name.firstName} ${member.name.surname}`.trim().toLowerCase().replace(/\s+/g, " ");
                                const twins = members.filter((member) => member.id !== entryMember.id && nameKey(member) === nameKey(entryMember));
                                return twins.length ? (
                                  <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                                    {twins.length + 1} members are named {getMemberFullName(entryMember)}. Check the member number and birthdate against the receipt: the other {twins.length === 1 ? "is" : "are"} {twins.map((member) => `${member.phMemberNumber || "no number"} (born ${member.birthdate || "?"})`).join(", ")}.
                                  </p>
                                ) : null;
                              })()}
                            </div>
                          )}

                          {/* PROGRAM */}
                          <div className="space-y-2">
                            <Label>Dayong Program *</Label>
                            <SearchSelect
                              aria-label="Dayong Program"
                              value={entry.programId}
                              disabled={!entry.memberId}
                              placeholder={entry.memberId ? "Search program code or name" : "Select a member first"}
                              emptyText="No enrolled program matches."
                              options={entryPrograms.map((program) => ({ value: program.id, label: `${program.code} - ${program.name}`, keywords: program.code }))}
                              onValueChange={(programId) => {
                                if (programId) { void selectProgram(entry.id, programId); return; }
                                selectionVersions.current[entry.id] = (selectionVersions.current[entry.id] ?? 0) + 1;
                                updateCollection(entry.id, { programSearch: "", programId: "", accountStatus: "", temporarilySuspended: false, accountLoading: false, monthFrom: "", monthTo: "", nopFrom: null, nopTo: null, amountCollected: "" });
                                setHistories((current) => ({ ...current, [entry.id]: [] }));
                              }}
                            />
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

                          <div className="rounded border p-3 text-sm">
                            Account status: <strong>{entry.accountLoading ? "Loading..." : entry.accountStatus || "Select a program"}</strong>
                            {entry.temporarilySuspended && <p className="text-amber-700">Temporarily suspended. Select Waiver under If Suspended.</p>}
                            {entry.accountStatus === "Forfeited" && <p className="text-red-600">Payments are blocked for this program.</p>}
                            {entry.temporarilySuspended && <label className="mt-2 block">If Suspended *<select className="ml-2 rounded border p-2" value={entry.ifSuspended} onChange={(e) => updateCollection(entry.id, { ifSuspended: e.target.value })}><option value="">Select</option><option value="Waiver">Waiver</option></select></label>}
                          </div>
                          {/* NOP */}
                          <div className="space-y-3">
                            <div>
                              <Label>
                                NOP
                              </Label>

                              <p className="text-xs text-muted-foreground">
                                Set automatically from the covered months and the account&apos;s history. For an NS account the New Sale is NOP 1, so the first collection starts at NOP 2.
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
                            <Label>Amount Collected</Label>
                            {(() => {
                              const program = programs.find((item) => item.id === entry.programId);
                              const locked = Boolean(program && !program.collectionAmountEditable);
                              // The exact remaining payoff, offered as a button so a locked amount is never typed.
                              const paid = (histories[entry.id] ?? []).reduce((sum, item) => sum + Math.round((Number(item.amountCollected) || 0) * 100), 0);
                              const payoff = program?.payBalanceTotal ? Math.max(0, Math.round(program.payBalanceTotal * 100) - paid) / 100 : 0;
                              const monthly = Math.round((program?.basePay ?? 0) * 100) * getMonthDifference(entry.monthFrom, entry.monthTo) / 100;
                              return <>
                                <Input type="number" min="0" step="0.01" readOnly={locked} className={locked ? "bg-muted/50" : undefined} value={entry.amountCollected} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateCollection(entry.id, { amountCollected: event.target.value })} placeholder="0.00" />
                                <p className="text-xs text-muted-foreground">{locked ? "Fixed by the program: covered months × monthly amount. An administrator can allow editing in Programs." : "Starts with covered months × monthly amount. Edit only when the receipt pays the program's exact remaining payoff balance."}</p>
                                {locked && payoff > monthly && monthly > 0 && (
                                  Number(entry.amountCollected) === payoff
                                    ? <button type="button" className="text-xs text-primary underline" onClick={() => updateCollection(entry.id, { amountCollected: monthly.toFixed(2) })}>Back to {formatCurrency(monthly)} (covered months)</button>
                                    : <button type="button" className="text-xs text-primary underline" onClick={() => updateCollection(entry.id, { amountCollected: payoff.toFixed(2) })}>Receipt pays the full remaining balance: use {formatCurrency(payoff)}</button>
                                )}
                              </>;
                            })()}
                            <div className="rounded border p-3 text-sm">
                              <strong>Incentive reference: {(() => { const quote = quoteEntry(entry); return "remittance" in quote ? formatCurrency(quote.remittance) : "Pending"; })()}</strong>
                              {quoteEntry(entry).error && <p className="mt-1 text-amber-700">{quoteEntry(entry).error}</p>}
                              <p className="text-xs text-muted-foreground">Calculated per NOP using the selected MAS or Collector incentive tier and mark up.</p>
                            </div>
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
                                {dateWarnings({ receiptDate: entry.orDate, dateRemitted, today: manilaNow().date }).map((warning) => <p key={warning} className="text-xs font-medium text-amber-800">⚠ {warning}</p>)}
                                {needsBackdateReason(entry.orDate) && (
                                  <div className="space-y-1">
                                    <Label className="text-xs text-amber-800">Reason for the late entry *</Label>
                                    <Input value={entry.backdateReason ?? ""} onChange={(event) => updateCollection(entry.id, { backdateReason: event.target.value })} placeholder="e.g. Receipt turned over late by the MAS" />
                                    <p className="text-xs text-muted-foreground">The OR date is more than a day old. Administrators review late entries.</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* COLLECTION DATE DISPLAY */}
                          <div className="rounded-lg border bg-muted/30 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium">
                                  Date Remitted
                                </p>

                                <p className="text-xs text-muted-foreground">
                                  Shared by this collection batch.
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

              {/* CONTROL TOTAL: typed from the MAS's turnover sheet before saving */}
              <div className="grid gap-2 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_220px] sm:items-center">
                <div>
                  <Label htmlFor="control-total">Control total from the turnover sheet *</Label>
                  <p className="text-xs text-muted-foreground">Type the total the MAS wrote on the turnover sheet, not the total shown here. The batch saves only when they match.</p>
                  {controlTotal !== "" && (() => { const problem = controlTotalProblem(controlTotal, collections.map((entry) => Number(entry.amountCollected) || 0)); return <p className={`mt-1 text-sm ${problem ? "text-red-700" : "text-emerald-700"}`}>{problem || "Matches the entries."}</p>; })()}
                </div>
                <Input id="control-total" type="number" min="0" step="0.01" value={controlTotal} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setControlTotal(event.target.value)} placeholder="0.00" />
              </div>

              {/* TOTALS: amount collected, incentives (less Fidelity), penalty, total remittance */}
              <RemittanceSummary collected={totalCollected} remittance={totalRemittance} fidelity={fidelityAmount} penalty={penaltyAmount} penaltyNote={penaltyNote.trim()} />

              <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_220px]">
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={autoApproveRemittance && isCashPayment}
                    disabled={totalDue === null || !isCashPayment}
                    onChange={(event) => {
                      setAutoApproveRemittance(event.target.checked);
                      if (event.target.checked) setCashReceived(String(cashCountTotal(cashCount)));
                      if (event.target.checked && !timeReceived) setTimeReceived(manilaNow().time);
                    }}
                  />
                  <span><strong>Cash received in full</strong><span className="block text-xs text-muted-foreground">{isCashPayment ? "Create and immediately approve the Remittance when the cash handed over equals the calculated amount." : `${paymentMethod || "Non-cash"} payments go to Remittances so Finance can verify the reference before approval.`}</span></span>
                </label>
                <div className="space-y-1">
                  <Label>Cash received</Label>
                  <Input type="number" min="0" step="0.01" value={cashReceived} readOnly className="bg-muted/50" disabled={!autoApproveRemittance || !isCashPayment} placeholder="0.00" />
                  <p className="text-xs text-muted-foreground">Calculated from the cash count.</p>
                  <Label className="pt-1">Time received</Label>
                  <Input type="time" value={timeReceived} disabled={!autoApproveRemittance || !isCashPayment} onChange={(event) => setTimeReceived(event.target.value)} />
                </div>
                {autoApproveRemittance && isCashPayment && (
                  <div className="sm:col-span-2">
                    <Label>Cash count</Label>
                    <CashCountInput value={cashCount} onChange={(value) => { setCashCount(value); setCashReceived(String(cashCountTotal(value))); }} />
                    <div className="mt-3 space-y-1">
                      <Label>Receipt photo for this batch *</Label>
                      <input type="file" accept="image/*" capture="environment" className="block text-sm" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setPhotoError(""); try { setReceiptPhoto(await compressReceiptPhoto(file)); } catch (error) { setReceiptPhoto(null); setPhotoError(error instanceof Error ? error.message : "Unable to read the photo."); } }} />
                      <p className="text-xs text-muted-foreground">{receiptPhoto ? `Photo ready (${Math.round(receiptPhoto.bytes / 1000)} KB). It is attached to every collection in this batch.` : "Approval needs a receipt photo; it is shrunk to under 80 KB before saving."}</p>
                      {photoError && <p className="text-xs text-red-700">{photoError}</p>}
                    </div>
                    {cashDue !== null && <p className={`mt-1 text-sm ${Math.round(cashCountTotal(cashCount) * 100) === Math.round(cashDue * 100) ? "text-emerald-700" : "text-muted-foreground"}`}>Cash due: {formatCurrency(cashDue)}</p>}
                  </div>
                )}
                {autoApproveRemittance && isCashPayment && lateIncentive > 0 && cashDue !== null && (
                  <p className="text-sm text-red-700 sm:col-span-2">
                    Incentive of {formatCurrency(lateIncentive)} is forfeited: the cash came in after 10:00 AM the day after the OR date
                    {collections[0]?.orDate ? ` (deadline ${formatDeadline(incentiveDeadline(collections[0].orDate))})` : ""}. Cash due is {formatCurrency(cashDue)}.

                  </p>
                )}
              </div>

              {/* SAVE / RESET */}
              <div className="space-y-3 border-t pt-4">
                {showPreview && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4"><p className="font-semibold">Review batch before saving</p><div className="mt-3 space-y-2">{collections.map((entry, index) => { const member = members.find((item) => item.id === entry.memberId); const program = programs.find((item) => item.id === entry.programId); const quote = quoteEntry(entry); return <div key={entry.id} className="rounded-lg border bg-background p-3 text-sm"><strong>Collection {index + 1}: {member ? getMemberFullName(member) : "No member"}</strong><p>{program?.name || "No program"} · {formatCurrency(Number(entry.amountCollected) || 0)}</p><p>{entry.monthFrom || "—"} to {entry.monthTo || "—"} · NOP {entry.nopFrom ?? "—"}–{entry.nopTo ?? "—"}</p><p>OR {entry.orNumber || "—"} · Calculated remittance {"remittance" in quote ? formatCurrency(quote.remittance) : "Pending"}</p></div>; })}</div><p className="mt-3 font-medium">Batch total: {formatCurrency(totalCollected)} · Remittance: {totalDue === null ? "Pending" : formatCurrency(totalDue)}{penaltyAmount > 0 ? ` (incl. ${formatCurrency(penaltyAmount)} penalty: ${penaltyNote.trim() || "no note yet"})` : ""}</p></div>}
                {saveMessage && (
                  <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
                    {saveMessage}
                  </div>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={() => showPreview ? void saveCollections() : setShowPreview(true)}
                    disabled={saving}
                  >
                    <Save className="mr-2 size-4" />

                    {saving
                      ? "Saving..."
                      : showPreview ? "Confirm and Save" : "Preview Collections"}
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
        <Card className="flex h-[calc(100vh-180px)] min-h-[34rem] flex-col overflow-hidden">
          <CardHeader className="shrink-0 border-b px-4 py-3">
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
