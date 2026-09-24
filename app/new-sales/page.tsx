"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
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

function emptyAddress(): Address {
  return {
    houseBlockLot: "",
    street: "",
    subdivisionVillage: "",
    barangay: "",
    municipalityCity: "",
    province: "",
    zipCode: "",
  };
}

function emptyClaimant() {
  return {
    completeName: "",
    contactNumber: "",
    sameAsMemberAddress: false,
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
    orNumber: "",
    orDate: "",
    dateRemitted: "",
  };
}

function calculateAge(
  birthdate: string,
): number | null {
  if (!birthdate) return null;

  const birth = new Date(birthdate);
  const today = new Date();

  let age =
    today.getFullYear() -
    birth.getFullYear();

  const monthDifference =
    today.getMonth() -
    birth.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 &&
      today.getDate() < birth.getDate())
  ) {
    age--;
  }

  return age >= 0 ? age : null;
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

export default function NewSalesPage() {
  const [branch, setBranch] = useState("");
  const [mas, setMas] = useState("");

  const [sales, setSales] = useState<NewSale[]>([
    emptyNewSale(),
  ]);

  const [expandedSales, setExpandedSales] =
    useState<Record<string, boolean>>({});

  const [memberSearchResults, setMemberSearchResults] =
    useState<Record<string, Member[]>>({});

  const [memberSearchTerms, setMemberSearchTerms] =
    useState<Record<string, string>>({});

  const [programs, setPrograms] = useState<
    Program[]
  >([]);

  const [branches, setBranches] = useState<
    NonNullable<BranchApiResponse["branches"]>
  >([]);

  const [programLoading, setProgramLoading] =
    useState(true);

  const [programError, setProgramError] =
    useState("");

  const [saveMessage, setSaveMessage] =
    useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (sales.length > 0) {
      setExpandedSales((current) => ({
        ...current,
        [sales[0].id]: true,
      }));
    }
  }, []);

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
   * The Programs API should return all programs from
   * Google Sheets.
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
         * We want both Active and Inactive programs
         * from Google Sheets.
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
              : "Unable to load programs from Google Sheets.",
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

  const dismissMemberChoices = (saleId: string) => {
    setMemberSearchResults((current) => {
      const { [saleId]: _dismissed, ...remaining } = current;
      return remaining;
    });

    setMemberSearchTerms((current) => {
      const { [saleId]: _dismissed, ...remaining } = current;
      return remaining;
    });
  };

  const selectExistingMember = (
    saleId: string,
    member: Member,
  ) => {
    updateSale(saleId, (current) => ({
      ...current,
      member: {
        ...member,
        age: calculateAge(member.birthdate),
        claimant: {
          ...member.claimant,
          address: {
            ...member.claimant.address,
          },
        },
      },
      program: {
        ...current.program,
        memberId: member.id,
      },
    }));

    dismissMemberChoices(saleId);
  };

  /*
   * =========================================================
   * SALES
   * =========================================================
   */
  const addSale = () => {
    const newSale = emptyNewSale(
      branch,
      mas,
    );

    setSales((current) => [
      ...current,
      newSale,
    ]);

    setExpandedSales((current) => ({
      ...current,
      [newSale.id]: true,
    }));
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
    setExpandedSales((current) => ({
      ...current,
      [saleId]: !current[saleId],
    }));
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
  const resetForm = () => {
    const firstSale = emptyNewSale(
      branch,
      mas,
    );

    setSales([firstSale]);

    setExpandedSales({
      [firstSale.id]: true,
    });

  };

  /*
   * =========================================================
   * SAVE
   * =========================================================
   */
  const saveSales = async () => {
    setSaveMessage("");

    if (!branch.trim()) {
      setSaveMessage(
        "Please select a branch.",
      );
      return;
    }

    if (!mas.trim()) {
      setSaveMessage(
        "Please select the Marketing Account Staff.",
      );
      return;
    }

    for (const sale of sales) {
      if (
        !sale.member.name.surname.trim()
      ) {
        setSaveMessage(
          "Member surname is required.",
        );
        return;
      }

      if (
        !sale.program.programCode.trim()
      ) {
        setSaveMessage(
          "Please select a program.",
        );
        return;
      }

      if (
        !sale.program.dateEnrolled
      ) {
        setSaveMessage(
          "Date Enrolled is required.",
        );
        return;
      }

      if (!sale.orNumber.trim()) {
        setSaveMessage(
          "OR Number is required.",
        );
        return;
      }

      if (!sale.orDate) {
        setSaveMessage(
          "OR Date is required.",
        );
        return;
      }
    }

    setSaving(true);

    try {
      const dateRemitted =
        new Date()
          .toISOString()
          .split("T")[0];

      const preparedSales =
        sales.map((sale) => ({
          ...sale,

          program: {
            ...sale.program,

            branch,

            mas,

            memberId:
              sale.program.memberId ||
              sale.member.id,
          },

          dateRemitted,
        }));

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
            sales:
              preparedSales,
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

      setSaveMessage(
        `${sales.length} ${
          sales.length === 1
            ? "new sale"
            : "new sales"
        } saved successfully.`,
      );

      resetForm();
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* =====================================================
          HEADER
      ====================================================== */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          New Sales
        </h1>

        <p className="text-sm text-muted-foreground">
          Register a new member or add a
          new program to an existing member.
        </p>
      </div>

      {/* =====================================================
          BATCH INFORMATION
      ====================================================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Batch Information
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Branch */}
            <div className="space-y-2">
              <Label>
                Branch *
              </Label>

              <Select
                value={branch}
                onValueChange={(value) => {
                  const selected =
                    value ?? "";

                  setBranch(selected);

                  setSales((current) =>
                    current.map(
                      (sale) => ({
                        ...sale,

                        program: {
                          ...sale.program,

                          branch:
                            selected,
                        },
                      }),
                    ),
                  );
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>

                <SelectContent>
                  {branches
                    .filter(
                      (item) => item.status === "active",
                    )
                    .map((item) => (
                      <SelectItem
                        key={item.id}
                        value={item.name}
                      >
                        {item.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* MAS */}
            <div className="space-y-2">
              <Label>
                Marketing Account Staff *
              </Label>

              <Input
                value={mas}
                onChange={(event) => {
                  const selected =
                    event.target.value;

                  setMas(selected);

                  setSales((current) =>
                    current.map(
                      (sale) => ({
                        ...sale,

                        program: {
                          ...sale.program,

                          mas: selected,
                        },
                      }),
                    ),
                  );
                }}
                placeholder="Marketing Account Staff"
              />
            </div>

            {/* Date Encoded */}
            <div className="space-y-2">
              <Label>
                Date Encoded
              </Label>

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
                Recorded automatically.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* =====================================================
          SALES
      ====================================================== */}
      <div className="space-y-4">
        {sales.map(
          (sale, index) => {
            const expanded =
              expandedSales[sale.id] ??
              true;

            const selectedProgram =
              programs.find(
                (program) =>
                  program.code ===
                  sale.program.programCode,
              );

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
              <Card key={sale.id}>
                <CardHeader className="border-b">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
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
                    </div>

                    <div className="flex items-center gap-1">
                      {sales.length >
                        1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            removeSale(
                              sale.id,
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
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
                  <CardContent className="space-y-8 pt-6">
                    {/* PERSONAL DATA */}
                    <section className="space-y-4">
                      <div>
                        <h2 className="font-semibold">
                          A. Personal Data
                        </h2>

                        <p className="text-sm text-muted-foreground">
                          Member information.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-4">
                        <div className="space-y-2">
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
                            placeholder="Surname"
                          />

                          {showMemberChoices && (
                            <div className="space-y-1 rounded-md border bg-muted/30 p-2">
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

                        <div className="space-y-2">
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
                            placeholder="Jr., Sr., III"
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-4">
                        <div className="space-y-2">
                          <Label>
                            Birthdate *
                          </Label>

                          <Input
                            type="date"
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

                        <div className="space-y-2">
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
                            value={
                              calculateAge(
                                sale.member.birthdate,
                              ) ?? ""
                            }
                            readOnly
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

                                    contactNumber:
                                      event
                                        .target
                                        .value,
                                  },
                                }),
                              )
                            }
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
                            Enter the complete
                            member address.
                          </p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          {(
                            [
                              [
                                "houseBlockLot",
                                "House / Block / Lot No.",
                              ],
                              [
                                "street",
                                "Street",
                              ],
                              [
                                "subdivisionVillage",
                                "Subdivision / Village",
                              ],
                              [
                                "barangay",
                                "Barangay",
                              ],
                              [
                                "municipalityCity",
                                "Municipality / City",
                              ],
                              [
                                "province",
                                "Province",
                              ],
                              [
                                "zipCode",
                                "ZIP Code",
                              ],
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
                            B. Beneficiaries
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
                            className="rounded-lg border p-4"
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
                              <Input
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

                              <Input
                                type="date"
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

                              <Input
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
                          C. Claimant Information
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
                            placeholder="Complete name of claimant"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Contact Number *
                          </Label>

                          <Input
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

                                      contactNumber:
                                        event
                                          .target
                                          .value,
                                    },
                                  },
                                }),
                              )
                            }
                            placeholder="09XXXXXXXXX"
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                          <div>
                            <Label>
                              Address *
                            </Label>
                          </div>

                          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
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

                        <div className="grid gap-4 md:grid-cols-2">
                          {(
                            [
                              [
                                "houseBlockLot",
                                "House / Block / Lot No.",
                              ],
                              [
                                "street",
                                "Street",
                              ],
                              [
                                "subdivisionVillage",
                                "Subdivision / Village",
                              ],
                              [
                                "barangay",
                                "Barangay",
                              ],
                              [
                                "municipalityCity",
                                "Municipality / City",
                              ],
                              [
                                "province",
                                "Province",
                              ],
                              [
                                "zipCode",
                                "ZIP Code",
                              ],
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

                    {/* =================================================
                        PROGRAM DETAILS
                    ================================================== */}
                    <section className="space-y-4">
                      <div>
                        <h2 className="font-semibold">
                          D. Program Details
                        </h2>

                        <p className="text-sm text-muted-foreground">
                          Programs are loaded
                          from the Programs
                          Google Sheet.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        {/* PROGRAM TYPE */}
                        <div className="space-y-2">
                          <Label>
                            Program Type *
                          </Label>

                          <Select
                            value={
                              sale.program
                                .programCode
                            }
                            onValueChange={(
                              value,
                            ) => {
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  program: {
                                    ...current.program,

                                    programCode:
                                      value ?? "",
                                  },
                                }),
                              );
                            }}
                            disabled={
                              programLoading ||
                              availablePrograms.length ===
                                0
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue
                                placeholder={
                                  programLoading
                                    ? "Loading programs..."
                                    : "Select program"
                                }
                              />
                            </SelectTrigger>

                            <SelectContent>
                              {availablePrograms.map(
                                (program) => {
                                  const status =
                                    String(
                                      program.status ??
                                        "",
                                    )
                                      .trim()
                                      .toLowerCase();

                                  const isActive =
                                    status ===
                                      "active" ||
                                    status === "1" ||
                                    status ===
                                      "true";

                                  return (
                                    <SelectItem
                                      key={program.id}
                                      value={
                                        program.code
                                      }
                                    >
                                      <div className="flex w-full items-center gap-2">
                                        <span>
                                          {program.code
                                            ? `${program.code} - ${program.name}`
                                            : program.name}
                                        </span>

                                        <Badge
                                          variant={
                                            isActive
                                              ? "default"
                                              : "secondary"
                                          }
                                          className="ml-auto text-xs"
                                        >
                                          {isActive
                                            ? "Active"
                                            : "Inactive"}
                                        </Badge>
                                      </div>
                                    </SelectItem>
                                  );
                                },
                              )}
                            </SelectContent>
                          </Select>

                          {programLoading && (
                            <p className="text-xs text-muted-foreground">
                              Loading programs from
                              Google Sheets...
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
                                No program found in
                                Google Sheets.
                              </p>
                            )}

                          {selectedProgram && (
                            <div className="rounded-md bg-muted/50 p-3 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-medium">
                                  {
                                    selectedProgram.name
                                  }
                                </p>

                                <Badge
                                  variant={
                                    String(
                                      selectedProgram.status ??
                                        "",
                                    )
                                      .trim()
                                      .toLowerCase() ===
                                      "active"
                                      ? "default"
                                      : "secondary"
                                  }
                                >
                                  {String(
                                    selectedProgram.status ??
                                      "Unknown",
                                  )}
                                </Badge>
                              </div>

                              {selectedProgram.code && (
                                <p className="text-muted-foreground">
                                  Code:{" "}
                                  {
                                    selectedProgram.code
                                  }
                                </p>
                              )}

                              <p className="text-muted-foreground">
                                Base Pay: ₱
                                {Number(
                                  selectedProgram.basePay,
                                ).toLocaleString(
                                  "en-PH",
                                  {
                                    minimumFractionDigits:
                                      2,
                                  },
                                )}
                              </p>

                              {selectedProgram.description && (
                                <p className="mt-1 text-muted-foreground">
                                  {
                                    selectedProgram.description
                                  }
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* DATE ENROLLED */}
                        <div className="space-y-2">
                          <Label>
                            Date Enrolled *
                          </Label>

                          <Input
                            type="date"
                            value={
                              sale.program
                                .dateEnrolled
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  program: {
                                    ...current.program,

                                    dateEnrolled:
                                      event
                                        .target
                                        .value,
                                  },
                                }),
                              )
                            }
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        {/* PAYMENT METHOD */}
                        <div className="space-y-2">
                          <Label>
                            Mode of Payment *
                          </Label>

                          <Select
                            value={
                              sale.program
                                .modeOfPayment
                            }
                            onValueChange={(
                              value,
                            ) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  program: {
                                    ...current.program,

                                    modeOfPayment:
                                      value ?? "",
                                  },
                                }),
                              )
                            }
                          >
                            <SelectTrigger className="w-full">
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

                        {/* REGISTRATION FEE */}
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
                            onValueChange={(
                              value,
                            ) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  program: {
                                    ...current.program,

                                    withRegistrationFee:
                                      value ===
                                      "yes",

                                    registrationAmount:
                                      value ===
                                      "yes"
                                        ? current
                                            .program
                                            .registrationAmount
                                        : 0,
                                  },
                                }),
                              )
                            }
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

                        {/* REGISTRATION AMOUNT */}
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
                            disabled={
                              !sale.program
                                .withRegistrationFee
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  program: {
                                    ...current.program,

                                    registrationAmount:
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
                        </div>
                      </div>

                      {/* AMOUNT PAID */}
                      <div className="space-y-2">
                        <Label>
                          Amount Paid *
                        </Label>

                        <Input
                          type="number"
                          min="0"
                          value={
                            sale.program
                              .amountPaid ||
                            ""
                          }
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
                      </div>

                      {/* PROGRAM TERMS */}
                      <div className="space-y-2">
                        <Label>
                          Program Terms
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
                          placeholder="Program terms and conditions"
                        />
                      </div>
                    </section>

                    <Separator />

                    {/* PAYMENT / OR */}
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
                            placeholder="Application number"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            OR Number *
                          </Label>

                          <Input
                            value={
                              sale.orNumber
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                (current) => ({
                                  ...current,

                                  orNumber:
                                    event
                                      .target
                                      .value,
                                }),
                              )
                            }
                            placeholder="Official receipt number"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            OR Date *
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
                      </div>

                      <div className="rounded-lg bg-muted/50 p-4">
                        <p className="text-sm font-medium">
                          Date Remitted
                        </p>

                        <p className="mt-1 text-sm text-muted-foreground">
                          Automatically recorded
                          when the Entry Clerk
                          saves the transaction.
                        </p>
                      </div>
                    </section>
                  </CardContent>
                )}
              </Card>
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

      {/* SAVE */}
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

            {saveMessage && (
              <p className="mt-2 text-sm font-medium">
                {saveMessage}
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={resetForm}
              disabled={saving}
            >
              Cancel
            </Button>

            <Button
              type="button"
              size="lg"
              onClick={() =>
                void saveSales()
              }
              disabled={saving}
            >
              {saving
                ? "Saving..."
                : "Save All New Sales"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
