"use client";

import { alertDialog, confirmDialog, promptDialog } from "@/components/app-dialog";
import { SALE_CHECK_REMINDER } from "@/lib/entry-check-reminder";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useSubmissionBranches } from "@/components/submission-branches";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { todayInManila } from "@/lib/account-rules";
import type { ProgramStanding } from "@/lib/account-data";
import { defaultNewSaleAmount, fixedNewSaleAmount } from "@/lib/program-amount-lock";
import { monthlyPay } from "@/lib/program-payment-limit.mjs";
import { useDeclaredNonWorkingDays } from "@/lib/use-work-calendar";
import { ControlTotalField } from "@/components/control-total-field";
import { EntryFigures } from "@/components/entry-figures";
import { BACKDATE_REASON_MIN, controlTotalDifference, controlTotalProblem, varianceLabel, INCOMPLETE_APPLICATION_MESSAGE, isIncompleteApplicationNumber, lateCheckDay, needsBackdateReason, nextApplicationNumber } from "@/lib/entry-controls";
import { blockingDateProblem, dateWarnings } from "@/lib/date-checks";
import { formatDeadline, manilaNow } from "@/lib/remittance-deadline";
import { scrollPageToTop } from "@/lib/scroll-top";
import { useFormDraft } from "@/lib/use-form-draft";
import { useSeenRejections } from "@/lib/use-seen-rejections";
import { RemittanceSummary } from "@/components/remittance-summary";
import { calculateSaleIncentive, NO_INCENTIVE_REASON_MIN, tiersForBranch, withoutIncentive } from "@/lib/remittance";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

import type {
  Address,
  Beneficiary,
  Member,
  NewSale,
  Program,
  ProgramEnrollment,
} from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { ClearingPicker } from "@/components/clearing-picker";
import { ParkedDrafts } from "@/components/parked-drafts";
import { ReceiptPhotosPicker, uploadBatchPhotos, type PickedPhoto } from "@/components/receipt-photos-picker";
import { useParkedDrafts } from "@/lib/use-parked-drafts";
import { DATE_REMITTED_REASON_MIN } from "@/lib/clearing-kinds";
import { enterToNextField } from "@/lib/enter-to-next";
import { formatDate as showDate, formatDateTime as showDateTime } from "@/lib/date-format";

type ProgramApiResponse = {
  success: boolean;
  programs?: Program[];
  message?: string;
};

type MemberSearchResponse = {
  success: boolean;
  members?: Member[];
  message?: string;
};

type BranchApiResponse = {
  success: boolean;
  branches?: Array<{
    id: string;
    name: string;
    territory?: string;
    status: "active" | "inactive";
  }>;
  message?: string;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

function formatContactNumber(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("63")) digits = `0${digits.slice(2)}`;
  digits = digits.slice(0, 11);
  return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 11)].filter(Boolean).join(" ");
}

function validContactNumber(value: string | undefined) {
  return /^09\d{9}$/.test(String(value ?? "").replace(/\D/g, ""));
}

// What a phone's keyboard does on each kind of field (owner, November 5, 2026): capitals for names, digits for numbers,
// Next on the Enter key, and no suggestions from the MAS's own details.
const nameField = { autoCapitalize: "words", autoComplete: "off", autoCorrect: "off", enterKeyHint: "next" } as const;
const phoneField = { type: "tel", inputMode: "tel", autoComplete: "off", enterKeyHint: "next" } as const;

/** True when a form value is missing or only spaces; drafts and loaded members may lack a field. */
const blank = (value: unknown) => !String(value ?? "").trim();

function emptyAddress(): Address {
  return {
    houseBlockLot: "",
  };
}

function emptyClaimant() {
  return {
    completeName: "",
    contactNumber: "",
    sameAsMemberAddress: false,
    sameAsMemberContact: false,
    address: emptyAddress(),
  };
}

function emptyMember(): Member {
  return {
    id: "",
    phMemberNumber: "",
    name: {
      surname: "",
      firstName: "",
      middleName: "",
      nameExtension: "",
    },
    birthdate: "",
    birthplace: "",
    gender: "",
    age: null,
    civilStatus: "",
    contactNumber: "",
    address: emptyAddress(),
    claimant: emptyClaimant(),
  };
}

function emptyProgram(): ProgramEnrollment {
  return {
    id: createId("ENR"),
    memberId: "",
    programId: "",
    programCode: "",
    dateEnrolled: "",
    modeOfPayment: "",
    withRegistrationFee: false,
    registrationAmount: 0,
    amountPaid: 0,
    programTerms: "",
    branch: "",
    mas: "",
  };
}

function emptyBeneficiary(): Beneficiary {
  return {
    id: createId("BEN"),
    surname: "",
    firstName: "",
    middleName: "",
    age: null,
    birthdate: "",
    relationship: "",
  };
}

function emptyNewSale(
  branch = "",
  mas = "",
): NewSale {
  return {
    id: createId("SALE"),
    member: emptyMember(),
    beneficiaries: [],
    program: {
      ...emptyProgram(),
      branch,
      mas,
    },
    applicationNumber: "",
    orDate: "",
    doiTime: manilaNow().time,
    dateRemitted: "",
  };
}

function calculateAge(
  birthdate: string,
): number | null {
  if (!birthdate) return null;

  const birth = new Date(`${birthdate}T00:00:00Z`);
  const today = new Date(`${todayInManila()}T00:00:00Z`);

  let age =
    today.getUTCFullYear() -
    birth.getUTCFullYear();

  const monthDifference =
    today.getUTCMonth() -
    birth.getUTCMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 &&
      today.getUTCDate() < birth.getUTCDate())
  ) {
    age--;
  }

  return age >= 0 ? age : null;
}

