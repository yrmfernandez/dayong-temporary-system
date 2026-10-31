"use client";
import { alertDialog, confirmDialog, promptDialog } from "@/components/app-dialog";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { COLLECTION_CHECK_REMINDER } from "@/lib/entry-check-reminder";

import { ClearingPicker } from "@/components/clearing-picker";
import { DATE_REMITTED_REASON_MIN } from "@/lib/clearing-kinds";
import { enterToNextField } from "@/lib/enter-to-next";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
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
import { useParkedDrafts } from "@/lib/use-parked-drafts";
import { ParkedDrafts } from "@/components/parked-drafts";
import { manilaNow } from "@/lib/remittance-deadline";
import { useDeclaredNonWorkingDays } from "@/lib/use-work-calendar";
import { BACKDATE_REASON_MIN, controlTotalDifference, controlTotalProblem, lateCheckDay, needsBackdateReason, varianceLabel } from "@/lib/entry-controls";
import { ControlTotalField } from "@/components/control-total-field";
import { blockingDateProblem, dateWarnings } from "@/lib/date-checks";
import { ReceiptPhotosPicker, uploadBatchPhotos, type PickedPhoto } from "@/components/receipt-photos-picker";
import { RemittanceSummary } from "@/components/remittance-summary";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Member } from "@/lib/types";
import { calculateRemittance, NO_INCENTIVE_REASON_MIN, tiersForBranch, withoutIncentive, type IncentiveTier } from "@/lib/remittance";
import { forfeitedPaymentsAllowed } from "@/lib/account-rules";
import { isValidOrNumber, nextOrNumber, OR_NUMBER_EXAMPLE, orNumberProblem } from "@/lib/or-number";
import { formatDate as showDate, formatDateTime } from "@/lib/date-format";
import { formatDeadline } from "@/lib/remittance-deadline";

type CollectionChannel = "MAS" | "Collector" | "DTO";
type PaymentMethodOption = { id: string; name: string; isCash: boolean; requiresReference: boolean };
const collectionChannels: Array<{ value: CollectionChannel; label: string; hint: string }> = [
  { value: "MAS", label: "MAS", hint: "Collected by the assigned MAS" },
  { value: "Collector", label: "Collector", hint: "Collected on the MAS's behalf" },
  { value: "DTO", label: "DTO", hint: "Direct to Office" },
];
// Who collected decides the incentive: MAS → MAS tier, Collector → Collector tier, DTO → none, the gross is remitted.
const incentiveRoleFor = (channel: CollectionChannel) => channel === "Collector" ? "Collector" : channel === "DTO" ? "DTO" : "MAS";

type ProgramOption = {
  id: string;
  code: string;
  name: string;
  basePay: number;
  /** Flexible payments: basePay is the minimum; any amount from the minimum per month. */
  flexible?: boolean;
  maxMonthlyPayment?: number | null;
  payBalanceTotal?: number;
  /** Programs U: false (the default) locks the amount to covered months × base pay. */
  collectionAmountEditable?: boolean;
  incentiveTiers?: IncentiveTier[];
};

/** A batch a MAS submitted from the field, as /api/collection-submissions returns it (lib/collection-submissions.ts). */
type CollectionSubmissionSummary = {
  id: string; branchId: string; branch: string; masEmployeeId: string; mas: string; entryCount: number; totalAmount: number; totalIncentive: number; submittedAt: string; incentiveDeadline: string;
  /** Submitted, or Remitted: the clerk marked the cash received; clearingId and remittedAt ("YYYY-MM-DD HH:MM") are set. */
  status: "Submitted" | "Remitted"; clearingId: string; remittedAt: string; remittedByName: string;
  entries: Array<{ enrollmentId: string; memberId: string; memberNumber: string; memberName: string; programId: string; programName: string; months: number; amount: number; orDate: string; waiver: boolean }>;
};
/** The MAS submission open on the form: saving it marks it Saved; its handover must be this MAS's. */
type ReviewedSubmission = { id: string; masEmployeeId: string; mas: string; branch: string; clearingId: string; remittedAt: string };

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
  /** No incentive for the collector on this one, and why (owner, October 20, 2026): it is remitted whole. */
  noIncentive: boolean;
  noIncentiveReason: string;

  status: string;
  accountStatus: string;
  temporarilySuspended: boolean;
  /** When the account becomes suspended (lib/account-rules.ts); a Waiver is needed only when the OR date is on or after it. */
  suspendedAt?: string;
  collectedByRole: string;
  accountLoading: boolean;
  /** The account's next unpaid month and NOP when it was loaded, before this batch (see chainSameAccount). */
  accountNextMonth?: string;
  accountNextNop?: number | null;
  /** An earlier receipt for the same account in this batch has Waiver selected, so this one is not asked again (see chainSameAccount). */
  waiverAbove?: boolean;

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
    noIncentive: false,
    noIncentiveReason: "",

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
  return value ? showDate(value) : "—";
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

/** The month `count - 1` months after `from` ("YYYY-MM"): the last month covered by `count` months starting at `from`. */
function lastMonthCovered(from: string, count: number) {
  const [year, month] = from.split("-").map(Number);
  if (!year || !month || !Number.isInteger(count) || count < 1) return "";
  const index = year * 12 + (month - 1) + count - 1;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * Several receipts for one account in one batch (owner, October 23, 2026: a member pays several months on separate
 * ORs). The account's next month and NOP come from what is saved, so a second receipt for the same member and program
 * would repeat the first one's and the save was refused. In batch order, each receipt after the first for an account
 * starts the month and NOP after the previous one ends, keeping its number of months; the first starts where the
 * account stands. The server checks the batch's receipts in the same order (app/api/collections/route.ts).
 * A Waiver works the same way (owner, October 28, 2026): once Waiver is selected on a receipt, the later receipts for the
 * same account in the batch are not asked again.
 */
function chainSameAccount(list: CollectionEntry[]) {
  const ends = new Map<string, { month: string; nop: number }>();
  const waived = new Set<string>();
  let changed = false;
  const next = list.map((original) => {
    if (!original.memberId || !original.programId) return original;
    const key = `${original.memberId}|${original.programId}`;
    const waiverAbove = waived.has(key);
    if (original.ifSuspended === "Waiver") waived.add(key);
    let entry = original;
    if (Boolean(entry.waiverAbove) !== waiverAbove) { changed = true; entry = { ...entry, waiverAbove }; }
    if (entry.accountLoading || !entry.accountNextMonth || entry.accountNextNop == null) return entry;
    const before = ends.get(key);
    const startMonth = before ? lastMonthCovered(before.month, 2) : entry.accountNextMonth;
    const startNop = before ? before.nop + 1 : entry.accountNextNop;
    const count = entry.monthTo ? Math.max(1, getMonthDifference(entry.monthFrom, entry.monthTo)) : 0;
    let result = entry;
    if (entry.monthFrom !== startMonth || entry.nopFrom !== startNop) {
      changed = true;
      result = { ...entry, monthFrom: startMonth, nopFrom: startNop, monthTo: count ? lastMonthCovered(startMonth, count) : "", nopTo: count ? startNop + count - 1 : startNop };
    }
    ends.set(key, { month: result.monthTo || result.monthFrom, nop: result.nopTo ?? startNop });
    return result;
  });
  return changed ? next : list;
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

/**
 * A Waiver is needed only when the member paid on or after the day the account became suspended (the OR date, not the
 * day it is encoded; owner, October 14, 2026). Without a suspension date, today's state decides.
 */
const needsWaiver = (entry: { temporarilySuspended: boolean; suspendedAt?: string; orDate: string }) =>
  entry.suspendedAt ? Boolean(entry.orDate) && entry.orDate >= entry.suspendedAt : entry.temporarilySuspended;

export default function CollectionsPage() {
  const [branch, setBranch] = useState("");
  // Late dates skip Sundays and the branch's declared non-working days, as the server does (lib/working-days.ts).
  const offDays = useDeclaredNonWorkingDays();
  // Judged from the Date Remitted when it was changed with a reason (that reason covers the late encoding; lib/entry-controls.ts).
  const isLateDate = (date: string) => needsBackdateReason(date, lateCheckDay(dateRemitted, dateRemittedChanged ? dateRemittedReason : ""), { days: offDays, branch });
  const [mas, setMas] = useState("");
  const [dateRemitted, setDateRemitted] = useState("");

  const [collections, setCollectionsRaw] = useState<CollectionEntry[]>([
    createEmptyCollection("collection-1"),
  ]);
  // Every change to the entries passes through chainSameAccount: later receipts for the same account continue after
  // the earlier ones in this batch.
  const setCollections = useCallback((value: SetStateAction<CollectionEntry[]>) =>
    setCollectionsRaw((current) => chainSameAccount(typeof value === "function" ? value(current) : value)), []);

  const [activeCollectionId, setActiveCollectionId] =
    useState("collection-1");

  const [nextCollectionId, setNextCollectionId] = useState(2);
  const collectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [scrollTargetId, setScrollTargetId] = useState("");
  const [members, setMembers] = useState<CollectionMember[]>([]);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; territory?: string; status: string }>>([]);
  const [masStaff, setMasStaff] = useState<Array<{ employeeId: string; fullName: string; branchIds:string[] }>>([]);
  // The Clearing entry the batch was filled from (components/clearing-picker.tsx); its employee is the accountable one.
  const [cleared, setCleared] = useState<{ id: string; employeeId: string; employeeName: string; clearedDate?: string } | null>(null);
  // DTO batch (owner, October 13, 2026): members who paid at the office, e.g. of a resigned or inactive MAS. No clearing,
  // any account of the branch, and the clerk who received the cash is accountable (app/api/collections/route.ts).
  const [dto, setDto] = useState(false);
  // ORC defaults to No for each batch; Yes must be selected for a Collector batch.
  const [orc, setOrc] = useState(false);
  // A Date Remitted moved off the clearing day needs a reason (encoding delayed by meetings and the like; lib/clearing.ts).
  const [dateRemittedReason, setDateRemittedReason] = useState("");
  const dateRemittedChanged = Boolean(cleared?.clearedDate && dateRemitted && dateRemitted !== cleared.clearedDate);
  const [histories, setHistories] = useState<Record<string, CollectionHistory[]>>({});
  const selectionVersions = useRef<Record<string, number>>({});

  const [showMoreDetails, setShowMoreDetails] = useState(false);

  const [saveMessage, setSaveMessage] = useState("");

  const [saving, setSaving] = useState(false);
  // The total written on the MAS's turnover sheet; short or over still saves, recorded with the batch.
  const [controlTotal, setControlTotal] = useState("");
  // Optional note kept with a short or over turnover sheet (lib/turnover-variance.ts).
  const [controlTotalNote, setControlTotalNote] = useState("");
  // The batch's receipt photos: at least one, as many as needed (owner, October 14, 2026); attached right after saving.
  const [receiptPhotos, setReceiptPhotos] = useState<PickedPhoto[]>([]);
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
  // MAS submissions (owner, October 31, 2026): the Submitted by MAS tab lists them; Review opens one on the form.
  const [tab, setTab] = useState<"encode" | "submitted">("encode");
  const [reviewing, setReviewing] = useState<ReviewedSubmission | null>(null);
  const [submissionList, setSubmissionList] = useState<CollectionSubmissionSummary[]>([]);
  const [submissionError, setSubmissionError] = useState("");
  const [submissionRevision, setSubmissionRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/collection-submissions?view=review", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load MAS submissions.");
        setSubmissionList(result.submissions ?? []); setSubmissionError("");
      })
      .catch((error) => { if (!controller.signal.aborted) setSubmissionError(error instanceof Error ? error.message : "Unable to load MAS submissions."); });
    return () => controller.abort();
  }, [submissionRevision]);
  useLiveRefresh(["collection_submissions"], () => setSubmissionRevision((value) => value + 1));

  // The unsaved batch survives leaving the page and coming back (member search results included, so picks still show).
  const draftSnapshot = { dto, orc, branch, mas, dateRemitted, cleared, dateRemittedReason, collections, activeCollectionId, nextCollectionId, members, histories, collectedBy, paymentMethod, paymentReference, penalty, penaltyNote, fidelity, reviewing };
  type CollectionsDraft = typeof draftSnapshot;
  const restoreDraft = (draft: Partial<CollectionsDraft>) => {
      setDto(Boolean(draft.dto));
      setOrc(draft.orc === true);
      setBranch(draft.branch ?? "");
      setMas(draft.mas ?? "");
      setDateRemitted(draft.dateRemitted ?? "");
      setCleared(draft.cleared ?? null);
      setDateRemittedReason(draft.dateRemittedReason ?? "");
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
      setReviewing(draft.reviewing ?? null);
    };
  useFormDraft("collections", draftSnapshot, restoreDraft);
  // Batches set aside to finish later (owner, October 14, 2026; lib/use-parked-drafts.ts).
  const parked = useParkedDrafts<CollectionsDraft>("collections");
  const selectedPaymentMethod = paymentMethods.find((method) => method.name === paymentMethod);
  // A method marked cash, or named Cash, as the server counts it (cashMethodNames in lib/entry-batches.ts).
  const isCashPayment = Boolean(selectedPaymentMethod?.isCash) || paymentMethod.trim().toLowerCase() === "cash";

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

  // Every member under the chosen Branch and MAS, so the member field is a full list that typing narrows at once.
  const [membersLoading, setMembersLoading] = useState(false);
  useEffect(() => {
    if (dto || !branch || !mas) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows loading while this branch and MAS list arrives
    setMembersLoading(true);
    fetch(`/api/members?all=1&branch=${encodeURIComponent(branch)}&mas=${encodeURIComponent(mas)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        if (!result.success) return;
        // Keep members already chosen on a restored draft; add the rest of this MAS's list.
        setMembers((current) => [...new Map([...current, ...(result.members ?? [])].map((member: CollectionMember) => [member.id, member])).values()]);
      })
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setMembersLoading(false); });
    return () => controller.abort();
  }, [dto, branch, mas]);

  // DTO: members of the whole branch are searched as the clerk types (a branch can have thousands).
  const dtoSearch = useRef<{ timer?: ReturnType<typeof setTimeout>; controller?: AbortController }>({});
  function searchDtoMembers(query: string) {
    clearTimeout(dtoSearch.current.timer);
    dtoSearch.current.controller?.abort();
    if (!dto || !branch || query.trim().length < 2) return;
    dtoSearch.current.timer = setTimeout(() => {
      const controller = new AbortController();
      dtoSearch.current.controller = controller;
      setMembersLoading(true);
      fetch(`/api/members?dto=1&branch=${encodeURIComponent(branch)}&search=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json())
        .then((result) => { if (result.success) setMembers((current) => [...new Map([...current, ...(result.members ?? [])].map((member: CollectionMember) => [member.id, member])).values()]); })
        .catch(() => undefined)
        .finally(() => { if (!controller.signal.aborted) setMembersLoading(false); });
    }, 300);
  }

  /** Switches between a batch from Clearing and a DTO batch; the batch starts over. */
  function chooseBatchType(next: boolean) {
    if (next === dto) return;
    setDto(next);
    setReviewing(null);
    setCleared(null);
    setBranch("");
    setMas("");
    setDateRemitted(next ? manilaNow().date : "");
    setDateRemittedReason("");
    setCollectedBy(next ? "DTO" : "MAS");
    setOrc(false);
    setPenalty("");
    setPenaltyNote("");
    setFidelity("");
    clearScopedMemberSelections();
  }

  useEffect(() => {
    if (!scrollTargetId) return;

    collectionRefs.current[scrollTargetId]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    const frame = requestAnimationFrame(() => setScrollTargetId(""));
    return () => cancelAnimationFrame(frame);
  }, [collections, scrollTargetId]);

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

  const noIncentiveOn = (entry: CollectionEntry) => !dto && entry.noIncentive === true;
  function quoteEntry(entry: CollectionEntry) {
    try {
      const selected = programs.find((p) => p.id === entry.programId);
      const count = getMonthDifference(entry.monthFrom, entry.monthTo);
      // Name the one step still missing (owner, October 31, 2026: the old catch-all asked for the program when it was already selected).
      if (!selected) return { error: entry.memberId ? "Select the program." : "Select the member and program." };
      if (entry.accountLoading) return { error: "Loading the program account..." };
      if (!entry.monthFrom || entry.nopFrom == null) return { error: "The program account did not load. Select the program again." };
      if (count < 1) return { error: "Type the months paid." };
      if (entry.nopTo == null || entry.nopTo - entry.nopFrom + 1 !== count) return { error: "The NOP range does not match the months paid. Type the months paid again." };
      const quote = calculateRemittance(selected.basePay, tiersForBranch(selected.incentiveTiers ?? [], branches.find((item) => item.name === branch)?.id ?? ""), incentiveRoleFor(collectedBy), entry.nopFrom, entry.nopTo, Number(entry.amountCollected), selected.flexible, selected.maxMonthlyPayment, { orc: orc && !dto && collectedBy === "Collector", reactivation: entry.reactivation === "Yes" });
      // No incentive (owner, October 20, 2026): remitted whole, as the server saves it.
      return { ...quote, ...(noIncentiveOn(entry) ? { remittance: withoutIncentive(Number(entry.amountCollected), quote.remittance).remittance } : {}), error: "" };
    } catch (error) { return { error: error instanceof Error ? error.message : "Unable to calculate remittance." }; }
  }
  const quotes = collections.map(quoteEntry);
  const totalCollected = collections.reduce((sum, entry) => sum + Math.round(Number(entry.amountCollected || 0) * 100), 0) / 100;
  const totalRemittance = quotes.every((q) => "remittance" in q) ? quotes.reduce((sum, q) => sum + Math.round(("remittance" in q ? q.remittance : 0) * 100), 0) / 100 : null;
  const penaltyAmount = Math.max(0, Math.round((Number(penalty) || 0) * 100) / 100);
  const fidelityAmount = Math.max(0, Math.round((Number(fidelity) || 0) * 100) / 100);
  // The cash due is the company remittance plus Fidelity; a penalty is tracked separately.
  const totalDue = totalRemittance === null ? null : Math.round((totalRemittance + fidelityAmount) * 100) / 100;

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
      const response = await fetch(`/api/collections?memberId=${encodeURIComponent(memberId)}&programId=${encodeURIComponent(programId)}&branch=${encodeURIComponent(branch)}&mas=${encodeURIComponent(mas)}${dto ? "&dto=1" : ""}`, { cache: "no-store" });
      const result = await response.json();
      if (selectionVersions.current[entryId] !== version) return;
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load account.");
      const account = result.account;
      setHistories((current) => ({ ...current, [entryId]: result.history ?? [] }));
      updateCollection(entryId, { accountStatus: account.status, temporarilySuspended: account.temporarilySuspended, suspendedAt: account.suspendedAt ?? "", accountLoading: false,
        amountCollected: String(account.monthlyAmount), monthFrom: account.nextMonth, monthTo: account.nextMonth, nopFrom: account.nextNop, nopTo: account.nextNop,
        accountNextMonth: account.nextMonth, accountNextNop: account.nextNop });
    } catch (error) {
      if (selectionVersions.current[entryId] !== version) return;
      updateCollection(entryId, { accountLoading: false, accountStatus: "" });
      setSaveMessage(error instanceof Error ? error.message : "Unable to load account.");
    }
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

  /**
   * Months paid (owner, October 9, 2026): the first month is the account's next unpaid month (set when the program is
   * chosen), so the encoder types only how many months the receipt pays; the last month, NOP and amount follow.
   */
  function updateMonthCount(entryId: string, value: string) {
    const entry = collections.find((item) => item.id === entryId);
    if (!entry || !entry.monthFrom) return;
    const count = Math.floor(Number(value));
    if (!value || !Number.isFinite(count) || count < 1) {
      updateCollection(entryId, { monthTo: "", amountCollected: "", nopTo: entry.nopFrom });
      return;
    }
    updateMonthTo(entryId, lastMonthCovered(entry.monthFrom, Math.min(count, 120)));
  }

  function validateEntry(
    entry: CollectionEntry,
  ) {
    const quote = quoteEntry(entry);
    if (quote.error) return quote.error;
    if (entry.accountLoading || !entry.accountStatus) return "Load the program account before saving.";
    // Payments on forfeited accounts are allowed only on the owner's chosen days (lib/account-rules.ts).
    if (entry.accountStatus === "Forfeited" && !forfeitedPaymentsAllowed()) return "This program account is forfeited. Payments are blocked.";
    if (needsWaiver(entry) && !entry.waiverAbove && entry.ifSuspended !== "Waiver") return "The account was suspended on the OR date. Select Waiver under If Suspended.";
    const rate = programs.find((p) => p.id === entry.programId)?.basePay ?? 0;
    const months = getMonthDifference(entry.monthFrom, entry.monthTo);
    if (months < 1 || Number(entry.amountCollected) * 100 < Math.round(rate * 100) * months) return "Amount must cover every selected full monthly installment.";
    if (!branch) return "Branch is required.";

    if (!dto && !mas) return "MAS is required.";
    if (orc && !dto && collectedBy === "Collector" && entry.reactivation === "Yes") return "A reactivation cannot be in an ORC batch. Set ORC to No, or encode the reactivation in its own batch.";
    if (noIncentiveOn(entry) && (entry.noIncentiveReason ?? "").trim().length < NO_INCENTIVE_REASON_MIN) return "Give the reason this collection earns no incentive.";

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

    if (orNumberProblem(entry.orNumber)) {
      return orNumberProblem(entry.orNumber);
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

    if (isLateDate(entry.orDate) && (entry.backdateReason ?? "").trim().length < BACKDATE_REASON_MIN) {
      return "The OR date is more than one working day old. Enter the reason it is being encoded late.";
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

    // The next OR number follows the last entry's, letter kept (owner, October 19, 2026); the clerk can change it, and
    // the entry after that follows the changed one.
    setCollections((current) => [
      ...current,
      // The OR date too: the same as the last entry's (owner, October 19, 2026; 1,144 of 1,191 entries in a batch share it).
      { ...createEmptyCollection(newId), orNumber: nextOrNumber(current.at(-1)?.orNumber ?? ""), orDate: current.at(-1)?.orDate ?? "" },
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

    if (!dto && !mas) {
      setSaveMessage("Please select a MAS.");
      return;
    }

    if (!dateRemitted) {
      setSaveMessage(
        "Please enter the Date Remitted.",
      );
      return;
    }

    if (dateRemittedChanged && dateRemittedReason.trim().length < DATE_REMITTED_REASON_MIN) {
      setSaveMessage("The Date Remitted is not the day they were cleared. Enter the reason it was changed.");
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

    // Cash needs no photo (owner, October 16, 2026): it was counted at Clearing and goes straight to approval.
    if (!receiptPhotos.length && !isCashPayment) {
      setSaveMessage("Add at least one receipt photo for this batch.");
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

    const controlProblem = controlTotalProblem(controlTotal, totalDue);
    if (controlProblem) {
      setSaveMessage(controlProblem);
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
          accountableEmployeeId: (cleared?.employeeName === mas ? cleared.employeeId : "") || (masStaff.find((staff) => staff.fullName === mas)?.employeeId ?? ""),
          dateRemitted,
          dateRemittedReason: dateRemittedChanged ? dateRemittedReason.trim() : "",
          // The handover picked in From Clearing: its time decides the incentive (lib/clearing.ts).
          clearingId: !dto && cleared?.employeeName === mas ? cleared.id : "",
          // A batch the MAS submitted (lib/collection-submissions.ts): marked Saved with these collections.
          submissionId: !dto && reviewing ? reviewing.id : undefined,
          dto,
          orc: orc && !dto && collectedBy === "Collector",
          collectedBy: dto ? "DTO" : collectedBy,
          paymentMethod,
          paymentReference: selectedPaymentMethod && !selectedPaymentMethod.isCash ? paymentReference.trim() : "",
          // Saved first; the approved remittance is created below once the receipt photo is attached.
          autoApproveRemittance: false,
          controlTotal: Number(controlTotal),
          controlTotalNote: controlTotalNote.trim(),
          penalty: penaltyAmount,
          penaltyNote: penaltyAmount > 0 ? penaltyNote.trim() : "",
          fidelityAmount,
          collections: collections.map((entry) => ({
            ...entry,
            // Covered by the Waiver on an earlier receipt for the same account; saved with it on record.
            ifSuspended: entry.waiverAbove && !entry.ifSuspended ? "Waiver" : entry.ifSuspended,
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

      // Attach every receipt photo; the first one sends a bank or e-wallet batch to Pending Approval.
      const ids: string[] = result.collectionIds ?? [];
      const uploaded = await uploadBatchPhotos(ids, receiptPhotos);
      if (reviewing) setSubmissionRevision((value) => value + 1);
      resetForm();
      setSaveMessage(uploaded.problem
        ? `${ids.length} collection(s) saved; ${uploaded.saved} of ${receiptPhotos.length} receipt photo(s) attached. ${uploaded.problem} Add the rest in My Entries.`
        : `${ids.length} collection(s) saved${uploaded.saved ? ` with ${uploaded.saved} receipt photo(s)` : ""}. ${result.message}`);
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
    setCleared(null);
    setDateRemittedReason("");
    setCollections([firstCollection]);
    setActiveCollectionId("collection-1");
    setNextCollectionId(2);
    setShowMoreDetails(false);
    setSaveMessage("");
    setShowPreview(false);
    setControlTotal("");
    setControlTotalNote("");
    setReceiptPhotos([]);
    setPenalty("");
    setPenaltyNote("");
    setFidelity("");
    setCollectedBy(dto ? "DTO" : "MAS");
    setOrc(false);
    if (dto) setDateRemitted(manilaNow().date);
    setPaymentMethod(paymentMethods.find((method) => method.isCash)?.name || paymentMethods[0]?.name || "");
    setPaymentReference("");
    setReviewing(null);
  }

  /**
   * Opens a MAS submission on the form: Branch, MAS and Collected by MAS are set, and each member's account is loaded
   * fresh, so the months start at its next unpaid month and run for the months the MAS entered. The clerk then picks the
   * MAS's handover in From Clearing, types each OR number, checks everything and saves.
   */
  async function openSubmission(submission: CollectionSubmissionSummary) {
    if (batchHasWork && reviewing?.id !== submission.id && !await confirmDialog("Replace the batch on the form with this MAS submission? Unsaved entries on the form are lost.")) return;
    resetForm();
    setDto(false);
    setDateRemitted("");
    setBranch(submission.branch);
    setMas(submission.mas);
    setCollectedBy("MAS");
    setReviewing({ id: submission.id, masEmployeeId: submission.masEmployeeId, mas: submission.mas, branch: submission.branch, clearingId: submission.clearingId, remittedAt: submission.remittedAt });
    // Marked remitted: saved under the clearing recorded then. The Date Remitted starts on that day and can still be
    // changed with a reason (no work, day off, on leave...), as for any batch.
    if (submission.clearingId) {
      const clearedDate = submission.remittedAt.slice(0, 10);
      setCleared({ id: submission.clearingId, employeeId: submission.masEmployeeId, employeeName: submission.mas, clearedDate });
      setDateRemitted(clearedDate);
    }
    setTab("encode");
    setSaveMessage(`Loading ${submission.entryCount} member(s) from ${submission.mas}...`);
    const loaded = await Promise.all(submission.entries.map(async (item, index) => {
      const id = `collection-${index + 1}`;
      const program = programs.find((candidate) => candidate.id === item.programId);
      const base: CollectionEntry = { ...createEmptyCollection(id), memberId: item.memberId, memberSearch: item.memberName, programId: item.programId, programSearch: program?.code ?? item.programName, orDate: item.orDate, ifSuspended: item.waiver ? "Waiver" : "", isExpanded: index === 0 };
      try {
        const response = await fetch(`/api/collections?memberId=${encodeURIComponent(item.memberId)}&programId=${encodeURIComponent(item.programId)}&branch=${encodeURIComponent(submission.branch)}&mas=${encodeURIComponent(submission.mas)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load account.");
        const account = result.account;
        return { entry: { ...base, accountStatus: account.status, temporarilySuspended: account.temporarilySuspended, suspendedAt: account.suspendedAt ?? "",
          monthFrom: account.nextMonth, monthTo: lastMonthCovered(account.nextMonth, item.months), nopFrom: account.nextNop, nopTo: account.nextNop + item.months - 1,
          amountCollected: (Math.round(account.monthlyAmount * 100) * item.months / 100).toFixed(2), accountNextMonth: account.nextMonth, accountNextNop: account.nextNop }, history: result.history ?? [], problem: "" };
      } catch (error) {
        return { entry: base, history: [], problem: `${item.memberName}: ${error instanceof Error ? error.message : "Unable to load account."}` };
      }
    }));
    setCollections(loaded.map((item) => item.entry));
    setHistories(Object.fromEntries(loaded.map((item) => [item.entry.id, item.history])));
    setActiveCollectionId("collection-1");
    setNextCollectionId(loaded.length + 1);
    const problems = loaded.map((item) => item.problem).filter(Boolean);
    setSaveMessage(problems.length ? problems.join(" ") : submission.clearingId
      ? `Reviewing ${submission.mas}'s batch, remitted at ${submission.remittedAt.slice(11)}. Type each OR number, correct anything wrong, then save.`
      : `Reviewing ${submission.mas}'s submission. Pick their handover in From Clearing, type each OR number, correct anything wrong, then save.`);
  }

  /**
   * Mark remitted (owner, October 31, 2026): the MAS handed the cash over, so the time is recorded now (a Clearing for the
   * MAS) and decides the incentive; the OR numbers can be typed later. Already cleared today: asks whether it is the same
   * cash or a new handover.
   */
  async function markRemitted(submission: CollectionSubmissionSummary) {
    const remit = Math.round((submission.totalAmount - submission.totalIncentive) * 100) / 100;
    if (!await confirmDialog(`Mark ${submission.mas}'s batch remitted now (${formatCurrency(remit)} to remit)? Only once the cash is in your hands: this time decides the incentive.`)) return;
    const send = (handover = "") => fetch("/api/collection-submissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remit", id: submission.id, handover }) })
      .then(async (response) => ({ response, result: await response.json() }));
    let { response, result } = await send();
    if (response.status === 409 && result.code === "ALREADY_CLEARED") {
      const handover = await confirmDialog(`${result.message}\n\nIs this cash part of that handover?`) ? "same"
        : await confirmDialog("Record it as a new handover of cash now?") ? "new" : "";
      if (!handover) return;
      ({ response, result } = await send(handover));
    }
    if (!response.ok || !result.success) { setSubmissionError(result.message || "Unable to mark it remitted."); return; }
    setSubmissionError(""); setSaveMessage(result.message);
    setSubmissionRevision((value) => value + 1);
  }

  /** Rejects a MAS batch that should not be saved at all; mistakes are corrected on the form instead. */
  async function rejectSubmission(submission: CollectionSubmissionSummary) {
    const reason = (await promptDialog(`Why reject ${submission.mas}'s batch? Only for one that should not be saved (for example the cash was not remitted); fix mistakes with Review instead. ${submission.mas} sees the reason and can submit those members again.`, { required: true }))?.trim();
    if (!reason) return;
    const response = await fetch("/api/collection-submissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: submission.id, reason }) });
    const result = await response.json();
    if (!response.ok || !result.success) { setSubmissionError(result.message || "Unable to reject the submission."); return; }
    if (reviewing?.id === submission.id) resetForm();
    setSubmissionRevision((value) => value + 1);
  }

  // Set aside / resume (owner, October 14, 2026): a batch with anything in it can be set aside; resuming a draft sets
  // the open batch aside first, so nothing is lost.
  const batchHasWork = Boolean(cleared || branch) || collections.some((entry) => entry.memberId || entry.orNumber);
  const draftLabel = () => `${dto ? "DTO" : mas || "No MAS"} · ${branch || "no branch"} · ${collections.filter((entry) => entry.memberId).length} entr${collections.filter((entry) => entry.memberId).length === 1 ? "y" : "ies"}`;
  function parkBatch() {
    if (!batchHasWork) return;
    parked.park(draftLabel(), draftSnapshot);
    resetForm();
    setSaveMessage("Batch set aside. Resume it from Drafts.");
  }
  function resumeBatch(id: string) {
    const data = parked.swap(id, batchHasWork ? { label: draftLabel(), data: draftSnapshot } : undefined);
    if (!data) return;
    resetForm();
    restoreDraft(data);
    setSaveMessage(batchHasWork ? "Draft resumed; the batch you had open was set aside." : "Draft resumed.");
  }

  return (
    // Enter moves to the next field (lib/enter-to-next.ts).
    <div className="space-y-4" onKeyDown={enterToNextField}>
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-end justify-between gap-2 rounded-xl page-hero px-5 py-3">
        <div><h1 className="text-xl font-semibold tracking-tight">
          Collections
        </h1>

        <p className="text-xs text-violet-30/80">
          Record member payments and assign cash accountability.
        </p></div><Badge variant="secondary">{collections.length} {collections.length===1?"entry":"entries"}</Badge>
      </div>

      <div role="tablist" aria-label="Collections" className="inline-flex rounded-lg border bg-muted/40 p-1">
        <button type="button" role="tab" aria-selected={tab === "encode"} className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === "encode" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setTab("encode")}>Encode</button>
        <button type="button" role="tab" aria-selected={tab === "submitted"} className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === "submitted" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setTab("submitted")}>
          Submitted by MAS{submissionList.length ? <Badge className="ml-2">{submissionList.length}</Badge> : null}
        </button>
      </div>
      {submissionError && <p role="alert" className="text-sm text-destructive">{submissionError}</p>}

      {tab === "submitted" ? <CollectionSubmissionList submissions={submissionList} activeId={reviewing?.id ?? ""} onOpen={(submission) => void openSubmission(submission)} onReject={(submission) => void rejectSubmission(submission)} onRemit={(submission) => void markRemitted(submission)} onRefresh={() => setSubmissionRevision((value) => value + 1)} /> : <>
      {reviewing && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>Reviewing a submission from {reviewing.mas} ({reviewing.branch}). Pick their handover in From Clearing (save only once the cash is received), type each OR number, and correct anything wrong here: months, amount, Waiver, or remove a member. The MAS cannot change it.</p>
          <Button type="button" variant="outline" size="sm" onClick={resetForm}>Stop reviewing</Button>
        </div>
      )}
      <ParkedDrafts drafts={parked.drafts} canPark={batchHasWork} onPark={parkBatch} onResume={resumeBatch} onDelete={parked.remove} />

      {/* COLLECTION BATCH HEADER */}
      <Card><CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Collection Batch</p>
            <div role="radiogroup" aria-label="Batch type" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/50 p-1 text-sm">
              {([[false, "From Clearing (MAS / Collector)"], [true, "DTO: paid at the office"]] as const).map(([value, label]) => (
                <button key={label} type="button" role="radio" aria-checked={dto === value} onClick={() => chooseBatchType(value)}
                  className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${dto === value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
              ))}
            </div>
          </div>
          {dto ? (
            <p className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              Members who paid at the office, for example when their MAS resigned or is inactive. No clearing is needed: you received the cash, so you are accountable for it. Any account of the branch can be paid; it keeps its MAS on record. DTO earns no incentive, so the whole payment is remitted.
            </p>
          ) : (
          <div className="mb-4"><ClearingPicker kind="Collections" value={cleared?.id ?? ""} onPick={(clearing) => {
            // Reviewing a MAS submission: only that MAS's handover, and the loaded entries stay.
            if (reviewing) {
              if (reviewing.clearingId && clearing.id !== reviewing.clearingId) { setSaveMessage(`This batch was marked remitted at ${reviewing.remittedAt.slice(11)}; it stays on that handover. Change the Date Remitted with a reason if needed.`); return; }
              if (clearing.employeeId !== reviewing.masEmployeeId || clearing.branch.trim().toLowerCase() !== reviewing.branch.trim().toLowerCase()) { setSaveMessage(`This batch was submitted by ${reviewing.mas} (${reviewing.branch}). Pick their handover.`); return; }
              setCleared({ id: clearing.id, employeeId: clearing.employeeId, employeeName: clearing.employeeName, clearedDate: clearing.clearedDate });
              setMas(clearing.employeeName); setDateRemitted(clearing.clearedDate); setDateRemittedReason("");
              return;
            }
            setCleared({ id: clearing.id, employeeId: clearing.employeeId, employeeName: clearing.employeeName, clearedDate: clearing.clearedDate });
            setBranch(clearing.branch); setMas(clearing.employeeName); setDateRemitted(clearing.clearedDate); setDateRemittedReason(""); setOrc(false); clearScopedMemberSelections();
            // A Collector (role Collector, not MAS) collects as Collector by default; the clerk can still change it (owner, October 14, 2026).
            const roles = (clearing.employeeRoles ?? []).map((role) => role.trim().toLowerCase());
            setCollectedBy(roles.includes("collector") && !roles.includes("mas") ? "Collector" : "MAS");
          }} /></div>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Branch *</Label>

              <SearchSelect aria-label="Branch" value={branch} disabled={!dto} placeholder={dto ? "Search branch" : "From Clearing"} options={branches.filter((item) => !dto || item.status === "active").map((item) => ({ value: item.name, label: item.name, description: item.territory || "Unassigned territory" }))} onValueChange={(value) => { setBranch(value); setMas(""); clearScopedMemberSelections(); }}/>
            </div>

            <div className="space-y-2">
              <Label>{dto ? "Accountable" : "MAS *"}</Label>

              {dto ? (
                <p className="flex h-8 items-center rounded-lg border bg-muted/40 px-2.5 text-sm">You (the clerk who received the cash) · DTO</p>
              ) : <SearchSelect aria-label="MAS" value={mas} placeholder="From Clearing" disabled options={masStaff.filter((staff) => { const branchId=branches.find((item) => item.name === branch)?.id; return Boolean(branchId && staff.branchIds.includes(branchId)); }).map((staff) => ({ value: staff.fullName, label: staff.fullName, description: staff.employeeId }))} onValueChange={(value) => { setMas(value); clearScopedMemberSelections(); }}/>}
            </div>

            <div className="space-y-2">
              <Label>Date Remitted *</Label>

              {/* Branch and MAS come only from Clearing (owner, October 12, 2026). The Date Remitted starts on the clearing day
                  and can be changed with a reason, since encoding can wait for meetings and the like (owner, October 13, 2026). */}
              <Input type="date" value={dateRemitted} disabled={!dto && !cleared} max={manilaNow().date} aria-label="Date Remitted" onChange={(event) => setDateRemitted(event.target.value)} />

              <p className="text-xs text-muted-foreground">{dto ? "The day the member paid at the office. Shared by every entry in this batch." : "Shared by every entry in this batch. Starts on the day they were cleared; Branch and MAS come from Clearing."}</p>

              {dateRemittedChanged && (
                <div className="space-y-1">
                  <Label className="text-xs text-amber-800">Why was the Date Remitted changed? *</Label>
                  <Input aria-label="Reason for changing the Date Remitted" value={dateRemittedReason} maxLength={300} onChange={(event) => setDateRemittedReason(event.target.value)} placeholder="e.g. No work, day off, on leave, or encoding delayed by a meeting" />
                  <p className="text-xs text-muted-foreground">Cleared on {cleared?.clearedDate}. The reason is kept with every entry of the batch.</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-3">
            {!dto && <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Collected by *</legend>
              <div role="radiogroup" aria-label="Collected by" className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/50 p-1">
                {collectionChannels.map((channel) => (
                  <button key={channel.value} type="button" role="radio" aria-checked={collectedBy === channel.value} title={channel.hint}
                    disabled={Boolean(reviewing) && channel.value !== "MAS"}
                    onClick={() => { if (channel.value !== collectedBy) setOrc(false); setCollectedBy(channel.value); }}
                    className={`rounded-md px-2 py-1.5 text-sm font-semibold transition-colors ${collectedBy === channel.value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                    {channel.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{collectionChannels.find((channel) => channel.value === collectedBy)?.hint}. Applies to every entry; DTO uses the current MAS incentive.</p>
            </fieldset>}

            {!dto && collectedBy === "Collector" && <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">ORC (outright commission)</legend>
              <div role="radiogroup" aria-label="ORC" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/50 p-1">
                {([[false, "No"], [true, "Yes"]] as const).map(([value, label]) => (
                  <button key={label} type="button" role="radio" aria-checked={orc === value} onClick={() => setOrc(value)}
                    className={`rounded-md px-2 py-1.5 text-sm font-semibold transition-colors ${orc === value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{orc ? "Yes: the Collector earns half of the MAS incentive; the other half goes to the remittance. No reactivation in this batch." : "No: the Collector earns the Collector incentive."}</p>
            </fieldset>}

            <div className="space-y-2">
              <Label htmlFor="payment-method">Remittance Method *</Label>
              <select id="payment-method" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setPaymentReference(""); }}>
                {!paymentMethods.length && <option value="">No remittance methods configured</option>}
                {paymentMethods.map((method) => <option key={method.id} value={method.name}>{method.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">How the MAS remitted this batch to the office.</p>
            </div>

            {selectedPaymentMethod && !isCashPayment ? (
              <div className="space-y-2">
                <Label htmlFor="payment-reference">{selectedPaymentMethod.name} reference no. (optional)</Label>
                <Input id="payment-reference" maxLength={100} value={paymentReference} placeholder="Transaction / deposit slip number" onChange={(event) => setPaymentReference(event.target.value)} />
                <p className="text-xs text-muted-foreground">Not required: attach the receipt or transfer screenshot in My Entries instead.</p>
              </div>
            ) : (
              <div className="flex items-center rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Physical cash: an approver checks it against the receipt photo.
              </div>
            )}

            {!dto && <fieldset className={`space-y-2 rounded-lg border p-3 md:col-span-3 ${penaltyAmount > 0 ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20" : ""}`}>
              <legend className="px-1 text-sm font-medium">Remittance penalty (optional)</legend>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="penalty-amount">Penalty amount</Label>
                  <Input id="penalty-amount" type="number" min="0" step="0.01" value={penalty} placeholder="0.00" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => { setPenalty(event.target.value); }} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="penalty-note">What is the penalty for?{penaltyAmount > 0 ? " *" : ""}</Label>
                  <Input id="penalty-note" maxLength={300} value={penaltyNote} disabled={penaltyAmount <= 0} placeholder={penaltyAmount > 0 ? "e.g. Late turnover: collections held 5 days past schedule" : "Enter a penalty amount first"} onChange={(event) => setPenaltyNote(event.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Charged to the {collectedBy === "Collector" ? "Collector" : "MAS"}, paid from their own money, and added to this batch&apos;s total remittance. Members are not charged.</p>
            </fieldset>}

            {!dto && <fieldset className="space-y-2 rounded-lg border p-3 md:col-span-3">
              <legend className="px-1 text-sm font-medium">Fidelity (optional)</legend>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor="fidelity-amount">Fidelity amount</Label>
                  <Input id="fidelity-amount" type="number" min="0" step="0.01" value={fidelity} placeholder="0.00" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => { setFidelity(event.target.value); }} />
                </div>
                <p className="text-xs text-muted-foreground">The {collectedBy === "Collector" ? "Collector" : "MAS"}&apos;s own money handed over for their Fidelity savings. It is added to this batch&apos;s total remittance and does not reduce incentives. There is no limit; the first ₱10,000 of savings is released only when the employee leaves, and anything above it can be withdrawn any time.</p>
              </div>
            </fieldset>}
          </div>
        </CardContent>
      </Card>

      {/* MAIN TWO COLUMN AREA */}
      <div className="grid min-h-0 gap-4 lg:grid-cols-2">
        {/* LEFT COLLECTION PANEL */}
        <Card className="receipt-entry-card flex h-[calc(100vh-180px)] min-h-[34rem] flex-col overflow-clip">
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

          {/* overscroll-contain: reaching the end of one panel never scrolls the page or the other panel. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                        <div className="space-y-3 p-3">
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
                              Member *
                            </Label>

                            <SearchSelect
                              aria-label="Member"
                              value={entry.memberId}
                              disabled={!branch || (!dto && !mas)}
                              placeholder={dto ? (!branch ? "Select the branch first" : "Type 2+ letters of the name or PH number") : !branch || !mas ? "Select Branch and MAS first" : membersLoading ? "Loading this MAS's members..." : "Choose or type member name or number"}
                              emptyText={membersLoading ? "Loading members..." : dto ? "Type at least 2 letters; no member of this branch matches yet." : "No member of this MAS matches."}
                              onSearchChange={dto ? searchDtoMembers : undefined}
                              limit={1000}
                              options={members.map((member) => ({ value: member.id, label: getMemberFullName(member), description: [member.phMemberNumber, member.contactNumber].filter(Boolean).join(" · "), keywords: getMemberDisplayName(member) }))}
                              onValueChange={(memberId) => {
                                if (memberId) { selectMember(entry.id, memberId); return; }
                                selectionVersions.current[entry.id] = (selectionVersions.current[entry.id] ?? 0) + 1;
                                updateCollection(entry.id, { memberSearch: "", memberId: "", programId: "", programSearch: "", accountStatus: "", temporarilySuspended: false, accountLoading: false, monthFrom: "", monthTo: "", nopFrom: null, nopTo: null });
                                setHistories((current) => ({ ...current, [entry.id]: [] }));
                              }}
                            />

                            {!dto && (!branch || !mas) && (
                              <p className="text-xs text-muted-foreground">Member results are limited to enrollments matching both the selected Branch and MAS.</p>
                            )}
                            {dto && <p className="text-xs text-muted-foreground">Any member with an active account in this branch, whatever their MAS.</p>}
                          </div>

                          {/* SELECTED MEMBER: the details to check against the receipt, in two lines. */}
                          {entryMember && (
                            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                              <p><strong>{getMemberDisplayName(entryMember)}</strong> <span className="text-muted-foreground">· {entryMember.phMemberNumber}{entryMember.contactNumber ? ` · ${entryMember.contactNumber}` : ""}</span></p>
                              {/* Details to check against the receipt so the payment goes to the right person. */}
                              <p className="text-xs text-muted-foreground">
                                Born {showDate(entryMember.birthdate) || "not recorded"}{entryMember.age !== null && entryMember.age !== undefined ? ` (age ${entryMember.age})` : ""}
                                {entryMember.address?.houseBlockLot ? ` · ${entryMember.address.houseBlockLot}` : ""}
                                {(() => {
                                  const last = (histories[entry.id] ?? [])[0];
                                  return last ? ` · Last paid OR ${last.orNumber || "—"} on ${showDate(last.orDate)}, ${formatCurrency(Number(last.amountCollected) || 0)}, NOP ${last.nop}` : entry.programId && !entry.accountLoading ? " · No payment yet for this program" : "";
                                })()}
                              </p>
                              {(() => {
                                // Another member with the same name is the usual way a payment lands on the wrong person.
                                const nameKey = (member: Member) => `${member.name.firstName} ${member.name.surname}`.trim().toLowerCase().replace(/\s+/g, " ");
                                const twins = members.filter((member) => member.id !== entryMember.id && nameKey(member) === nameKey(entryMember));
                                return twins.length ? (
                                  <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                                    {twins.length + 1} members are named {getMemberFullName(entryMember)}. Check the member number and birthdate against the receipt: the other {twins.length === 1 ? "is" : "are"} {twins.map((member) => `${member.phMemberNumber || "no number"} (born ${showDate(member.birthdate) || "?"})`).join(", ")}.
                                  </p>
                                ) : null;
                              })()}
                            </div>
                          )}

                          {/* RECEIPT FIELDS (October 9, 2026): program, months, amount and OR side by side, in typing order. */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2 space-y-1">
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
                            <div className="col-span-2 space-y-1">
                              <Label htmlFor={`months-${entry.id}`}>Months paid *</Label>
                              <div className="flex flex-wrap items-center gap-3">
                                <Input id={`months-${entry.id}`} type="number" min={1} max={120} step={1} className="w-28" disabled={!entry.monthFrom} value={entry.monthTo ? getMonthDifference(entry.monthFrom, entry.monthTo) || "" : ""} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateMonthCount(entry.id, event.target.value)} placeholder={entry.monthFrom ? "1" : "Program first"} />
                                <span className="text-sm text-muted-foreground">
                                  {entry.monthFrom ? <>Covers <strong className="text-foreground">{formatMonth(entry.monthFrom)}{entry.monthTo && entry.monthTo !== entry.monthFrom ? ` – ${formatMonth(entry.monthTo)}` : ""}</strong> {entry.accountNextMonth && entry.monthFrom !== entry.accountNextMonth ? "(continues after the earlier receipt for this account in this batch)" : "(next unpaid month onward)"}</> : "Starts at the account's next unpaid month."}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* AMOUNT AND OR */}
                          {(() => {
                            const program = programs.find((item) => item.id === entry.programId);
                            // A flexible program takes any amount from its minimum, so its amount is never locked.
                            const locked = Boolean(program && !program.collectionAmountEditable && !program.flexible);
                            // The exact remaining payoff, offered as a button so a locked amount is never typed.
                            const paid = (histories[entry.id] ?? []).reduce((sum, item) => sum + Math.round((Number(item.amountCollected) || 0) * 100), 0);
                            const payoff = program?.payBalanceTotal ? Math.max(0, Math.round(program.payBalanceTotal * 100) - paid) / 100 : 0;
                            const monthly = Math.round((program?.basePay ?? 0) * 100) * getMonthDifference(entry.monthFrom, entry.monthTo) / 100;
                            return (
                              <div className="space-y-2">
                                <div className="grid grid-cols-3 gap-3">
                                  <div className="space-y-1">
                                    <Label title={locked ? "Fixed by the program: covered months × monthly amount. An administrator can allow editing in Programs." : "Starts with covered months × monthly amount. Edit only when the receipt pays the program's exact remaining payoff balance."}>Amount{locked ? " (fixed)" : ""}</Label>
                                    <Input type="number" min="0" step="0.01" readOnly={locked} className={locked ? "bg-muted/50" : undefined} value={entry.amountCollected} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateCollection(entry.id, { amountCollected: event.target.value })} placeholder="0.00" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label>OR Number *</Label>
                                    <Input value={entry.orNumber} onChange={(event) => updateCollection(entry.id, { orNumber: event.target.value })} placeholder={`e.g. ${OR_NUMBER_EXAMPLE}`} aria-invalid={Boolean(entry.orNumber.trim()) && !isValidOrNumber(entry.orNumber)} />
                                    {entry.orNumber.trim() !== "" && !isValidOrNumber(entry.orNumber) && <p className="text-xs text-red-700">{orNumberProblem(entry.orNumber)}</p>}
                                  </div>
                                  <div className="space-y-1">
                                    <Label>OR Date *</Label>
                                    <Input type="date" value={entry.orDate} onChange={(event) => updateCollection(entry.id, { orDate: event.target.value })} />
                                  </div>
                                </div>
                                {locked && payoff > monthly && monthly > 0 && (
                                  Number(entry.amountCollected) === payoff
                                    ? <button type="button" className="text-xs text-primary underline" onClick={() => updateCollection(entry.id, { amountCollected: monthly.toFixed(2) })}>Back to {formatCurrency(monthly)} (covered months)</button>
                                    : <button type="button" className="text-xs text-primary underline" onClick={() => updateCollection(entry.id, { amountCollected: payoff.toFixed(2) })}>Receipt pays the full remaining balance: use {formatCurrency(payoff)}</button>
                                )}
                                {dateWarnings({ receiptDate: entry.orDate, dateRemitted, today: manilaNow().date }).map((warning) => <p key={warning} className="text-xs font-medium text-amber-800">⚠ {warning}</p>)}
                                {isLateDate(entry.orDate) && (
                                  <div className="space-y-1">
                                    <Label className="text-xs text-amber-800">Reason for the late entry *</Label>
                                    <Input value={entry.backdateReason ?? ""} onChange={(event) => updateCollection(entry.id, { backdateReason: event.target.value })} placeholder="e.g. Receipt turned over late by the MAS" />
                                    <p className="text-xs text-muted-foreground">The OR date is more than one working day old. Administrators review late entries.</p>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* WORKED OUT BY THE SYSTEM: account status, NOP and the remittance, on one line. */}
                          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            Account <strong className="text-foreground">{entry.accountLoading ? "Loading..." : entry.accountStatus || "—"}</strong>
                            {" · "}NOP <strong className="text-foreground">{entry.nopFrom ?? "—"}{entry.nopTo !== null && entry.nopTo !== entry.nopFrom ? `–${entry.nopTo}` : ""}</strong>
                            {" · "}Remittance <strong className="text-foreground">{(() => { const quote = quoteEntry(entry); return "remittance" in quote ? formatCurrency(quote.remittance) : "Pending"; })()}</strong>
                            <span title="NOP is set from the covered months and the account's history (an NS account's New Sale is NOP 1, so its first collection is NOP 2; on a program with a registration fee the New Sale is not a NOP, so the first collection is NOP 1). The remittance uses the MAS or Collector incentive tier and mark-up."> ⓘ</span>
                            {quoteEntry(entry).error && <p className="mt-1 text-amber-700">{quoteEntry(entry).error}</p>}
                            {needsWaiver(entry) && (entry.waiverAbove
                              ? <p className="mt-1 text-foreground">Suspended on the OR date: Waiver selected on the earlier receipt for this account.</p>
                              : <p className="mt-1 text-amber-700">Suspended on the OR date. Select Waiver under If Suspended.</p>)}
                            {entry.accountStatus === "Forfeited" && <p className={`mt-1 ${forfeitedPaymentsAllowed() ? "text-amber-700" : "text-red-600"}`}>{forfeitedPaymentsAllowed() ? "Forfeited: payments are allowed today only." : "Payments are blocked for this program."}</p>}
                            {needsWaiver(entry) && !entry.waiverAbove && <label className="mt-2 block text-foreground">If Suspended *<select className="ml-2 rounded border p-1" value={entry.ifSuspended} onChange={(e) => updateCollection(entry.id, { ifSuspended: e.target.value })}><option value="">Select</option><option value="Waiver">Waiver</option></select></label>}
                          </div>

                          {/* NO INCENTIVE (owner, October 20, 2026): this one collection earns the collector nothing; it is remitted whole. */}
                          {!dto && <div className={`rounded-md border px-3 py-2 text-sm ${noIncentiveOn(entry) ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : ""}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button type="button" size="sm" variant={noIncentiveOn(entry) ? "destructive" : "outline"} aria-pressed={noIncentiveOn(entry)} onClick={() => updateCollection(entry.id, { noIncentive: !noIncentiveOn(entry) })}>{noIncentiveOn(entry) ? "No incentive ✓" : "No incentive"}</Button>
                              <span className="text-xs text-muted-foreground">{noIncentiveOn(entry) ? "The collector earns no incentive on this collection; the whole amount is remitted. Click again to undo." : "Click when the collector should not earn an incentive on this collection."}</span>
                            </div>
                            {noIncentiveOn(entry) && <div className="mt-2 space-y-1">
                              <Label className="text-xs text-red-800 dark:text-red-300">Reason for no incentive *</Label>
                              <Input maxLength={300} value={entry.noIncentiveReason ?? ""} onChange={(event) => updateCollection(entry.id, { noIncentiveReason: event.target.value })} placeholder="e.g. Receipt issued by the office, not the collector" />
                            </div>}
                          </div>}

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
                                    <p className="text-xs text-muted-foreground">Yes: whoever collected earns only 10% of (base pay − mark-up). Not allowed in an ORC batch.</p>
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

              {/* TOTALS: amount collected, incentives (less Fidelity), penalty, total remittance */}
              <RemittanceSummary collected={totalCollected} remittance={totalRemittance} fidelity={fidelityAmount} penalty={penaltyAmount} penaltyNote={penaltyNote.trim()} />

              {/* RECEIPT PHOTOS: at least one required, as many as needed (owner, October 14, 2026). */}
              <ReceiptPhotosPicker photos={receiptPhotos} onChange={setReceiptPhotos} kind="collection" optional={isCashPayment} />

              {showPreview && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4"><p className="font-semibold">Review batch before saving</p><div className="mt-3 space-y-2">{collections.map((entry, index) => { const member = members.find((item) => item.id === entry.memberId); const program = programs.find((item) => item.id === entry.programId); const quote = quoteEntry(entry); return <div key={entry.id} className="rounded-lg border bg-background p-3 text-sm"><strong>Collection {index + 1}: {member ? getMemberFullName(member) : "No member"}</strong><p>{program?.name || "No program"} · {formatCurrency(Number(entry.amountCollected) || 0)}</p><p>{entry.monthFrom || "—"} to {entry.monthTo || "—"} · NOP {entry.nopFrom ?? "—"}–{entry.nopTo ?? "—"}</p><p>OR {entry.orNumber || "—"} · Calculated remittance {"remittance" in quote ? formatCurrency(quote.remittance) : "Pending"}</p></div>; })}</div><p className="mt-3 font-medium">Total amount collected: {formatCurrency(totalCollected)} · Total remittance: {totalDue === null ? "Pending" : formatCurrency(totalDue)}{penaltyAmount > 0 ? ` (incl. ${formatCurrency(penaltyAmount)} penalty: ${penaltyNote.trim() || "no note yet"})` : ""}</p>{(() => { const turnover = controlTotalDifference(controlTotal, totalDue); return turnover ? <p className="font-semibold text-amber-700">Turnover sheet {varianceLabel(turnover).toLowerCase()}: this batch saves and its slip goes to Discrepancy.</p> : null; })()}</div>}
            </CardContent>

            {/* SAVE BAR (October 9, 2026): stays at the bottom of the entries panel with the totals, the control total and
                Save, so a batch is finished without scrolling to the end. */}
            <div className="sticky bottom-0 z-10 space-y-2 border-t bg-card p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span>Total amount collected <strong className="text-lg tabular-nums">{formatCurrency(totalCollected)}</strong></span>
                <span className="text-muted-foreground">Total remittance <strong className="tabular-nums text-foreground">{totalDue === null ? "pending" : formatCurrency(totalDue)}</strong></span>
                <span className="text-muted-foreground">{collections.length} {collections.length === 1 ? "entry" : "entries"}</span>
              </div>
              <ControlTotalField id="control-total" title="The net total the MAS wrote on the turnover sheet: amount collected less incentives, plus Fidelity. Not the total collections, and not copied from the summary." value={controlTotal} onChange={setControlTotal} note={controlTotalNote} onNoteChange={setControlTotalNote} totalRemittance={totalDue} />
              {saveMessage && <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{saveMessage}</div>}
              <div className="flex gap-2">
                <Button type="button" className="flex-1" onClick={async () => { if (showPreview) { void saveCollections(); return; } await alertDialog(COLLECTION_CHECK_REMINDER, { title: "Check every entry before saving", warning: true, confirmLabel: "I have checked every entry" }); setShowPreview(true); }} disabled={saving}>
                  <Save className="mr-2 size-4" />
                  {saving ? "Saving..." : showPreview ? "Confirm and Save" : "Preview Collections"}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                  <RotateCcw className="mr-2 size-4" />
                  Reset
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* RIGHT HISTORY PANEL */}
        <Card className="flex h-[calc(100vh-180px)] min-h-[34rem] flex-col overflow-clip">
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

          {/* overscroll-contain: reaching the end of one panel never scrolls the page or the other panel. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                  {/* ACCOUNT SUMMARY: stays at the top while the history below it scrolls. */}
                  <div className="sticky top-0 z-10 rounded-xl border bg-card p-4 shadow-sm">
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

                  {/* CURRENT ENTRY (October 9, 2026): pinned to the bottom of the panel, so it stays in view beside the history. */}
                  {activeCollection &&
                    activeMember &&
                    activeProgram && (
                      <div className="sticky bottom-0 z-10 rounded-xl border border-primary/40 bg-card p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
                        <p className="text-sm font-semibold">Current Entry</p>
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                          <div><p className="text-xs text-muted-foreground">Months</p><p className="font-medium">{formatMonth(activeCollection.monthFrom)}{activeCollection.monthTo && activeCollection.monthTo !== activeCollection.monthFrom ? ` – ${formatMonth(activeCollection.monthTo)}` : ""}{activeCollection.monthTo ? ` (${getMonthDifference(activeCollection.monthFrom, activeCollection.monthTo)})` : ""}</p></div>
                          <div><p className="text-xs text-muted-foreground">NOP</p><p className="font-medium">{activeCollection.nopFrom ?? "—"}{activeCollection.nopTo !== null && activeCollection.nopTo !== activeCollection.nopFrom ? `–${activeCollection.nopTo}` : ""}</p></div>
                          <div><p className="text-xs text-muted-foreground">Amount</p><p className="font-medium">{activeCollection.amountCollected ? formatCurrency(Number(activeCollection.amountCollected)) : "—"}</p></div>
                          <div><p className="text-xs text-muted-foreground">OR</p><p className="truncate font-medium">{activeCollection.orNumber || "—"}{activeCollection.orDate ? ` · ${showDate(activeCollection.orDate)}` : ""}</p></div>
                        </div>
                      </div>
                    )}
                </>
              )}
            </CardContent>
          </div>
        </Card>
      </div>
      </>}
    </div>
  );
}

/** Collections that MAS submitted in the clerk's branches, oldest first (lib/collection-submissions.ts). */
function CollectionSubmissionList({ submissions, activeId, onOpen, onReject, onRemit, onRefresh }: { submissions: CollectionSubmissionSummary[]; activeId: string; onOpen: (submission: CollectionSubmissionSummary) => void; onReject: (submission: CollectionSubmissionSummary) => void; onRemit: (submission: CollectionSubmissionSummary) => void; onRefresh: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Submitted by MAS</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">The MAS chose the members and months; the OR date is the day they added each member. Only you can change a batch. When the MAS hands the cash over, press <strong>Mark remitted</strong> at once: that time decides the incentive (kept if by the deadline shown, 3:00 PM the next working day), so the OR numbers can be typed later with Review, even after 3:00 PM. The Date Remitted can still be changed with a reason.</p>
        {!submissions.length && <p className="text-sm text-muted-foreground">No submissions waiting in your branches.</p>}
        {submissions.map((submission) => (
          <div key={submission.id} className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${submission.id === activeId ? "border-primary bg-primary/5" : ""}`}>
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{submission.mas} · {submission.branch}</p>
              <p className="text-muted-foreground">{submission.entryCount} member{submission.entryCount === 1 ? "" : "s"} · {formatCurrency(submission.totalAmount)} collected · incentive {formatCurrency(submission.totalIncentive)} · submitted {formatDateTime(submission.submittedAt)}</p>
              {submission.status === "Remitted"
                ? <p className={submission.incentiveDeadline && submission.remittedAt > submission.incentiveDeadline ? "font-medium text-amber-700" : "font-medium text-emerald-700"}>Remitted {formatDateTime(submission.remittedAt)}{submission.remittedByName ? ` (${submission.remittedByName})` : ""}{submission.incentiveDeadline ? (submission.remittedAt > submission.incentiveDeadline ? " · after the deadline: incentive forfeited" : " · in time: incentive kept") : ""} · OR numbers still to type</p>
                : submission.incentiveDeadline && <p className="text-muted-foreground">Not yet remitted · incentive kept if received by {formatDeadline(submission.incentiveDeadline)}</p>}
              <p className="truncate">{submission.entries.map((entry) => `${entry.memberName} (${entry.months} mo${entry.waiver ? ", Waiver" : ""})`).join(", ")}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {submission.status === "Submitted" && <Button type="button" size="sm" onClick={() => onRemit(submission)}>Mark remitted</Button>}
              <Button type="button" size="sm" variant={submission.status === "Remitted" ? "default" : "outline"} onClick={() => onOpen(submission)}>{submission.id === activeId ? "Continue review" : submission.status === "Remitted" ? "Type OR numbers" : "Review"}</Button>
              {submission.status === "Submitted" && <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => onReject(submission)}>Reject</Button>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