function birthdateFromAge(age: number): string {
  const [year, month, day] = todayInManila().split("-").map(Number);
  const birthYear = year - age;
  // February 29 becomes February 28 when the birth year is not a leap year.
  const lastDay = new Date(Date.UTC(birthYear, month, 0)).getUTCDate();
  return `${String(birthYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function updateAddress(
  address: Address,
  field: keyof Address,
  value: string,
): Address {
  return {
    ...address,
    [field]: value,
  };
}

/**
 * The New Sales form. `clerk` (New Sales page): the Entry Clerk encodes a batch, or reviews and saves a MAS submission
 * from the Submitted by MAS tab. `mas` (Submit New Sales page): the MAS fills only the sale cards; branch and MAS are
 * their own, Date Enrolled is the day they submit, and the clerk of the branch adds the batch details when saving.
 */
/** A MAS submission as /api/sale-submissions returns it (lib/sale-submissions.ts). */
type SubmissionSummary = {
  id: string; branch: string; mas: string; status: "Submitted" | "Remitted" | "Rejected" | "Returned" | "Saved"; sales: NewSale[]; saleCount: number; totalAmount: number;
  submittedAt: string; returnReason: string; reviewedByName: string;
  /** 3:00 PM the next working day after the earliest application date; Remitted: the handover recorded (clearingId, "YYYY-MM-DD HH:MM"). */
  incentiveDeadline: string; clearingId: string; remittedAt: string; remittedByName: string;
  /** Rejected: the MAS has seen it, so it no longer counts on the sidebar. */
  rejectionSeen: boolean;
  /** Saved: the Fidelity the clerk recorded with this batch. */
  fidelity?: number;
};
type MasProfile = { employeeId: string; name: string; branches: Array<{ id: string; name: string }> };

export function NewSalesForm({ mode = "clerk" }: { mode?: "clerk" | "mas" }) {
  const masMode = mode === "mas";
  // Birthdates cannot be in the future.
  const today = todayInManila();
  const [branch, setBranch] = useState("");
  // Late dates skip Sundays and the branch's declared non-working days, as the server does (lib/working-days.ts).
  const offDays = useDeclaredNonWorkingDays();
  // Judged from the Date Remitted when it was changed with a reason (that reason covers the late encoding; lib/entry-controls.ts).
  const isLateDate = (date: string) => needsBackdateReason(date, lateCheckDay(dateRemitted, dateRemittedChanged || submissionId ? dateRemittedReason : ""), { days: offDays, branch });
  const [mas, setMas] = useState("");
  const [masStaff, setMasStaff] = useState<Array<{ employeeId: string; fullName: string; branchIds:string[] }>>([]);
  const [dateRemitted, setDateRemitted] = useState("");
  // The MAS submission the clerk is reviewing, or the MAS is editing: saving marks it Saved; submitting updates it.
  const [submissionId, setSubmissionId] = useState("");
  // The Clearing entry the batch was filled from (components/clearing-picker.tsx).
  const [clearingId, setClearingId] = useState("");
  // The Date Remitted starts on the clearing day; moved off it (encoding delayed by meetings and the like), it needs a
  // reason (owner, October 13, 2026; lib/clearing.ts dateRemittedReasonProblem). A MAS submission has no clearing pick.
  const [clearedDate, setClearedDate] = useState("");
  const [dateRemittedReason, setDateRemittedReason] = useState("");
  const dateRemittedChanged = Boolean(clearedDate && dateRemitted && dateRemitted !== clearedDate);
  const [tab, setTab] = useState<"encode" | "submitted">("encode");
  const [masProfile, setMasProfile] = useState<MasProfile | null>(null);
  // Clerk: submissions waiting in their branches. MAS: their own submissions.
  const [submissionList, setSubmissionList] = useState<SubmissionSummary[]>([]);
  const submissionBranches = useSubmissionBranches(submissionList);
  const [submissionError, setSubmissionError] = useState("");
  const [submissionRevision, setSubmissionRevision] = useState(0);

  // The first sale starts expanded, so its form is ready to fill in.
  const [initialSale] = useState(emptyNewSale);
  const [sales, setSales] = useState<NewSale[]>([initialSale]);
  // The remittance method is the batch's, as on Collections (owner, October 16, 2026): every sale of the batch is paid
  // the same way and goes on one remittance. A cash method needs no receipt photo.
  const [paymentMethods, setPaymentMethods] = useState<Array<{ name: string; isCash: boolean }>>([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/remittance-methods", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        const active: Array<{ name: string; isCash: boolean }> = (result.methods ?? []).filter((method: { status: string }) => method.status === "active");
        setPaymentMethods(active);
        setPaymentMethod((current) => current || active.find((method) => method.isCash)?.name || active[0]?.name || "");
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  // A method marked cash, or named Cash, as the server counts it (cashMethodNames in lib/entry-batches.ts).
  const allCash = Boolean(paymentMethods.find((method) => method.name === paymentMethod)?.isCash) || paymentMethod.trim().toLowerCase() === "cash";

  const [expandedSales, setExpandedSales] =
    useState<Record<string, boolean>>(() => ({ [initialSale.id]: true }));
  const saleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [scrollTargetSaleId, setScrollTargetSaleId] =
    useState("");

  const [memberSearchResults, setMemberSearchResults] =
    useState<Record<string, Member[]>>({});

  const [memberSearchTerms, setMemberSearchTerms] =
    useState<Record<string, string>>({});

  // Suspended or forfeited programs of each existing member on the form, keyed by member ID. A warning only: the
  // encoder confirms with the member before adding another program.
  const [memberStandings, setMemberStandings] =
    useState<Record<string, { programs: ProgramStanding[]; error: string }>>({});
  const requestedStandings = useRef(new Set<string>());

  // Remittance penalty on this New Sales batch: charged to the MAS (their own money), added to the remittance.
  const [penalty, setPenalty] = useState("");
  // The total written on the MAS's turnover sheet; short or over still saves, recorded with the batch.
  const [controlTotal, setControlTotal] = useState("");
  // Optional note kept with a short or over turnover sheet (lib/turnover-variance.ts).
  const [controlTotalNote, setControlTotalNote] = useState("");
  const [penaltyNote, setPenaltyNote] = useState("");
  const penaltyAmount = Math.max(0, Math.round((Number(penalty) || 0) * 100) / 100);
  // Fidelity for this batch: the MAS's own money handed over to save, added to the remittance. No limit; zero is allowed.
  const [fidelity, setFidelity] = useState("");
  const fidelityAmount = Math.max(0, Math.round((Number(fidelity) || 0) * 100) / 100);

  // The unsaved form survives leaving the page (e.g. to Collections) and coming back.
  const draftSnapshot = { branch, mas, dateRemitted, clearingId, clearedDate, dateRemittedReason, sales, expandedSales, penalty, penaltyNote, fidelity, submissionId, paymentMethod };
  type SalesDraft = typeof draftSnapshot;
  const restoreDraft = (draft: Partial<SalesDraft>) => {
      setSubmissionId(draft.submissionId ?? "");
      setBranch(draft.branch ?? "");
      setMas(draft.mas ?? "");
      setDateRemitted(draft.dateRemitted ?? "");
      setClearingId(draft.clearingId ?? "");
      setClearedDate(draft.clearedDate ?? "");
      setDateRemittedReason(draft.dateRemittedReason ?? "");
      if (Array.isArray(draft.sales) && draft.sales.length) setSales(draft.sales);
      setExpandedSales(draft.expandedSales ?? {});
      setPenalty(draft.penalty ?? "");
      setPenaltyNote(draft.penaltyNote ?? "");
      setFidelity(draft.fidelity ?? "");
      if (draft.paymentMethod) setPaymentMethod(draft.paymentMethod);
    };
  useFormDraft(masMode ? "mas-sales" : "new-sales", draftSnapshot, restoreDraft);
  // Batches set aside to finish later (owner, October 14, 2026; lib/use-parked-drafts.ts).
  const parked = useParkedDrafts<SalesDraft>(masMode ? "mas-sales" : "new-sales");

  const [programs, setPrograms] = useState<
    Program[]
  >([]);

  // A program whose New Sale amount is locked always charges its fixed amount, whatever a saved draft holds.
  // The sale's program: by ID, since two programs can share a code (DS-320 and D-320 are both 320); by code for older drafts.
  const programOf = (sale: (typeof sales)[number]) => (sale.program.programId && programs.find((item) => item.id === sale.program.programId)) || programs.find((item) => item.code === sale.program.programCode);
  const lockedProgram = (sale: (typeof sales)[number]) => { const program = programOf(sale); return program && !program.newSaleAmountEditable && !program.flexible ? program : null; };
  const amountPaidOf = (sale: (typeof sales)[number]) => { const locked = lockedProgram(sale); return locked ? fixedNewSaleAmount(locked) : Number(sale.program.amountPaid) || 0; };
  const totalPaid = sales.reduce((sum, sale) => sum + Math.round(amountPaidOf(sale) * 100), 0) / 100;

  const [branches, setBranches] = useState<
    NonNullable<BranchApiResponse["branches"]>
  >([]);

  // Each sale's MAS incentive and company share, by the same rule the server saves (lib/remittance.ts).
  // A branch's own incentive tiers replace the program's base tiers there.
  const branchId = branches.find((item) => item.name === branch)?.id ?? "";
  // Clerk saves only; a MAS submission has no No incentive choice.
  const noIncentiveOn = (sale: (typeof sales)[number]) => !masMode && sale.noIncentive === true;
  const saleQuotes = sales.map((sale) => {
    const program = programOf(sale);
    if (!program) return null;
    try {
      const quote = calculateSaleIncentive({ basePay: program.basePay, flexible: program.flexible, maxMonthlyPayment: program.maxMonthlyPayment, registrationFeeRequired: program.registrationFeeRequired, saleIncentiveType: program.saleIncentiveType ?? "", saleIncentiveAmount: program.saleIncentiveAmount ?? 0, incentiveTiers: tiersForBranch(program.incentiveTiers ?? [], branchId) }, amountPaidOf(sale));
      // No incentive (owner, October 20, 2026): remitted whole, as the server saves it.
      if (!noIncentiveOn(sale)) return quote;
      const kept = withoutIncentive(amountPaidOf(sale), quote.remittance);
      return { ...quote, incentive: 0, remittance: kept.remittance, basis: ["No incentive on this sale: the whole amount is remitted"] };
    } catch (error) {
      return { incentive: 0, remittance: 0, rule: "", basis: [], error: error instanceof Error ? error.message : "The incentive could not be calculated." };
    }
  });
  const quoteProblem = saleQuotes.find((quote) => quote && "error" in quote) as { error: string } | undefined;
  const quotesReady = saleQuotes.every(Boolean) && !quoteProblem;
  const totalSaleRemittance = quotesReady ? saleQuotes.reduce((sum, quote) => sum + Math.round((quote?.remittance ?? 0) * 100), 0) / 100 : null;
  // The net total checked against the turnover sheet: company remittance plus Fidelity (the summary's Total remittance).
  const saleTotalDue = totalSaleRemittance === null ? null : Math.round((totalSaleRemittance + fidelityAmount) * 100) / 100;

  const [programLoading, setProgramLoading] =
    useState(true);

  const [programError, setProgramError] =
    useState("");

  const [saveMessage, setSaveMessage] =
    useState("");

  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // The review sits below the cards: without this a tap on Preview Sales seems to do nothing on a phone.
  const previewRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (showPreview) previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showPreview]);
  // The batch's receipt photos (clerk save only): at least one, as many as needed (owner, October 14, 2026); none needed
  // when the batch is paid in cash (October 16, 2026).
  const [receiptPhotos, setReceiptPhotos] = useState<PickedPhoto[]>([]);

  useEffect(() => {
    if (masMode) return;
    const loadMasStaff = async () => {
      const response = await fetch("/api/mas", { cache: "no-store" });
      const result = await response.json();
      if (response.ok && result.success) setMasStaff(result.staff ?? []);
    };
    void loadMasStaff();
  }, [masMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/sale-submissions?view=${masMode ? "mine" : "review"}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load MAS submissions.");
        if (cancelled) return;
        setSubmissionList(result.submissions ?? []);
        setSubmissionError("");
        // A MAS encodes for themselves; with one branch it is chosen for them.
        if (masMode && result.profile) {
          const profile = result.profile as MasProfile;
          setMasProfile(profile);
          setMas(profile.name);
          if (profile.branches.length === 1) setBranch(profile.branches[0].name);
        }
      } catch (error) {
        if (!cancelled) setSubmissionError(error instanceof Error ? error.message : "Unable to load MAS submissions.");
      }
    })();
    return () => { cancelled = true; };
  }, [masMode, submissionRevision]);
  // Live updates: a clerk sees new MAS submissions, and a MAS sees returned ones, without reloading (lib/use-live-refresh.ts).
  useLiveRefresh(["sale_submissions"], () => setSubmissionRevision((value) => value + 1));

  useEffect(() => {
    if (!scrollTargetSaleId) return;

    saleRefs.current[scrollTargetSaleId]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the one-shot scroll request once it has run
    setScrollTargetSaleId("");
  }, [sales, scrollTargetSaleId]);

  useEffect(() => {
    const loadBranches = async () => {
      try {
        const response = await fetch("/api/branches", {
          cache: "no-store",
        });
        const result =
          (await response.json()) as BranchApiResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.message || "Unable to load branches.",
          );
        }

        setBranches(result.branches ?? []);
      } catch (error) {
        console.error("Branch loading error:", error);
        setBranches([]);
      }
    };

    void loadBranches();
  }, []);

  /*
   * =========================================================
   * LOAD PROGRAMS FROM GOOGLE SHEETS THROUGH API
   * =========================================================
   *
   * IMPORTANT:
   * Load BOTH Active and Inactive programs.
   *
   * The filtering is intentionally NOT done here.
   * The Programs API should return all programs.
   */
  useEffect(() => {
    let cancelled = false;

    const loadPrograms = async () => {
      setProgramLoading(true);
      setProgramError("");

      try {
        const response = await fetch(
          "/api/programs",
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as ProgramApiResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.message ||
              "Unable to load programs.",
          );
        }

        /*
         * DO NOT FILTER BY STATUS HERE.
         *
         * We want both Active and Inactive programs.
         */
        const loadedPrograms =
          Array.isArray(result.programs)
            ? result.programs
            : [];

        if (!cancelled) {
          setPrograms(loadedPrograms);
        }
      } catch (error: unknown) {
        console.error(
          "Program loading error:",
          error,
        );

        if (!cancelled) {
          setPrograms([]);

          setProgramError(
            error instanceof Error
              ? error.message
              : "Unable to load programs.",
          );
        }
      } finally {
        if (!cancelled) {
          setProgramLoading(false);
        }
      }
    };

    void loadPrograms();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * =========================================================
   * ALL PROGRAMS
   * =========================================================
   *
   * Active AND Inactive are intentionally available.
   */
  const availablePrograms = programs;

  /*
   * =========================================================
   * UPDATE SALE
   * =========================================================
   */
  const updateSale = (
    saleId: string,
    updater: (sale: NewSale) => NewSale,
  ) => {
    setSales((current) =>
      current.map((sale) =>
        sale.id === saleId
          ? updater(sale)
          : sale,
      ),
    );
  };

  /*
   * =========================================================
   * MEMBER SEARCH
   * =========================================================
   */
  const searchMember = useCallback(async (
    saleId: string,
    surname: string,
  ) => {
    if (!surname) {
      return;
    }

    try {
      const response = await fetch(
        `/api/members?search=${encodeURIComponent(
          surname,
        )}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const result =
        (await response.json()) as MemberSearchResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to search member.",
        );
      }

      const normalizedSurname = surname.toLowerCase();
      const matches = (result.members ?? []).filter(
        (candidate) =>
          candidate.name.surname
            .trim()
            .toLowerCase()
            .includes(normalizedSurname),
      );

      setMemberSearchTerms((current) => ({
        ...current,
        [saleId]: surname,
      }));

      setMemberSearchResults((current) => ({
        ...current,
        [saleId]: matches,
      }));
    } catch (error: unknown) {
      console.error(
        "Member search error:",
        error,
      );

    }
  }, []);

  const surnameSearches = JSON.stringify(
    sales.map((sale) => [
      sale.id,
      sale.member.name.surname.trim(),
    ]),
  );

  useEffect(() => {
    const searches = JSON.parse(
      surnameSearches,
    ) as Array<[string, string]>;

    const timers = searches.map(([saleId, surname]) => {

      if (surname.length < 2) {
        return undefined;
      }

      return window.setTimeout(() => {
        void searchMember(saleId, surname);
      }, 400);
    });

    return () => {
      timers.forEach((timer) => {
        if (timer !== undefined) {
          window.clearTimeout(timer);
        }
      });
    };
  }, [searchMember, surnameSearches]);

  const existingMemberIds = [...new Set(sales.map((sale) => sale.member.id).filter(Boolean))].sort().join("|");

  useEffect(() => {
    for (const memberId of existingMemberIds.split("|").filter(Boolean)) {
      if (requestedStandings.current.has(memberId)) continue;
      requestedStandings.current.add(memberId);
      void fetch(`/api/members/standing?memberId=${encodeURIComponent(memberId)}`, { cache: "no-store" })
        .then(async (response) => {
          const result = (await response.json()) as { success: boolean; programs?: ProgramStanding[]; message?: string };
          if (!response.ok || !result.success) throw new Error(result.message || "Unable to check this member's accounts.");
          setMemberStandings((current) => ({ ...current, [memberId]: { programs: result.programs ?? [], error: "" } }));
        })
        .catch((error: unknown) => setMemberStandings((current) => ({ ...current, [memberId]: { programs: [], error: error instanceof Error ? error.message : "Unable to check this member's accounts." } })));
    }
  }, [existingMemberIds]);

  const dismissMemberChoices = (saleId: string) => {
    setMemberSearchResults((current) => {
      const remaining = { ...current };
      delete remaining[saleId];
      return remaining;
    });

    setMemberSearchTerms((current) => {
      const remaining = { ...current };
      delete remaining[saleId];
      return remaining;
    });
  };

  const selectExistingMember = (
    saleId: string,
    member: Member,
  ) => {
    updateSale(saleId, (current) => {
      const filled = fillFromRecord(current.member, member);
      return {
        ...current,
        member: {
          ...filled,
          id: member.id,
          phMemberNumber: member.phMemberNumber,
          age: calculateAge(filled.birthdate),
        },
        program: {
          ...current.program,
          memberId: member.id,
        },
      };
    });

    dismissMemberChoices(saleId);
  };

  /*
   * Same person check (owner, October 23, 2026): members were registered twice because the clerk typed a member who
   * already exists instead of picking them. Once a new member's surname and first name are typed, members with the same
   * surname and a similar first name are looked up (lib/member-records.ts similarFirstNames); unless the typed middle initial or birthdate says otherwise, a pop-up shows the member's
   * details and the clerk answers Yes (the sale uses the existing member) or No (a different person, not asked again).
   */
  const declinedMatches = useRef<Record<string, Set<string>>>({});
  const askingSameName = useRef(new Set<string>());
  const checkSameName = async (saleId: string, surname: string, firstName: string, middleName: string, birthdate: string) => {
    if (askingSameName.current.has(saleId)) return;
    askingSameName.current.add(saleId);
    try {
      const response = await fetch(`/api/members?sameName=1&surname=${encodeURIComponent(surname)}&firstName=${encodeURIComponent(firstName)}`, { cache: "no-store" });
      const result = (await response.json()) as MemberSearchResponse;
      if (!response.ok || !result.success) return;
      const declined = declinedMatches.current[saleId] ?? new Set<string>();
      declinedMatches.current[saleId] = declined;
      const initial = (value: string) => value.trim().charAt(0).toLowerCase();
      const candidates = (result.members ?? []).filter((member) => !declined.has(member.id)
        && !(middleName && member.name.middleName && initial(middleName) !== initial(member.name.middleName))
        && !(birthdate && member.birthdate && birthdate !== member.birthdate));
      for (const member of candidates) {
        const programNames = ((member as Member & { programIds?: string[] }).programIds ?? []).map((id) => programs.find((item) => item.id === id)?.name || id);
        const details = [
          `Name: ${[member.name.surname, [member.name.firstName, member.name.middleName, member.name.nameExtension].filter(Boolean).join(" ")].join(", ")}`,
          member.phMemberNumber && `PH/Member: ${member.phMemberNumber}`,
          member.birthdate && `Birthdate: ${showDate(member.birthdate)}`,
          member.gender && `Gender: ${member.gender}`,
          member.contactNumber && `Contact: ${member.contactNumber}`,
          member.address.houseBlockLot && `Address: ${member.address.houseBlockLot}`,
          programNames.length ? `Programs: ${programNames.join(", ")}` : "",
        ].filter(Boolean).join("\n");
        const same = await confirmDialog(`A member with the same surname and a similar first name is already registered. Is this the same person?\n\n${details}`, {
          title: "This member may already exist", confirmLabel: "Yes, same person", cancelLabel: "No, a different person", requireChoice: true,
        });
        if (same) { selectExistingMember(saleId, member); return; }
        declined.add(member.id);
      }
    } catch (error: unknown) {
      console.error("Same member check error:", error);
    } finally {
      askingSameName.current.delete(saleId);
    }
  };
  const sameNameChecks = JSON.stringify(sales.filter((sale) => !sale.member.id).map((sale) => [
    sale.id, sale.member.name.surname.trim(), sale.member.name.firstName.trim(), sale.member.name.middleName.trim(), sale.member.birthdate,
  ]));
  useEffect(() => {
    const checks = JSON.parse(sameNameChecks) as Array<[string, string, string, string, string]>;
    const timers = checks.filter(([, surname, firstName]) => surname.length >= 2 && firstName.length >= 2)
      .map(([saleId, surname, firstName, middleName, birthdate]) => window.setTimeout(() => void checkSameName(saleId, surname, firstName, middleName, birthdate), 700));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a new member's name or birthdate changes
  }, [sameNameChecks]);

  // The encoder picked the wrong person: keep what is typed, but register it as a new member instead.
  const unlinkExistingMember = (saleId: string) => {
    updateSale(saleId, (current) => ({
      ...current,
      member: { ...current.member, id: "", phMemberNumber: "" },
      program: { ...current.program, memberId: "" },
    }));
  };

  /*
   * =========================================================
   * SALES
   * =========================================================
   */
  const addSale = () => {
    // The next application number and the same application date as the last sale (owner, October 19, 2026: forms are
    // encoded in order, mostly of one day); both can be changed, and the sale after follows the changed ones.
    const last = sales.at(-1);
    const newSale = {
      ...emptyNewSale(
        branch,
        mas,
      ),
      applicationNumber: nextApplicationNumber(last?.applicationNumber ?? ""),
      orDate: last?.orDate ?? "",
    };

    setSales((current) => [
      ...current,
      newSale,
    ]);

    setExpandedSales(() => ({
      ...Object.fromEntries(
        sales.map((sale) => [sale.id, false]),
      ),
      [newSale.id]: true,
    }));
    setScrollTargetSaleId(newSale.id);
  };

  const removeSale = (
    saleId: string,
  ) => {
    if (sales.length === 1) return;

    setSales((current) =>
      current.filter(
        (sale) => sale.id !== saleId,
      ),
    );

    setExpandedSales((current) => {
      const updated = {
        ...current,
      };

      delete updated[saleId];

      return updated;
    });
  };

  const toggleSale = (
    saleId: string,
  ) => {
    const isOpen = expandedSales[saleId] ?? true;

    if (!isOpen) {
      setScrollTargetSaleId(saleId);
    }

    setExpandedSales((current) => {
      const currentlyOpen = current[saleId] ?? true;

      if (currentlyOpen) {
        return {
          ...current,
          [saleId]: false,
        };
      }

      return Object.fromEntries(
        sales.map((sale) => [
          sale.id,
          sale.id === saleId,
        ]),
      );
    });
  };

  /*
   * =========================================================
   * ADDRESS
   * =========================================================
   */
  const updateMemberAddress = (
    saleId: string,
    field: keyof Address,
    value: string,
  ) => {
    updateSale(saleId, (sale) => {
      const memberAddress =
        updateAddress(
          sale.member.address,
          field,
          value,
        );

      const claimantAddress =
        sale.member.claimant
          .sameAsMemberAddress
          ? memberAddress
          : sale.member.claimant.address;

      return {
        ...sale,

        member: {
          ...sale.member,

          address: memberAddress,

          claimant: {
            ...sale.member.claimant,
            address: claimantAddress,
          },
        },
      };
    });
  };

  const toggleClaimantAddress = (
    saleId: string,
    checked: boolean,
  ) => {
    updateSale(saleId, (sale) => ({
      ...sale,

      member: {
        ...sale.member,

        claimant: {
          ...sale.member.claimant,

          sameAsMemberAddress:
            checked,

          address: checked
            ? {
                ...sale.member.address,
              }
            : {
                ...sale.member.claimant
                  .address,
              },
        },
      },
    }));
  };

  /*
   * =========================================================
   * BENEFICIARIES
   * =========================================================
   */
  const addBeneficiary = (
    saleId: string,
  ) => {
    updateSale(saleId, (sale) => ({
      ...sale,

      beneficiaries: [
        ...sale.beneficiaries,
        emptyBeneficiary(),
      ],
    }));
  };

  const removeBeneficiary = (
    saleId: string,
    beneficiaryId: string,
  ) => {
    updateSale(saleId, (sale) => ({
      ...sale,

      beneficiaries:
        sale.beneficiaries.filter(
          (beneficiary) =>
            beneficiary.id !==
            beneficiaryId,
        ),
    }));
  };

  const updateBeneficiary = (
    saleId: string,
    beneficiaryId: string,
    field: keyof Beneficiary,
    value: string,
  ) => {
    updateSale(saleId, (sale) => ({
      ...sale,

      beneficiaries:
        sale.beneficiaries.map(
          (beneficiary) =>
            beneficiary.id ===
            beneficiaryId
              ? {
                  ...beneficiary,

                  [field]:
                    field === "age"
                      ? value
                        ? Number(value)
                        : null
                      : value,
                }
              : beneficiary,
        ),
    }));
  };

  /*
   * =========================================================
   * RESET
   * =========================================================
   */
  // Set aside / resume (owner, October 14, 2026): the form starts over completely for the next batch; resuming a draft
  // sets the open batch aside first, so nothing is lost.
  const batchHasWork = Boolean(clearingId || submissionId) || sales.some((sale) => sale.member.name.surname.trim() || sale.applicationNumber.trim());
  const draftLabel = () => `${mas || "No MAS"} · ${branch || "no branch"} · ${sales.filter((sale) => sale.member.name.surname.trim()).length} sale(s)`;
  const clearBatch = () => {
    const firstSale = emptyNewSale("", "");
    setBranch(""); setMas(""); setDateRemitted(""); setClearingId(""); setClearedDate(""); setDateRemittedReason("");
    setSales([firstSale]); setExpandedSales({ [firstSale.id]: true }); setPenalty(""); setPenaltyNote(""); setFidelity("");
    setShowPreview(false); setSubmissionId(""); setSaveMessage(""); setReceiptPhotos([]);
  };
  const parkBatch = () => {
    if (!batchHasWork) return;
    parked.park(draftLabel(), draftSnapshot);
    clearBatch();
    setSaveMessage("Batch set aside. Resume it from Drafts.");
  };
  const resumeBatch = (id: string) => {
    const data = parked.swap(id, batchHasWork ? { label: draftLabel(), data: draftSnapshot } : undefined);
    if (!data) return;
    clearBatch();
    restoreDraft(data);
    setSaveMessage(batchHasWork ? "Draft resumed; the batch you had open was set aside." : "Draft resumed.");
  };

  const resetForm = () => {
    const firstSale = emptyNewSale(
      branch,
      mas,
    );

    setSales([firstSale]);

    setExpandedSales({
      [firstSale.id]: true,
    });
    setShowPreview(false);
    setSubmissionId("");
    setReceiptPhotos([]);
  };

  /*
   * =========================================================
   * SAVE
   * =========================================================
   */
  /** The first problem in the sale cards, or "" (the same checks for a clerk's save and a MAS's submit). */
  const saleCardProblem = (): string => {
    for (const [index, sale] of sales.entries()) {
      const onSale = `Sale #${index + 1}:`;
      if (
        blank(sale.member.name?.surname)
      ) {
        return `${onSale} Member surname is required.`;
      }

      if (!validContactNumber(sale.member.contactNumber) || !validContactNumber(sale.member.claimant?.contactNumber)) {
        return `${onSale} Member and claimant contact numbers must use the Philippine mobile format 09XX XXX XXXX.`;
      }

      if (
        blank(sale.program.programCode)
      ) {
        return `${onSale} Please select a program.`;
      }

      if (
        blank(sale.member.address?.houseBlockLot)
      ) {
        return `${onSale} Complete Address is required.`;
      }

      if ((sale.beneficiaries ?? []).some((beneficiary) =>
        blank(beneficiary.surname) ||
        blank(beneficiary.firstName) ||
        blank(beneficiary.relationship)
      )) {
        return `${onSale} Each beneficiary needs a surname, first name, and relationship.`;
      }

      if (blank(sale.applicationNumber)) {
        return `${onSale} Application Number is required.`;
      }

      if (isIncompleteApplicationNumber(sale.applicationNumber)) {
        return `${onSale} Application Number: ${INCOMPLETE_APPLICATION_MESSAGE}`;
      }

      if (!sale.orDate) {
        return `${onSale} Application Date is required.`;
      }
    }

    // A repeated Application Number is a double entry; the server also checks every earlier sale.
    const applicationKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const repeated = sales.findIndex((sale, index) => sales.findIndex((other) => applicationKey(other.applicationNumber) === applicationKey(sale.applicationNumber)) !== index);
    if (repeated >= 0) {
      return `Sale #${repeated + 1}: Application Number ${sales[repeated].applicationNumber.trim()} is already used in this batch.`;
    }

    const impossible = masMode ? -1 : sales.findIndex((sale) => blockingDateProblem({ receiptDate: sale.orDate, receiptLabel: "application date", dateRemitted, today: manilaNow().date }));
    if (impossible >= 0) {
      return `Sale #${impossible + 1}: ${blockingDateProblem({ receiptDate: sales[impossible].orDate, receiptLabel: "application date", dateRemitted, today: manilaNow().date })}`;
    }

    const noReason = sales.findIndex((sale) => noIncentiveOn(sale) && (sale.noIncentiveReason ?? "").trim().length < NO_INCENTIVE_REASON_MIN);
    if (noReason >= 0) return `Sale #${noReason + 1}: give the reason it earns no incentive.`;

    const late = sales.findIndex((sale) => isLateDate(sale.orDate) && (sale.backdateReason ?? "").trim().length < BACKDATE_REASON_MIN);
    if (late >= 0) {
      return `Sale #${late + 1}: the application date is more than one working day old. Enter the reason it is being encoded late.`;
    }

    return "";
  };

  /** Shows a problem from saleCardProblem and opens its sale, so the field to fix is on screen however long the batch is. */
  const showSaleProblem = (problem: string) => {
    setSaveMessage(problem);
    const sale = sales[Number(/^Sale #(\d+):/.exec(problem)?.[1]) - 1];
    if (!sale) return;
    setExpandedSales((current) => ({ ...current, [sale.id]: true }));
    setScrollTargetSaleId(sale.id);
  };

  /** Preview Sales. A MAS is told what is missing now, on the sale itself, rather than after the review. */
  const previewSales = async () => {
    if (masMode) {
      const problem = saleCardProblem() || quoteProblem?.error || "";
      if (problem) { showSaleProblem(problem); return; }
      setSaveMessage("");
    } else {
      await alertDialog(SALE_CHECK_REMINDER, { title: "Check every sale before saving", warning: true, confirmLabel: "I have checked every sale" });
    }
    setShowPreview(true);
  };

  /** MAS: sends the sale cards to the Entry Clerk of the branch (a new submission, or an update of the one being edited). */
  const submitToClerk = async () => {
    setSaveMessage("");
    const chosen = masProfile?.branches.find((item) => item.name === branch);
    if (!chosen) {
      setSaveMessage(masProfile?.branches.length ? "Choose your branch." : "You are not assigned to an active branch. Ask HR to assign you.");
      setShowPreview(false);
      return;
    }
    const problem = saleCardProblem() || quoteProblem?.error || "";
    if (problem) {
      showSaleProblem(problem);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/sale-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, branchId: chosen.id, sales }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to submit the sales.");
      resetForm();
      setSaveMessage(result.message || "Submitted to the branch clerk.");
      setSubmissionRevision((value) => value + 1);
      scrollPageToTop();
    } catch (error: unknown) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to submit the sales.");
    } finally {
      setSaving(false);
    }
  };

  /** Loads a submission into the form: the clerk to review and save it, the MAS to edit and submit it again. */
  // `asNew`: a MAS submits a rejected batch's sales again, as a new submission.
  const openSubmission = async (submission: SubmissionSummary, asNew = false) => {
    const hasWork = sales.some((sale) => sale.member.name.surname.trim() || sale.applicationNumber.trim());
    if (hasWork && submission.id !== submissionId && !await confirmDialog("Replace the sales on the form with this submission? Unsaved changes on the form are lost.")) return;
    const cards = submission.sales.length ? submission.sales : [emptyNewSale(submission.branch, submission.mas)];
    setBranch(submission.branch);
    setMas(submission.mas);
    setSales(cards);
    // A MAS works on a phone: one card open at a time, not every long card.
    setExpandedSales(Object.fromEntries(cards.map((sale, index) => [sale.id, !masMode || index === 0])));
    setSubmissionId(asNew ? "" : submission.id);
    // Marked remitted: saved under the handover recorded then, so its time decides the incentive (as on Collections).
    if (!masMode) {
      const clearedOn = submission.clearingId ? submission.remittedAt.slice(0, 10) : "";
      setClearingId(submission.clearingId); setClearedDate(clearedOn); setDateRemittedReason("");
      if (clearedOn) setDateRemitted(clearedOn);
    }
    setShowPreview(false);
    setSaveMessage(!masMode && submission.clearingId ? `Marked remitted at ${submission.remittedAt.slice(11)} by ${submission.remittedByName || "the clerk"}: it is saved under that handover.` : "");
    setTab("encode");
    scrollPageToTop();
  };

  /**
   * Clerk: the MAS hands the cash over. Records a Clearing for the MAS (New Sales) now, whose time decides the incentive;
   * the details can be typed later. Already cleared today: asks whether it is the same cash or a new handover.
   */
  const markRemitted = async (submission: SubmissionSummary) => {
    if (!await confirmDialog(`Mark ${submission.mas}'s New Sales remitted now (${submission.saleCount} sale${submission.saleCount === 1 ? "" : "s"}, ${peso(submission.totalAmount)} collected)? Only once the cash is in your hands: this time decides the incentive.`)) return;
    const send = (handover = "") => fetch("/api/sale-submissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remit", id: submission.id, handover }) })
      .then(async (response) => ({ response, result: await response.json() }));
    let { response, result } = await send();
    if (response.status === 409 && result.code === "ALREADY_CLEARED") {
      const handover = await confirmDialog(`${result.message}

Is this cash part of that handover?`) ? "same"
        : await confirmDialog("Record it as a new handover of cash now?") ? "new" : "";
      if (!handover) return;
      ({ response, result } = await send(handover));
    }
    if (!response.ok || !result.success) { setSubmissionError(result.message || "Unable to mark it remitted."); return; }
    setSubmissionError(""); setSaveMessage(result.message);
    setSubmissionRevision((value) => value + 1);
  };

  /** Clerk: rejects a batch that should not be saved at all; mistakes are corrected on the form instead. */
  const rejectSubmission = async (submission: SubmissionSummary) => {
    const reason = (await promptDialog(`Why reject ${submission.mas}'s New Sales? Only for a batch that should not be saved (for example the cash was not remitted); fix mistakes with Review instead. ${submission.mas} sees the reason and can submit those sales again.`, { required: true }))?.trim();
    if (!reason) return;
    const response = await fetch("/api/sale-submissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: submission.id, reason }) });
    const result = await response.json();
    if (!response.ok || !result.success) { setSubmissionError(result.message || "Unable to reject the submission."); return; }
    if (submission.id === submissionId) resetForm();
    setSubmissionRevision((value) => value + 1);
  };

  // Any unexpected error must show on screen; otherwise the button appears to do nothing.
  const saveSales = async () => {
    try {
      await submitSales();
    } catch (error: unknown) {
      console.error("New Sales save error:", error);
      setSaving(false);
      setSaveMessage(error instanceof Error ? error.message : "Unable to save new sales.");
    }
  };

  const submitSales = async () => {
    setSaveMessage("");

    if (blank(branch)) {
      setSaveMessage(
        "Please select a branch.",
      );
      setShowPreview(false);
      return;
    }

    if (blank(mas)) {
      setSaveMessage(
        "Please select the Marketing Account Staff.",
      );
      return;
    }

    if (!dateRemitted) {
      setSaveMessage("Date Remitted is required.");
      return;
    }

    if (dateRemittedChanged && dateRemittedReason.trim().length < DATE_REMITTED_REASON_MIN) {
      setSaveMessage("The Date Remitted is not the day the MAS was cleared. Enter the reason it was changed.");
      return;
    }

    const cardProblem = saleCardProblem();
    if (cardProblem) {
      showSaleProblem(cardProblem);
      return;
    }

    const controlProblem = controlTotalProblem(controlTotal, saleTotalDue);
    if (controlProblem) {
      setSaveMessage(controlProblem);
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

    if (quoteProblem) {
      setSaveMessage(quoteProblem.error);
      return;
    }

    if (Number(fidelity) < 0) {
      setSaveMessage("Fidelity must be zero or a positive amount.");
      return;
    }

    if (!masMode && !paymentMethod) {
      setSaveMessage("Remittance method is required.");
      return;
    }

    // A batch paid in cash needs no photo (owner, October 16, 2026): it was counted at Clearing.
    if (!receiptPhotos.length && !allCash) {
      setSaveMessage("Add at least one receipt photo for this batch.");
      return;
    }

    setSaving(true);

    try {
      const preparedSales =
        sales.map((sale) => {
          const selectedProgram = programOf(sale);

          return {
            memberNumber: sale.member.phMemberNumber,
            existingMember: Boolean(sale.member.id),
            surname: sale.member.name.surname,
            firstName: sale.member.name.firstName,
            middleName: sale.member.name.middleName,
            nameExtension: sale.member.name.nameExtension,
            birthdate: sale.member.birthdate,
            birthplace: sale.member.birthplace,
            gender: sale.member.gender,
            age: String(calculateAge(sale.member.birthdate) ?? ""),
            civilStatus: sale.member.civilStatus,
            contactNumber: sale.member.contactNumber,
            addressHouse: sale.member.address.houseBlockLot,
            claimantName: sale.member.claimant.completeName,
            claimantContact: sale.member.claimant.contactNumber,
            claimantSameAsMember: sale.member.claimant.sameAsMemberAddress,
            claimantAddressHouse: sale.member.claimant.address.houseBlockLot,
            applicationNo: sale.applicationNumber,
            orNumber: "",
            orDate: sale.orDate,
            backdateReason: sale.backdateReason ?? "",
            noIncentive: noIncentiveOn(sale),
            noIncentiveReason: noIncentiveOn(sale) ? (sale.noIncentiveReason ?? "").trim() : "",
            paymentMethod: masMode ? sale.program.modeOfPayment : paymentMethod,
            registrationFee: sale.program.withRegistrationFee ? "Yes" : "No",
            registrationAmount: String(sale.program.registrationAmount),
            amountPaid: String(amountPaidOf(sale)),
            // The application date is the date enrolled (DOI) (owner, October 9, 2026).
            doi: sale.orDate || sale.program.dateEnrolled,
            doiTime: sale.doiTime || manilaNow().time,
            programId: selectedProgram?.id ?? "",
            programTerms: sale.program.programTerms,
            beneficiaries: sale.beneficiaries,
          };
        });

      const response = await fetch(
        "/api/sales",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            branch,
            mas,
            dateRemitted,
            dateRemittedReason: dateRemittedChanged || submissionId ? dateRemittedReason.trim() : "",
            // The handover picked in From Clearing: its time decides the incentive (lib/clearing.ts).
            clearingId: clearingId || undefined,
            sales:
              preparedSales,
            penalty: penaltyAmount,
            penaltyNote: penaltyAmount > 0 ? penaltyNote.trim() : "",
            fidelityAmount,
            controlTotal: Number(controlTotal),
            controlTotalNote: controlTotalNote.trim(),
            submissionId: submissionId || undefined,
          }),
        },
      );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.message ||
            "Unable to save new sales.",
        );
      }

      // Attach every receipt photo to the saved sales; the first one sends a bank or e-wallet batch to Pending Approval.
      const photos = receiptPhotos;
      const uploaded = await uploadBatchPhotos((result.savedSales ?? []).map((saved: { saleId: string }) => saved.saleId), photos);
      const turnover = controlTotalDifference(controlTotal, saleTotalDue);
      const savedText = `${sales.length} ${sales.length === 1 ? "new sale" : "new sales"} saved${result.varianceId && turnover ? ` (turnover sheet ${varianceLabel(turnover).toLowerCase()}, recorded as ${result.varianceId}; its slip goes to Discrepancy)` : ""}`;
      setSaveMessage(uploaded.problem
        ? `${savedText}; ${uploaded.saved} of ${photos.length} receipt photo(s) attached. ${uploaded.problem} Add the rest in My Entries.`
        : `${savedText}${uploaded.saved ? ` with ${uploaded.saved} receipt photo(s)` : ""}.`);

      resetForm();
      if (submissionId) setSubmissionRevision((value) => value + 1);
      setPenalty("");
      setControlTotal("");
      setControlTotalNote("");
      setPenaltyNote("");
      setFidelity("");
    } catch (error: unknown) {
      console.error(
        "New Sales save error:",
        error,
      );

      setSaveMessage(
        error instanceof Error
          ? error.message
          : "Unable to save new sales.",
      );
    } finally {
      setSaving(false);
    }
  };

  // The MAS's tab count: batches still open, and those needing them (rejected and not yet seen, or sent back to fix).
  const openSubmissions = submissionList.filter((item) => item.status === "Submitted" || item.status === "Remitted").length;
  const needsAttention = submissionList.filter((item) => item.status === "Returned" || (item.status === "Rejected" && !item.rejectionSeen)).length;

  return (
    // Enter moves to the next field (lib/enter-to-next.ts).
    <div className="mx-auto max-w-6xl space-y-5" onKeyDown={enterToNextField}>
      {/* =====================================================
          HEADER
      ====================================================== */}
      {/* On a phone the top bar already names a MAS's page, and the form needs the room. */}
      <div className={masMode ? "hidden md:block" : undefined}>
        <h1 className="text-2xl font-bold tracking-tight">
          {masMode ? "Submit New Sales" : "New Sales"}
        </h1>

        <p className="text-sm text-muted-foreground">
          {masMode
            ? "Fill in each sale card and submit. The Entry Clerk of your branch reviews and saves them."
            : "Register a new member or add a new program to an existing member."}
        </p>
      </div>

      {!masMode && (
        <div role="tablist" aria-label="New Sales" className="inline-flex rounded-lg border bg-muted/40 p-1">
          <button type="button" role="tab" aria-selected={tab === "encode"} className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === "encode" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setTab("encode")}>Encode</button>
          <button type="button" role="tab" aria-selected={tab === "submitted"} className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === "submitted" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setTab("submitted")}>
            Submitted by MAS{submissionList.length ? <Badge className="ml-2">{submissionList.length}</Badge> : null}
          </button>
        </div>
      )}

      {/* MAS (owner, November 4, 2026): kept at the top of the screen, so My submissions is one tap away however long the cards run. */}
      {masMode && (
        <div role="tablist" aria-label="Submit New Sales" className="sticky-below-topbar sticky z-20 grid grid-cols-2 gap-1 rounded-lg border bg-muted p-1">
          {([["encode", "New sales"], ["submitted", "My submissions"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value}
            className={`min-h-10 rounded-md px-3 text-sm font-medium ${tab === value ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => { setTab(value); scrollPageToTop(); }}>
            {label}{value === "submitted" && openSubmissions + needsAttention ? <Badge variant={needsAttention ? "destructive" : "default"} className="ml-2">{openSubmissions + needsAttention}</Badge> : null}
          </button>)}
        </div>
      )}

      {submissionError && <p role="alert" className="text-sm text-destructive">{submissionError}</p>}

      {/* MAS: the submissions the clerk sent back first thing on the page; on the form, messages are in the save bar. */}
      {masMode && saveMessage && tab === "submitted" && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{saveMessage}</p>}
      {masMode && <ReturnedSubmissions submissions={submissionList.filter((item) => item.status === "Returned" && item.id !== submissionId)} onOpen={(submission) => void openSubmission(submission)} />}

      {masMode && tab === "submitted" ? (
        <MySubmissions submissions={submissionList} activeId={submissionId} onOpen={(submission, asNew) => void openSubmission(submission, asNew)} />
      ) : tab === "submitted" ? (
        <SubmissionList submissions={submissionBranches.shown} branchPicker={submissionBranches.picker} activeId={submissionId} onOpen={(submission) => void openSubmission(submission)} onRemit={(submission) => void markRemitted(submission)} onReject={(submission) => void rejectSubmission(submission)} onRefresh={() => setSubmissionRevision((value) => value + 1)} />
      ) : (<>
      {submissionId && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>{masMode
            ? "Editing a submission you sent. Submit again when it is fixed."
            : `Reviewing a submission from ${mas} (${branch}). Check every sale and correct anything wrong (a MAS submission is not sent back), add the Date Remitted and the control total, then save.`}</p>
          <Button type="button" variant="outline" size="sm" onClick={resetForm}>{masMode ? "Stop editing" : "Stop reviewing"}</Button>
        </div>
      )}

      {/* =====================================================
          BATCH INFORMATION
      ====================================================== */}
      {masMode ? (
        <Card>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 md:pt-2">
            <div className={`space-y-1 md:space-y-2 ${masProfile && masProfile.branches.length > 1 ? "col-span-2 md:col-span-1" : ""}`}>
              <Label>Branch *</Label>
              {masProfile && masProfile.branches.length > 1
                ? <SearchSelect aria-label="Branch" value={branch} placeholder="Choose your branch" options={masProfile.branches.map((item) => ({ value: item.name, label: item.name }))} onValueChange={setBranch} />
                : <p className="text-sm font-medium md:rounded-md md:border md:bg-muted/30 md:px-3 md:py-2 md:font-normal">{branch || "No branch assigned"}</p>}
            </div>
            <div className="space-y-1 md:space-y-2">
              <Label><span className="md:hidden">MAS</span><span className="hidden md:inline">Marketing Account Staff</span></Label>
              <p className="text-sm font-medium md:rounded-md md:border md:bg-muted/30 md:px-3 md:py-2 md:font-normal">{mas || "Loading..."}</p>
            </div>
            <div className="hidden space-y-2 md:block">
              <Label>Submitted on</Label>
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{showDate(today)}; each sale&apos;s date enrolled is its application date</p>
            </div>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Batch Information
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <ParkedDrafts drafts={parked.drafts} canPark={batchHasWork} onPark={parkBatch} onResume={resumeBatch} onDelete={parked.remove} />
          <ClearingPicker kind="New Sales" value={clearingId} disabled={Boolean(submissionId)} onPick={(clearing) => {
            setClearingId(clearing.id); setBranch(clearing.branch); setMas(clearing.employeeName); setDateRemitted(clearing.clearedDate); setClearedDate(clearing.clearedDate); setDateRemittedReason("");
            setSales((current) => current.map((sale) => ({ ...sale, program: { ...sale.program, branch: clearing.branch, mas: clearing.employeeName } })));
          }} />
          <div className="grid gap-4 md:grid-cols-3">
            {/* Branch */}
            <div className="space-y-2">
              <Label>
                Branch *
              </Label>

              <SearchSelect aria-label="Branch" value={branch} disabled placeholder="From Clearing" options={branches.filter((item) => item.status === "active").map((item) => ({ value: item.name, label: item.name, description: item.territory || "Unassigned territory" }))} onValueChange={(selected) => { setBranch(selected); setMas(""); setSales((current) => current.map((sale) => ({...sale,program:{...sale.program,branch:selected,mas:""}}))); }}/>
            </div>

            {/* MAS */}
            <div className="space-y-2">
              <Label>
                Marketing Account Staff *
              </Label>

              <SearchSelect aria-label="Marketing Account Staff" value={mas} placeholder="From Clearing" disabled options={masStaff.filter((staff) => { const branchId=branches.find((item) => item.name === branch)?.id; return Boolean(branchId && staff.branchIds.includes(branchId)); }).map((staff) => ({ value: staff.fullName, label: staff.fullName, description: staff.employeeId }))} onValueChange={(selected) => { setMas(selected); setSales((current) => current.map((sale) => ({...sale,program:{...sale.program,mas:selected}}))); }}/>
            </div>

            {/* Date Remitted */}
            <div className="space-y-2">
              <Label>
                Date Remitted *
              </Label>

              {/* Starts on the clearing day and can be changed with a reason (owner, October 13, 2026). A MAS submission has
                  no clearing pick, so its date is typed in. */}
              <Input
                type="date"
                aria-label="Date Remitted"
                value={dateRemitted}
                max={manilaNow().date}
                disabled={!submissionId && !clearedDate}
                onChange={(event) =>
                  setDateRemitted(event.target.value)
                }
              />

              <p className="text-xs text-muted-foreground">
                {submissionId ? "The day this MAS was cleared for New Sales." : "Starts on the day the receipts were cleared; Branch and MAS come from Clearing."}
              </p>

              {(dateRemittedChanged || Boolean(submissionId)) && (
                <div className="space-y-1">
                  <Label className="text-xs text-amber-800">{submissionId ? "Reason, if the Date Remitted is not the day the MAS was cleared" : "Why was the Date Remitted changed? *"}</Label>
                  <Input aria-label="Reason for changing the Date Remitted" value={dateRemittedReason} maxLength={300} onChange={(event) => setDateRemittedReason(event.target.value)} placeholder="e.g. Remitted on this day; encoding delayed by a meeting" />
                  {!submissionId && <p className="text-xs text-muted-foreground">Cleared on {clearedDate}. The reason is kept with every sale of the batch.</p>}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* =====================================================
          SALES
      ====================================================== */}
      <div className="space-y-4">
        {sales.map(
          (sale, index) => {
            const expanded =
              expandedSales[sale.id] ??
              true;

            const selectedProgram = programOf(sale);

            const matchingMembers =
              memberSearchResults[sale.id] ?? [];

            const searchedSurname =
              memberSearchTerms[sale.id]
                ?.trim()
                .toLowerCase();

            const currentSurname =
              sale.member.name.surname
                .trim()
                .toLowerCase();

            const showMemberChoices =
              currentSurname.length >= 2 &&
              searchedSurname === currentSurname &&
              matchingMembers.length > 0;

            return (
              <div
                key={sale.id}
                ref={(element) => {
                  saleRefs.current[sale.id] = element;
                }}
                className={masMode ? "scroll-mt-14" : undefined}
              >
              <Card className="receipt-entry-card">
                <CardHeader className={expanded ? "border-b" : undefined}>
                  <div className="flex items-center justify-between gap-2 md:gap-4">
                    {/* The whole heading folds the sale: the arrow alone is a small target on a phone. */}
                    <div className="flex min-w-0 flex-1 cursor-pointer items-center gap-x-3 gap-y-1 max-md:flex-wrap" onClick={() => toggleSale(sale.id)}>
                      <Badge variant="secondary">
                        Sale #{index + 1}
                      </Badge>

                      {sale.member
                        .phMemberNumber && (
                        <span className="text-sm text-muted-foreground">
                          PH/Member:{" "}
                          {
                            sale.member
                              .phMemberNumber
                          }
                        </span>
                      )}

                      {/* A folded sale shows what was typed, so the clerk can check it without opening it. */}
                      {!expanded && (
                        <span className="truncate text-sm max-md:w-full max-md:whitespace-normal">
                          <strong>{[sale.member.name.surname, sale.member.name.firstName].filter(Boolean).join(", ") || "No name yet"}</strong>
                          <span className="text-muted-foreground"> · {programOf(sale)?.name || sale.program.programCode || "no program"} · {peso(amountPaidOf(sale))} · App {sale.applicationNumber || "—"}{saleQuotes[index] && !("error" in saleQuotes[index]!) ? ` · Incentive ${peso(saleQuotes[index]!.incentive)} · Remittance ${peso(saleQuotes[index]!.remittance)}` : ""}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {sales.length >
                        1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove Sale #${index + 1}`}
                          onClick={async () => {
                            // A MAS fills the cards on a phone: one stray tap must not lose a typed sale.
                            if (masMode && (sale.member.name.surname.trim() || sale.program.programCode) && !await confirmDialog(`Remove Sale #${index + 1}? What was typed on it is lost.`)) return;
                            removeSale(sale.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${expanded ? "Fold" : "Open"} Sale #${index + 1}`}
                        aria-expanded={expanded}
                        onClick={() =>
                          toggleSale(
                            sale.id,
                          )
                        }
                      >
                        {expanded ? (
                          <ChevronUp className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {expanded && (
                  <CardContent className="space-y-6 pt-5">
                    {/* A. APPLICATION AND PROGRAM: the receipt fields come first, side by side (October 9, 2026). */}
                    <section className="space-y-3">
                      <h2 className="font-semibold">A. Application and Program</h2>
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="space-y-2">
                          <Label>
                            Application No. *
                          </Label>

                          <Input
                            value={
                              sale.applicationNumber
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  applicationNumber:
                                    event
                                      .target
                                      .value,
                                }),
                              )
                            }
                            autoCapitalize="characters"
                            autoComplete="off"
                            autoCorrect="off"
                            enterKeyHint="next"
                            placeholder="Application number"
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
                          <div className="space-y-2">
                          <Label>
                            Application Date *
                          </Label>

                          <Input
                            type="date"
                            value={
                              sale.orDate
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  orDate:
                                    event
                                      .target
                                      .value,
                                }),
                              )
                            }
                          />
                          </div>
                          {/* The DOI time (owner, October 19, 2026): some programs need it; the encoding time unless changed. */}
                          <div className="space-y-2">
                          <Label htmlFor={`${sale.id}-doi-time`}>DOI time</Label>
                          <Input id={`${sale.id}-doi-time`} type="time" value={sale.doiTime ?? ""} onChange={(event) => updateSale(sale.id, (current) => ({ ...current, doiTime: event.target.value }))} />
                          </div>
                          </div>
                          <p className="text-xs text-muted-foreground">The application date is also the date enrolled (DOI). The time is when it is encoded; change it when the member enrolled at another time. Left blank, the time of saving is used.</p>
                          {dateWarnings({ receiptDate: sale.orDate, receiptLabel: "application date", dateRemitted, today: manilaNow().date }).map((warning) => <p key={warning} className="text-xs font-medium text-amber-800">⚠ {warning}</p>)}
                          {isLateDate(sale.orDate) && (
                            <div className="space-y-1">
                              <Label className="text-xs text-amber-800">Reason for the late entry *</Label>
                              <Input value={sale.backdateReason ?? ""} onChange={(event) => updateSale(sale.id, (current) => ({ ...current, backdateReason: event.target.value }))} placeholder="e.g. Application turned over late by the MAS" />
                              <p className="text-xs text-muted-foreground">The application date is more than one working day old. Administrators review late entries.</p>
                            </div>
                          )}
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>
                            Program Type *
                          </Label>

                          <SearchSelect
                            aria-label="Program Type"
                            value={programOf(sale)?.id ?? ""}
                            disabled={programLoading || availablePrograms.length === 0}
                            placeholder={programLoading ? "Loading programs..." : "Search program code or name"}
                            options={availablePrograms.map((program) => ({ value: program.id, label: program.name && program.name !== program.code ? `${program.code} - ${program.name}` : program.code }))}
                            onValueChange={(id) => {
                              const chosen = availablePrograms.find((program) => program.id === id);
                              updateSale(sale.id, (current) => ({
                                ...current,
                                program: {
                                  ...current.program,
                                  programId: chosen?.id ?? "",
                                  programCode: chosen?.code ?? "",
                                  withRegistrationFee: Boolean(chosen?.registrationFeeRequired),
                                  registrationAmount: chosen?.registrationFeeRequired ? chosen.registrationAmount : 0,
                                  amountPaid: chosen && !chosen.newSaleAmountEditable ? defaultNewSaleAmount(chosen) : chosen?.registrationFeeRequired ? chosen.registrationAmount : 0,
                                },
                              }));
                            }}
                          />

                          {programLoading && (
                            <p className="text-xs text-muted-foreground">
                              Loading programs...
                            </p>
                          )}

                          {!programLoading &&
                            programError && (
                              <p className="text-xs text-destructive">
                                {programError}
                              </p>
                            )}

                          {!programLoading &&
                            !programError &&
                            availablePrograms.length ===
                              0 && (
                              <p className="text-xs text-destructive">
                                No program found.
                              </p>
                            )}
                          {selectedProgram && (
                            <p className="text-xs text-muted-foreground">
                              {selectedProgram.name} · base pay ₱{Number(monthlyPay(selectedProgram)).toLocaleString("en-PH", { minimumFractionDigits: 2 })}{String(selectedProgram.status ?? "").trim().toLowerCase() === "active" ? "" : ` · ${String(selectedProgram.status ?? "Unknown")}`}
                            </p>
                          )}
                        </div>
                      </div>
                      {/* MAS: what this sale earns them and what they hand over, as soon as the program and amount are in. */}
                      {masMode && saleQuotes[index] && !("error" in saleQuotes[index]!) && <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-2 text-center text-sm">
                        <div><dt className="text-[11px] text-muted-foreground">Collect</dt><dd className="font-semibold tabular-nums">{peso(amountPaidOf(sale))}</dd></div>
                        <div><dt className="text-[11px] text-muted-foreground">Your incentive</dt><dd className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{peso(saleQuotes[index]!.incentive)}</dd></div>
                        <div><dt className="text-[11px] text-muted-foreground">To remit</dt><dd className="font-semibold tabular-nums">{peso(saleQuotes[index]!.remittance)}</dd></div>
                      </dl>}
                      {/* The clerk checks each sale on its card (owner, November 5, 2026). */}
                      {!masMode && saleQuotes[index] && !("error" in saleQuotes[index]!) && <div className="rounded-md bg-muted/40 p-2"><EntryFigures account="NS" nop={selectedProgram?.registrationFeeRequired ? "Registration" : "1"} collected={amountPaidOf(sale)} incentive={saleQuotes[index]!.incentive} remittance={saleQuotes[index]!.remittance} basis={saleQuotes[index]!.basis} incentiveLabel="MAS incentive" /></div>}
                      {/* The clerk sees this in the totals card; a MAS has no totals card, so it shows on the sale. */}
                      {masMode && saleQuotes[index] && "error" in saleQuotes[index]! && <p role="alert" className="text-sm text-destructive">Your incentive cannot be worked out: {(saleQuotes[index] as { error: string }).error} Ask the office.</p>}
                      {/* NO INCENTIVE (owner, October 20, 2026): this one sale earns the MAS nothing; it is remitted whole. */}
                      {!masMode && <div className={`rounded-md border px-3 py-2 text-sm ${noIncentiveOn(sale) ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : ""}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" size="sm" variant={noIncentiveOn(sale) ? "destructive" : "outline"} aria-pressed={noIncentiveOn(sale)} onClick={() => updateSale(sale.id, (current) => ({ ...current, noIncentive: !noIncentiveOn(current) }))}>{noIncentiveOn(sale) ? "No incentive ✓" : "No incentive"}</Button>
                          <span className="text-xs text-muted-foreground">{noIncentiveOn(sale) ? "The MAS earns no incentive on this sale; the whole amount is remitted. Click again to undo." : "Click when the MAS should not earn an incentive on this sale."}</span>
                        </div>
                        {noIncentiveOn(sale) && <div className="mt-2 space-y-1">
                          <Label className="text-xs text-red-800 dark:text-red-300">Reason for no incentive *</Label>
                          <Input maxLength={300} value={sale.noIncentiveReason ?? ""} onChange={(event) => updateSale(sale.id, (current) => ({ ...current, noIncentiveReason: event.target.value }))} placeholder="e.g. Walk-in member, not brought in by the MAS" />
                        </div>}
                      </div>}
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <div className="col-span-2 space-y-2 md:col-span-1">
                        <Label>
                          Amount Paid *
                        </Label>

                        <Input
                          type="number"
                          inputMode="decimal"
                          enterKeyHint="next"
                          min="0"
                          readOnly={Boolean(lockedProgram(sale))}
                          className={lockedProgram(sale) ? "bg-muted/50" : undefined}
                          value={
                            amountPaidOf(sale) ||
                            ""
                          }
                          onWheel={(event) => event.currentTarget.blur()}
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              (current) => ({
                                ...current,

                                program: {
                                  ...current.program,

                                  amountPaid:
                                    Number(
                                      event
                                        .target
                                        .value,
                                    ) || 0,
                                },
                              }),
                            )
                          }
                          placeholder="0.00"
                        />
                        {lockedProgram(sale) && <p className="text-xs text-muted-foreground">Fixed by the program{lockedProgram(sale)?.registrationFeeRequired ? " (registration amount)" : " (first month's base pay)"}. An administrator can allow editing in Programs.</p>}
                      </div>
                        <div className="space-y-2">
                          <Label>
                            Registration Fee *
                          </Label>

                          <Select
                            value={
                              sale.program
                                .withRegistrationFee
                                ? "yes"
                                : "no"
                            }
                            disabled
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Registration fee" />
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
                            min="0"
                            value={
                              sale.program
                                .registrationAmount ||
                              ""
                            }
                            disabled
                            onWheel={(event) => event.currentTarget.blur()}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    </section>

                    <Separator />

                    {/* PERSONAL DATA */}
                    <section className="space-y-4">
                      <div>
                        <h2 className="font-semibold">
                          B. Personal Data
                        </h2>

                        <p className="text-sm text-muted-foreground">
                          Member information.
                        </p>
                      </div>

                      {sale.member.id && (
                        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                          <p>
                            <span className="font-semibold">Existing member {sale.member.phMemberNumber}{sale.member.birthdate ? `, born ${showDate(sale.member.birthdate)}` : ""}.</span>{" "}
                            Details below come from their record. Any change you make here updates the member&apos;s record when this batch is saved.
                          </p>
                          <Button type="button" size="sm" variant="outline" onClick={() => unlinkExistingMember(sale.id)}>
                            Not this member
                          </Button>
                        </div>
                      )}

                      {sale.member.id && (
                        <MemberStandingWarning
                          standing={memberStandings[sale.member.id]}
                        />
                      )}

                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                        <div className="col-span-2 space-y-2 md:col-span-1">
                          <Label>
                            Surname *
                          </Label>

                          <Input
                            value={
                              sale.member
                                .name
                                .surname
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    name: {
                                      ...current
                                        .member
                                        .name,

                                      surname:
                                        event
                                          .target
                                          .value,
                                    },
                                  },
                                }),
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                dismissMemberChoices(sale.id);
                              }
                            }}
                            onBlur={() =>
                              window.setTimeout(
                                () =>
                                  dismissMemberChoices(
                                    sale.id,
                                  ),
                                150,
                              )
                            }
                            {...nameField}
                            placeholder="Surname"
                          />

                          {showMemberChoices && (
                            <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain rounded-md border bg-muted/30 p-2">
                              <p className="px-1 text-xs text-muted-foreground">
                                Select the existing member to load their details.
                              </p>

                              {matchingMembers.map(
                                (member) => (
                                  <Button
                                    key={member.id}
                                    type="button"
                                    variant="ghost"
                                    className="h-auto w-full justify-start px-2 py-2 text-left"
                                    onMouseDown={(event) =>
                                      event.preventDefault()
                                    }
                                    onClick={() =>
                                      selectExistingMember(
                                        sale.id,
                                        member,
                                      )
                                    }
                                  >
                                    <span className="flex min-w-0 flex-col">
                                      <span className="truncate">
                                        {[
                                          member.name.surname,
                                          member.name.firstName,
                                          member.name.middleName,
                                          member.name.nameExtension,
                                        ]
                                          .filter(Boolean)
                                          .join(", ")}
                                      </span>

                                      {member.phMemberNumber && (
                                        <span className="text-xs font-normal text-muted-foreground">
                                          PH/Member: {member.phMemberNumber}
                                        </span>
                                      )}
                                    </span>
                                  </Button>
                                ),
                              )}
                            </div>
                          )}
                        </div>

                        <div className="col-span-2 space-y-2 md:col-span-1">
                          <Label>
                            First Name *
                          </Label>

                          <Input
                            value={
                              sale.member
                                .name
                                .firstName
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    name: {
                                      ...current
                                        .member
                                        .name,

                                      firstName:
                                        event
                                          .target
                                          .value,
                                    },
                                  },
                                }),
                              )
                            }
                            {...nameField}
                            placeholder="First Name"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Middle Name
                          </Label>

                          <Input
                            value={
                              sale.member
                                .name
                                .middleName
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    name: {
                                      ...current
                                        .member
                                        .name,

                                      middleName:
                                        event
                                          .target
                                          .value,
                                    },
                                  },
                                }),
                              )
                            }
                            {...nameField}
                            placeholder="Middle Name"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Name Extension
                          </Label>

                          <Input
                            value={
                              sale.member
                                .name
                                .nameExtension
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    name: {
                                      ...current
                                        .member
                                        .name,

                                      nameExtension:
                                        event
                                          .target
                                          .value,
                                    },
                                  },
                                }),
                              )
                            }
                            {...nameField}
                            placeholder="Jr., Sr., III"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                        <div className="col-span-2 space-y-2 md:col-span-1">
                          <Label>
                            Birthdate *
                          </Label>

                          <Input
                            type="date"
                            max={today}
                            value={
                              sale.member
                                .birthdate
                            }
                            onChange={(event) => {
                              const birthdate =
                                event.target
                                  .value;

                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    birthdate,

                                    age: calculateAge(
                                      birthdate,
                                    ),
                                  },
                                }),
                              );
                            }}
                          />
                        </div>

                        <div className="col-span-2 space-y-2 md:col-span-1">
                          <Label>
                            Birthplace
                          </Label>

                          <Input
                            value={
                              sale.member
                                .birthplace
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    birthplace:
                                      event
                                        .target
                                        .value,
                                  },
                                }),
                              )
                            }
                            {...nameField}
                            placeholder="Birthplace"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Gender *
                          </Label>

                          <Select
                            value={
                              sale.member
                                .gender
                            }
                            onValueChange={(
                              value,
                            ) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    gender:
                                      value ?? "",
                                  },
                                }),
                              )
                            }
                          >
                            <SelectTrigger className="w-full">
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
                          <Label>
                            Age
                          </Label>

                          <Input
                            type="number"
                            min={0}
                            max={Number(today.slice(0, 4)) - 100}
                            step={1}
                            value={
                              calculateAge(
                                sale.member.birthdate,
                              ) ?? ""
                            }
                            onChange={(event) => {
                              const value = event.target.value;
                              const age = value === "" ? null : Number(value);
                              if (age !== null && (!Number.isInteger(age) || age < 0 || age > Number(today.slice(0, 4)) - 100)) return;
                              updateSale(sale.id, (current) => ({
                                ...current,
                                member: {
                                  ...current.member,
                                  age,
                                  birthdate: age === null ? "" : birthdateFromAge(age),
                                },
                              }));
                            }}
                            inputMode="numeric"
                            enterKeyHint="next"
                            placeholder="Auto"
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>
                            Civil Status *
                          </Label>

                          <Select
                            value={
                              sale.member
                                .civilStatus
                            }
                            onValueChange={(
                              value,
                            ) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    civilStatus:
                                      value ?? "",
                                  },
                                }),
                              )
                            }
                          >
                            <SelectTrigger className="w-full">
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
                          <Label>
                            Contact Number *
                          </Label>

                          <Input
                            value={
                              sale.member
                                .contactNumber
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    contactNumber: formatContactNumber(event.target.value),
                                    claimant: {
                                      ...current.member.claimant,
                                      contactNumber: current.member.claimant.sameAsMemberContact
                                        ? formatContactNumber(event.target.value)
                                        : current.member.claimant.contactNumber,
                                    },
                                  },
                                }),
                              )
                            }
                            {...phoneField}
                            placeholder="09XXXXXXXXX"
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <Label>
                            Present Address *
                          </Label>

                          <p className="text-sm text-muted-foreground">
                            Enter the complete address in one line.
                          </p>
                        </div>

                        <div className="grid gap-4">
                          {(
                            [
                              ["houseBlockLot","Complete Address *"],
                            ] as const
                          ).map(
                            ([field, label]) => (
                              <div
                                key={field}
                                className="space-y-2"
                              >
                                <Label>
                                  {label}
                                </Label>

                                <Input
                                  value={
                                    sale
                                      .member
                                      .address[
                                      field
                                    ]
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    updateMemberAddress(
                                      sale.id,
                                      field,
                                      event
                                        .target
                                        .value,
                                    )
                                  }
                                  {...nameField}
                                  placeholder={
                                    label
                                  }
                                />
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </section>

                    <Separator />

                    {/* BENEFICIARIES */}
                    <section className="space-y-4">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                          <h2 className="font-semibold">
                            C. Beneficiaries
                          </h2>

                          <p className="text-sm text-muted-foreground">
                            If applicable and
                            eligible for the
                            program.
                          </p>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            addBeneficiary(
                              sale.id,
                            )
                          }
                        >
                          <Plus className="mr-2 size-4" />
                          Add Beneficiary
                        </Button>
                      </div>

                      {sale.beneficiaries.map(
                        (
                          beneficiary,
                          beneficiaryIndex,
                        ) => (
                          <div
                            key={
                              beneficiary.id
                            }
                            className="rounded-lg border p-3 md:p-4"
                          >
                            <div className="mb-4 flex items-center justify-between">
                              <p className="font-medium">
                                Beneficiary{" "}
                                {beneficiaryIndex +
                                  1}
                              </p>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove Beneficiary ${beneficiaryIndex + 1}`}
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

                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
                              <Input
                                className="col-span-2 md:col-span-1"
                                {...nameField}
                                placeholder="Surname"
                                value={
                                  beneficiary.surname
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateBeneficiary(
                                    sale.id,
                                    beneficiary.id,
                                    "surname",
                                    event
                                      .target
                                      .value,
                                  )
                                }
                              />

                              <Input
                                className="col-span-2 md:col-span-1"
                                {...nameField}
                                placeholder="First Name"
                                value={
                                  beneficiary.firstName
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateBeneficiary(
                                    sale.id,
                                    beneficiary.id,
                                    "firstName",
                                    event
                                      .target
                                      .value,
                                  )
                                }
                              />

                              <Input
                                {...nameField}
                                placeholder="Middle Name"
                                value={
                                  beneficiary.middleName
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateBeneficiary(
                                    sale.id,
                                    beneficiary.id,
                                    "middleName",
                                    event
                                      .target
                                      .value,
                                  )
                                }
                              />

                              <Input
                                type="number"
                                inputMode="numeric"
                                enterKeyHint="next"
                                placeholder="Age"
                                value={
                                  beneficiary.age ??
                                  ""
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateBeneficiary(
                                    sale.id,
                                    beneficiary.id,
                                    "age",
                                    event
                                      .target
                                      .value,
                                  )
                                }
                              />

                              {/* The other fields show their name inside; an empty date field on a phone shows nothing. */}
                              <div className="col-span-2 space-y-1 md:col-span-1 md:space-y-0">
                              <Label htmlFor={`${beneficiary.id}-birthdate`} className="md:sr-only">Birthdate</Label>
                              <Input
                                id={`${beneficiary.id}-birthdate`}
                                type="date"
                                max={today}
                                value={
                                  beneficiary.birthdate
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateBeneficiary(
                                    sale.id,
                                    beneficiary.id,
                                    "birthdate",
                                    event
                                      .target
                                      .value,
                                  )
                                }
                              />
                              </div>

                              <Input
                                className="col-span-2 md:col-span-1"
                                {...nameField}
                                placeholder="Relationship"
                                value={
                                  beneficiary.relationship
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateBeneficiary(
                                    sale.id,
                                    beneficiary.id,
                                    "relationship",
                                    event
                                      .target
                                      .value,
                                  )
                                }
                              />
                            </div>
                          </div>
                        ),
                      )}
                    </section>

                    <Separator />

                    {/* CLAIMANT */}
                    <section className="space-y-5">
                      <div>
                        <h2 className="font-semibold">
                          D. Claimant Information
                        </h2>

                        <p className="text-sm text-muted-foreground">
                          The person authorized
                          to claim the
                          member&apos;s benefits.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>
                            Complete Name *
                          </Label>

                          <Input
                            value={
                              sale.member
                                .claimant
                                .completeName
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    claimant: {
                                      ...current
                                        .member
                                        .claimant,

                                      completeName:
                                        event
                                          .target
                                          .value,
                                    },
                                  },
                                }),
                              )
                            }
                            {...nameField}
                            placeholder="Complete name of claimant"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Contact Number *
                          </Label>

                          <Input
                            disabled={sale.member.claimant.sameAsMemberContact ?? false}
                            value={
                              sale.member
                                .claimant
                                .contactNumber
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  member: {
                                    ...current.member,

                                    claimant: {
                                      ...current
                                        .member
                                        .claimant,

                                      contactNumber: formatContactNumber(event.target.value),
                                    },
                                  },
                                }),
                              )
                            }
                            {...phoneField}
                            placeholder="09XXXXXXXXX"
                          />
                          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium max-md:min-h-11">
                            <input
                              type="checkbox"
                              checked={sale.member.claimant.sameAsMemberContact ?? false}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                updateSale(sale.id, (current) => ({
                                  ...current,
                                  member: {
                                    ...current.member,
                                    claimant: {
                                      ...current.member.claimant,
                                      sameAsMemberContact: checked,
                                      contactNumber: checked
                                        ? current.member.contactNumber
                                        : current.member.claimant.contactNumber,
                                    },
                                  },
                                }));
                              }}
                              className="size-4 rounded border-input"
                            />
                            Same with member
                          </label>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                          <div>
                            <Label>
                              Address *
                            </Label>
                          </div>

                          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium max-md:min-h-11">
                            <input
                              type="checkbox"
                              checked={
                                sale.member
                                  .claimant
                                  .sameAsMemberAddress
                              }
                              onChange={(event) =>
                                toggleClaimantAddress(
                                  sale.id,
                                  event
                                    .target
                                    .checked,
                                )
                              }
                              className="size-4 rounded border-input"
                            />

                            Same as Member&apos;s
                            Address
                          </label>
                        </div>

                        <div className="grid gap-4">
                          {(
                            [
                              ["houseBlockLot","Complete Address"],
                            ] as const
                          ).map(
                            ([field, label]) => (
                              <div
                                key={field}
                                className="space-y-2"
                              >
                                <Label>
                                  {label}
                                </Label>

                                <Input
                                  value={
                                    sale
                                      .member
                                      .claimant
                                      .address[
                                      field
                                    ]
                                  }
                                  disabled={
                                    sale
                                      .member
                                      .claimant
                                      .sameAsMemberAddress
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    updateSale(
                                      sale.id,
                                      (current) => ({
                                        ...current,

                                        member: {
                                          ...current.member,

                                          claimant: {
                                            ...current
                                              .member
                                              .claimant,

                                            address:
                                              updateAddress(
                                                current
                                                  .member
                                                  .claimant
                                                  .address,
                                                field,
                                                event
                                                  .target
                                                  .value,
                                              ),
                                          },
                                        },
                                      }),
                                    )
                                  }
                                  {...nameField}
                                  placeholder={
                                    label
                                  }
                                />
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </section>

                    <Separator />

                    {/* E. NOTES */}
                    <section className="space-y-2">
                      <div className="space-y-2">
                        <Label>
                          Notes
                        </Label>

                        <Textarea
                          value={
                            sale.program
                              .programTerms
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              (current) => ({
                                ...current,

                                program: {
                                  ...current.program,

                                  programTerms:
                                    event
                                      .target
                                      .value,
                                },
                              }),
                            )
                          }
                          placeholder="Optional notes about this enrollment"
                        />
                      </div>
                    </section>
                  </CardContent>
                )}
              </Card>
              </div>
            );
          },
        )}
      </div>

      {/* ADD SALE */}
      <Button
        type="button"
        variant="outline"
        className="w-full border-dashed"
        onClick={addSale}
      >
        <Plus className="mr-2 size-4" />
        Add New Sale
      </Button>

      {/* PENALTY AND FIDELITY (optional) and the totals; the control total and Save are in the bar below. */}
      {!masMode && <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="max-w-sm space-y-1">
            <Label htmlFor="sales-remittance-method">Remittance method (whole batch) *</Label>
            <select id="sales-remittance-method" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              {!paymentMethods.length && <option value="">Loading...</option>}
              {paymentMethods.map((method) => <option key={method.name} value={method.name}>{method.name}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{allCash ? "Cash: no receipt photo needed." : "Not cash: add the receipt photo of the transfer below."}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
          <fieldset className={`space-y-2 rounded-lg border p-3 ${penaltyAmount > 0 ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20" : ""}`}>
            <legend className="px-1 text-sm font-medium">Remittance penalty (optional)</legend>
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <div className="space-y-1">
                <Label htmlFor="sales-penalty-amount">Penalty amount</Label>
                <Input id="sales-penalty-amount" type="number" min="0" step="0.01" value={penalty} placeholder="0.00" onChange={(event) => setPenalty(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sales-penalty-note">What is the penalty for?{penaltyAmount > 0 ? " *" : ""}</Label>
                <Input id="sales-penalty-note" maxLength={300} value={penaltyNote} disabled={penaltyAmount <= 0} placeholder={penaltyAmount > 0 ? "e.g. Late turnover of new sales" : "Enter a penalty amount first"} onChange={(event) => setPenaltyNote(event.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Charged to the MAS, paid from their own money, and added to this batch&apos;s New Sales remittance. Members are not charged.</p>
          </fieldset>
          <fieldset className={`space-y-2 rounded-lg border p-3 ${fidelityAmount > 0 ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20" : ""}`}>
            <legend className="px-1 text-sm font-medium">Fidelity</legend>
            <div className="grid gap-3 sm:grid-cols-[160px_1fr] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="sales-fidelity-amount">Fidelity amount</Label>
                <Input id="sales-fidelity-amount" type="number" min="0" step="0.01" value={fidelity} placeholder="0.00" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setFidelity(event.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">The MAS&apos;s own money for their Fidelity savings (zero is allowed); added to the remittance, incentives unchanged.</p>
            </div>
          </fieldset>
          </div>
          {quoteProblem && <p role="alert" className="text-sm text-destructive">{quoteProblem.error}</p>}
          <RemittanceSummary collected={totalPaid} remittance={totalSaleRemittance} fidelity={fidelityAmount} penalty={penaltyAmount} penaltyNote={penaltyNote.trim()} incentiveNote="From each program's New Sale incentive, or its month-1 MAS tier when there is no registration fee." />
        </CardContent>
      </Card>}

      {showPreview && <div ref={previewRef} className={`rounded-xl border border-primary/30 bg-primary/5 p-4 ${masMode ? "scroll-mt-14" : ""}`}><p className="font-semibold">{masMode ? "Review before submitting" : "Review before saving"}</p><div className="mt-3 grid gap-3 md:grid-cols-2">{sales.map((sale, index) => { const program = programOf(sale); return <div key={sale.id} className="rounded-lg border bg-background p-3 text-sm"><strong>Sale {index + 1}: {[sale.member.name.firstName, sale.member.name.surname].filter(Boolean).join(" ") || "Unnamed member"}</strong><p>{program?.name || "No program"} · {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amountPaidOf(sale))}</p><p>MAS incentive {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(saleQuotes[index]?.incentive ?? 0)} · remit {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(saleQuotes[index]?.remittance ?? 0)}</p><p>APP {sale.applicationNumber || "—"} · DOI {showDate(sale.orDate) || "—"}{sale.doiTime ? ` ${sale.doiTime}` : ""}</p><p>Registration {sale.program.withRegistrationFee ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(sale.program.registrationAmount) : "None"}</p>{sale.program.programTerms && <p className="mt-1 text-muted-foreground">Notes: {sale.program.programTerms}</p>}{Boolean(sale.member.id && memberStandings[sale.member.id]?.programs.length) && <p className="mt-1 flex items-center gap-1 font-medium text-amber-700"><TriangleAlert className="size-3.5" />Existing member has {memberStandings[sale.member.id].programs.map((program) => `${program.programName} ${program.standing.toLowerCase()}`).join(", ")}.</p>}</div>; })}</div><p className="mt-3 font-medium">Total amount collected: {peso(totalPaid)}{!masMode && saleTotalDue !== null ? ` · Total remittance: ${peso(saleTotalDue)}` : ""}</p>{!masMode && (() => { const turnover = controlTotalDifference(controlTotal, saleTotalDue); return turnover ? <p className="font-semibold text-amber-700">Turnover sheet {varianceLabel(turnover).toLowerCase()}: this batch saves and its slip goes to Discrepancy.</p> : null; })()}</div>}

      {/* RECEIPT PHOTOS: at least one required, as many as needed (owner, October 14, 2026); not for a MAS submit. */}
      {!masMode && <ReceiptPhotosPicker photos={receiptPhotos} onChange={setReceiptPhotos} kind="sale" optional={allCash} />}

      {/* SAVE BAR (October 9, 2026): fixed to the bottom of the screen with the totals, the control total and Save, so a
          batch is finished without scrolling to the end of the page. */}
      <div className="sticky bottom-0 z-20 rounded-t-xl border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <div className="min-w-0 flex-1 text-sm">
            {/* MAS on a phone: three short columns, as on Submit Collections, so the bar leaves the form its room. */}
            {masMode ? <dl className="grid grid-cols-3 gap-2 text-center md:flex md:flex-wrap md:items-baseline md:gap-x-4 md:gap-y-1 md:text-left">
              <div><dt className="text-[11px] text-muted-foreground md:inline md:text-sm">Collected ({sales.length} {sales.length === 1 ? "sale" : "sales"})</dt> <dd className="font-bold tabular-nums md:inline md:text-lg">{peso(totalPaid)}</dd></div>
              <div><dt className="text-[11px] text-muted-foreground md:inline md:text-sm">Your incentive</dt> <dd className="font-bold tabular-nums text-emerald-700 md:inline dark:text-emerald-400">{totalSaleRemittance === null ? "—" : peso(Math.round((totalPaid - totalSaleRemittance) * 100) / 100)}</dd></div>
              <div><dt className="text-[11px] text-muted-foreground md:inline md:text-sm">To remit</dt> <dd className="font-bold tabular-nums md:inline">{totalSaleRemittance === null ? "—" : peso(totalSaleRemittance)}</dd></div>
            </dl> : <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span>Total amount collected <strong className="text-lg tabular-nums">{peso(totalPaid)}</strong></span>
              <span className="text-muted-foreground">Total remittance <strong className="tabular-nums text-foreground">{saleTotalDue === null ? "pending" : peso(saleTotalDue)}</strong></span>
              <span className="text-muted-foreground">{sales.length} {sales.length === 1 ? "sale" : "sales"}</span>
            </p>}
            <p className={`truncate text-muted-foreground ${masMode ? "hidden md:block" : ""}`}>{branch || "Branch not selected"} · {mas || "MAS not selected"}</p>
            {saveMessage && <p role="status" className="mt-1 font-medium">{saveMessage}</p>}
          </div>
          {!masMode && (
            <ControlTotalField id="sales-control-total" title="The net total the MAS wrote on the turnover sheet: amount paid less MAS incentives, plus Fidelity. Not the total collections, and not copied from the summary." value={controlTotal} onChange={setControlTotal} note={controlTotalNote} onNoteChange={setControlTotalNote} totalRemittance={saleTotalDue} />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="max-md:h-11" disabled={saving} onClick={async () => {
              // Reviewing, a MAS goes back to the cards; Cancel would clear them.
              if (masMode && showPreview) { setShowPreview(false); return; }
              // A MAS fills the cards on a phone: one stray tap must not wipe them.
              if (masMode && batchHasWork && !await confirmDialog(submissionId ? "Stop editing this submission? Your changes on the form are lost." : "Clear every sale card on the form?")) return;
              resetForm();
            }}>{masMode && showPreview ? "Back to edit" : "Cancel"}</Button>
            <Button type="button" className="max-md:h-11 max-md:flex-1 max-md:text-base" onClick={() => { if (showPreview) { void (masMode ? submitToClerk() : saveSales()); return; } void previewSales(); }} disabled={saving}>
              {saving ? (masMode ? "Submitting..." : "Saving...") : showPreview ? (masMode ? "Confirm and Submit" : "Confirm and Save") : "Preview Sales"}
            </Button>
          </div>
        </div>
      </div>
      </>)}
    </div>
  );
}

const submittedAt = (value: string) => value ? showDateTime(value) : "";
const memberNames = (submission: SubmissionSummary) => submission.sales.map((sale) => [sale.member?.name?.firstName, sale.member?.name?.surname].filter(Boolean).join(" ") || "Unnamed member").join(", ");

/** Clerk: MAS submissions waiting in their branches. */
/**
 * Clerk: New Sales the MAS submitted in their branches, oldest first. As on Collections (owner, November 3, 2026):
 * Mark remitted when the cash is handed over, Review to correct and save, Reject only a batch that should not be saved.
 */
function SubmissionList({ submissions, branchPicker, activeId, onOpen, onRemit, onReject, onRefresh }: { submissions: SubmissionSummary[]; branchPicker: ReactNode; activeId: string; onOpen: (submission: SubmissionSummary) => void; onRemit: (submission: SubmissionSummary) => void; onReject: (submission: SubmissionSummary) => void; onRefresh: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Submitted by MAS</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Only you can change a submission: correct anything wrong with Review, then save; it is not sent back to the MAS. When the MAS hands the cash over, press <strong>Mark remitted</strong> at once: that time decides the incentive (kept if by the deadline shown, 3:00 PM the next working day after the application date), so the details can be typed later. <strong>Reject</strong> only a batch that should not be saved at all, before Mark remitted.</p>
        {branchPicker}
        {!submissions.length && <p className="text-sm text-muted-foreground">No submissions waiting in your branches.</p>}
        {submissions.map((submission) => {
          const late = Boolean(submission.incentiveDeadline && submission.remittedAt > submission.incentiveDeadline);
          return (
            <div key={submission.id} className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${submission.id === activeId ? "border-primary bg-primary/5" : ""}`}>
              <div className="min-w-0 text-sm">
                <p className="font-semibold">{submission.mas} · {submission.branch}</p>
                <p className="text-muted-foreground">{submission.saleCount} sale{submission.saleCount === 1 ? "" : "s"} · {peso(submission.totalAmount)} · submitted {submittedAt(submission.submittedAt)}</p>
                {submission.status === "Remitted"
                  ? <p className={`font-medium ${late ? "text-amber-700" : "text-emerald-700"}`}>Remitted {submittedAt(submission.remittedAt)}{submission.remittedByName ? ` (${submission.remittedByName})` : ""}{submission.incentiveDeadline ? (late ? " · after the deadline: incentive forfeited" : " · in time: incentive kept") : ""} · details still to save</p>
                  : submission.incentiveDeadline && <p className="text-muted-foreground">Not yet remitted · incentive kept if received by {formatDeadline(submission.incentiveDeadline)}</p>}
                <p className="truncate">{memberNames(submission)}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {submission.status === "Submitted" && <Button type="button" size="sm" onClick={() => onRemit(submission)}>Mark remitted</Button>}
                <Button type="button" size="sm" variant={submission.status === "Remitted" ? "default" : "outline"} onClick={() => onOpen(submission)}>{submission.id === activeId ? "Continue review" : submission.status === "Remitted" ? "Review and save" : "Review"}</Button>
                {submission.status === "Submitted" && <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => onReject(submission)}>Reject</Button>}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** MAS: submissions the clerk sent back, with what to fix, at the top of the page so they are not missed. */
function ReturnedSubmissions({ submissions, onOpen }: { submissions: SubmissionSummary[]; onOpen: (submission: SubmissionSummary) => void }) {
  if (!submissions.length) return null;
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
      <p className="flex items-center gap-2 font-semibold text-red-800 dark:text-red-300"><TriangleAlert className="size-4" />{submissions.length === 1 ? "1 submission was" : `${submissions.length} submissions were`} returned to you to fix</p>
      {submissions.map((submission) => (
        <div key={submission.id} className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate font-medium">{memberNames(submission)}</p>
            <p className="text-muted-foreground">{submission.saleCount} sale{submission.saleCount === 1 ? "" : "s"} · {peso(submission.totalAmount)} · {submission.branch}</p>
            <p className="font-medium text-destructive">To fix: {submission.returnReason}{submission.reviewedByName ? ` (${submission.reviewedByName})` : ""}</p>
          </div>
          <Button type="button" className="h-11 shrink-0" onClick={() => onOpen(submission)}>Fix and resubmit</Button>
        </div>
      ))}
    </div>
  );
}

/**
 * MAS: their submissions. Once sent only the clerk changes one (marks it remitted when the cash is handed over, corrects
 * and saves it, or rejects it with a reason); rejected sales can be submitted again, and one returned before November 3,
 * 2026 can still be fixed and sent again.
 */
function MySubmissions({ submissions, activeId, onOpen }: { submissions: SubmissionSummary[]; activeId: string; onOpen: (submission: SubmissionSummary, asNew: boolean) => void }) {
  const seenRef = useSeenRejections("/api/sale-submissions", submissions.filter((submission) => submission.status === "Rejected" && !submission.rejectionSeen).map((submission) => submission.id).join(","));
  if (!submissions.length) return <p className="p-4 text-center text-sm text-muted-foreground">No submissions yet.</p>;
  const now = manilaNow();
  const tone = { Submitted: "secondary", Remitted: "default", Rejected: "destructive", Returned: "destructive", Saved: "default" } as const;
  const label = { Submitted: "Not yet remitted", Remitted: "Remitted: being encoded", Rejected: "Rejected", Returned: "Returned", Saved: "Saved by the clerk" } as const;
  return (
    <div ref={seenRef}><Card>
      <CardHeader><CardTitle className="text-base">My submissions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {submissions.map((submission) => {
          const pastDeadline = submission.status === "Submitted" && Boolean(submission.incentiveDeadline) && `${now.date} ${now.time}` > submission.incentiveDeadline;
          const late = Boolean(submission.incentiveDeadline && submission.remittedAt > submission.incentiveDeadline);
          return (
            <div key={submission.id} className={`flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${submission.id === activeId ? "border-primary bg-primary/5" : ""}`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">{submittedAt(submission.submittedAt)} <Badge variant={tone[submission.status]}>{label[submission.status]}</Badge></p>
                <p className="text-muted-foreground">{submission.saleCount} sale{submission.saleCount === 1 ? "" : "s"} · {peso(submission.totalAmount)} · {submission.branch}</p>
                <p className="truncate">{memberNames(submission)}</p>
                {submission.status === "Submitted" && <p className={`mt-1 ${pastDeadline ? "font-medium text-amber-700" : "text-muted-foreground"}`}>
                  {submission.incentiveDeadline ? (pastDeadline ? `The ${formatDeadline(submission.incentiveDeadline)} deadline has passed: if you have not handed over the cash yet, the whole amount is remitted.` : `Hand the cash to the clerk by ${formatDeadline(submission.incentiveDeadline)} to keep the incentive.`) : "Hand the cash to the clerk."} Only the clerk can change it now.
                </p>}
                {submission.status === "Remitted" && submission.remittedAt && <p className={`mt-1 font-medium ${late ? "text-amber-700" : "text-emerald-700"}`}>Received by {submission.remittedByName || "the clerk"} on {submittedAt(submission.remittedAt)}{submission.incentiveDeadline ? (late ? ": after the deadline, the incentive is forfeited." : ": in time, you keep your incentive.") : "."}</p>}
                {submission.status === "Rejected" && <p className="mt-1 font-medium text-destructive">Rejected{submission.reviewedByName ? ` by ${submission.reviewedByName}` : ""}: {submission.returnReason}. These sales can be submitted again.</p>}
                {submission.status === "Returned" && <p className="mt-1 font-medium text-destructive">To fix: {submission.returnReason}{submission.reviewedByName ? ` (${submission.reviewedByName})` : ""}</p>}
                {submission.status === "Saved" && submission.reviewedByName && <p className="mt-1 text-muted-foreground">Checked and saved by {submission.reviewedByName}</p>}
                {(submission.fidelity ?? 0) > 0 && <p className="mt-1 font-medium text-emerald-700">Fidelity {peso(submission.fidelity ?? 0)} added with this batch: your own savings.</p>}
              </div>
              {submission.status === "Returned" && <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onOpen(submission, false)}>{submission.id === activeId ? "Editing" : "Fix"}</Button>}
              {submission.status === "Rejected" && <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onOpen(submission, true)}>Submit again</Button>}
            </div>
          );
        })}
      </CardContent>
    </Card></div>
  );
}

const peso = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const longDate = (value: string) => value ? showDate(value) : "";

/** Warns when an existing member already has suspended or forfeited programs. It does not block the sale. */
function MemberStandingWarning({ standing }: { standing?: { programs: ProgramStanding[]; error: string } }) {
  if (!standing) return <p className="text-sm text-muted-foreground">Checking this member&apos;s existing programs...</p>;
  if (standing.error) return <p className="text-sm text-amber-700">Could not check this member&apos;s existing programs: {standing.error}</p>;
  if (!standing.programs.length) return null;
  return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    <p className="flex items-center gap-2 font-semibold"><TriangleAlert className="size-4" />This member has programs that are not in good standing</p>
    <ul className="mt-2 list-disc space-y-1 pl-5">
      {standing.programs.map((program) => <li key={program.enrollmentId}>
        <span className="font-medium">{program.programName}</span>: {program.standing.toLowerCase()}{program.since ? ` since ${longDate(program.since)}` : ""}{program.amountDue ? ` · ${peso(program.amountDue)} due` : ""}
      </li>)}
    </ul>
    <p className="mt-2">Confirm with the member before adding a new program. Suspended accounts need a Waiver payment in Collections.</p>
  </div>;
}

/**
 * Fills the form from the member on record. A blank on record keeps what the encoder already typed; everything the
 * record has replaces it, and the encoder can still edit it before saving.
 */
function fillFromRecord<T>(current: T, record: T): T {
  if (record === null || record === undefined) return current;
  if (typeof record === "string") return (record.trim() ? record : current) as T;
  if (typeof record === "object" && !Array.isArray(record)) {
    const typed = (current ?? {}) as Record<string, unknown>, stored = record as Record<string, unknown>;
    return Object.fromEntries([...new Set([...Object.keys(typed), ...Object.keys(stored)])].map((key) => [key, fillFromRecord(typed[key], stored[key])])) as T;
  }
  return record;
}
