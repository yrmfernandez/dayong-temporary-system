"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
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

import { programs } from "@/lib/programs";

type CheckboxProps = {
  id?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

const Checkbox = ({
  id,
  checked = false,
  onCheckedChange,
}: CheckboxProps) => (
  <input
    id={id}
    type="checkbox"
    checked={checked}
    onChange={(event) =>
      onCheckedChange?.(event.target.checked)
    }
    className="size-4 rounded border border-input accent-primary"
  />
);

type Beneficiary = {
  id: number;
  surname: string;
  firstName: string;
  middleName: string;
  age: string;
  birthdate: string;
  relationship: string;
};

type MemberSearchResult = {
  id: string;
  phMemberNumber: string;
  name: {
    surname: string;
    firstName: string;
    middleName: string;
    nameExtension: string;
  };
  birthdate: string;
  birthplace: string;
  gender: string;
  age: number | null;
  civilStatus: string;
  contactNumber: string;
  address: {
    houseBlockLot: string;
    street: string;
    subdivisionVillage: string;
    barangay: string;
    municipalityCity: string;
    province: string;
    zipCode: string;
  };
  claimant: {
    completeName: string;
    contactNumber: string;
    sameAsMemberAddress: boolean;
    address: {
      houseBlockLot: string;
      street: string;
      subdivisionVillage: string;
      barangay: string;
      municipalityCity: string;
      province: string;
      zipCode: string;
    };
  };
};

type Sale = {
  id: number;
  expanded: boolean;
  existingMember: boolean;
  memberSearch: string;
  memberNumber: string;
  beneficiaries: Beneficiary[];
  programId: string;

  programCheck:
  "idle" | 
  "checking" | 
  "available" | 
  "duplicate" | 
  "error";

  programCheckMessage: string;

  surname: string;
  firstName: string;
  middleName: string;
  nameExtension: string;
  birthdate: string;
  birthplace: string;
  gender: string;
  age: string;
  civilStatus: string;
  contactNumber: string;

  addressHouse: string;
  addressStreet: string;
  addressSubdivision: string;
  addressBarangay: string;
  addressCity: string;
  addressProvince: string;
  addressZip: string;

  claimantName: string;
  claimantContact: string;
  claimantSameAsMember: boolean;
  claimantAddressHouse: string;
  claimantAddressStreet: string;
  claimantAddressSubdivision: string;
  claimantAddressBarangay: string;
  claimantAddressCity: string;
  claimantAddressProvince: string;
  claimantAddressZip: string;

  applicationNo: string;
  orNumber: string;
  orDate: string;
  paymentMethod: string;
  registrationFee: string;
  registrationAmount: string;
  amountPaid: string;
  doi: string;
  programTerms: string;
};

const createEmptySale = (id: number): Sale => ({
  id,
  expanded: true,
  existingMember: false,
  memberSearch: "",
  memberNumber: "",
  beneficiaries: [],
  programId: "",

  programCheck: "idle",
  programCheckMessage: "",

  surname: "",
  firstName: "",
  middleName: "",
  nameExtension: "",
  birthdate: "",
  birthplace: "",
  gender: "",
  age: "",
  civilStatus: "",
  contactNumber: "",

  addressHouse: "",
  addressStreet: "",
  addressSubdivision: "",
  addressBarangay: "",
  addressCity: "",
  addressProvince: "",
  addressZip: "",

  claimantName: "",
  claimantContact: "",
  claimantSameAsMember: false,
  claimantAddressHouse: "",
  claimantAddressStreet: "",
  claimantAddressSubdivision: "",
  claimantAddressBarangay: "",
  claimantAddressCity: "",
  claimantAddressProvince: "",
  claimantAddressZip: "",

  applicationNo: "",
  orNumber: "",
  orDate: "",
  paymentMethod: "",
  registrationFee: "",
  registrationAmount: "",
  amountPaid: "",
  doi: "",
  programTerms: "",
});

const createEmptyBeneficiary = (
  id: number,
): Beneficiary => ({
  id,
  surname: "",
  firstName: "",
  middleName: "",
  age: "",
  birthdate: "",
  relationship: "",
});

export default function NewSalesPage() {
  const topRef = useRef<HTMLDivElement>(null);

  const [branch, setBranch] = useState("");
  const [mas, setMas] = useState("");
  const [dateRemitted, setDateRemitted] =
    useState("");

  const [sales, setSales] = useState<Sale[]>([
    createEmptySale(1),
  ]);

  const [errors, setErrors] = useState<
    Record<number, string[]>
  >({});

  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [showReview, setShowReview] =
    useState(false);

  const [confirming, setConfirming] =
    useState(false);

  const [memberResults, setMemberResults] =
    useState<
      Record<number, MemberSearchResult[]>
    >({});

  const activePrograms = programs.filter(
    (program) => program.status === "active",
  );

  useEffect(() => {
    const timers = sales.map((sale) => {
      const search = sale.memberSearch.trim();

      if (
        sale.existingMember ||
        search.length < 2
      ) {
        setMemberResults((current) => {
          if (!current[sale.id]) {
            return current;
          }

          const next = { ...current };
          delete next[sale.id];
          return next;
        });

        return undefined;
      }

      return window.setTimeout(async () => {
        try {
          const response = await fetch(
            `/api/members?search=${encodeURIComponent(
              search,
            )}`,
          );

          if (!response.ok) {
            throw new Error(
              "Unable to search members.",
            );
          }

          const result = await response.json();

          if (!result.success) {
            throw new Error(
              result.message ||
                "Unable to search members.",
            );
          }

          setMemberResults((current) => ({
            ...current,
            [sale.id]: result.members ?? [],
          }));
        } catch (error) {
          console.error(
            "Member search error:",
            error,
          );

          setMemberResults((current) => ({
            ...current,
            [sale.id]: [],
          }));
        }
      }, 300);
    });

    return () => {
      timers.forEach((timer) => {
        if (timer !== undefined) {
          window.clearTimeout(timer);
        }
      });
    };
  }, [sales]);

  const checkMemberProgram = async (
    saleId: number,
    memberNumber: string,
    programId: string,
    ) => {
      if (!memberNumber || !programId) {
        updateSale(saleId, {
          programCheck: "idle",
          programCheckMessage: "",
        });

      return;
  }

  updateSale(saleId, {
    programCheck: "checking",
    programCheckMessage:
      "Checking existing program enrollment...",
  });

  try {
    const response = await fetch(
      `/api/member-programs/check?memberNumber=${encodeURIComponent(
        memberNumber,
      )}&programId=${encodeURIComponent(programId)}`,
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      updateSale(saleId, {
        programCheck: "error",
        programCheckMessage:
          result.message ||
          "Unable to check program enrollment.",
      });

      return;
    }

    if (result.enrolled) {
      updateSale(saleId, {
        programCheck: "duplicate",
        programCheckMessage:
          result.message ||
          "This member is already enrolled in this program.",
      });

      return;
    }

    updateSale(saleId, {
      programCheck: "available",
      programCheckMessage:
        "This program is available for this member.",
    });
  } catch (error) {
    console.error(
      "Program enrollment check error:",
      error,
    );

    updateSale(saleId, {
      programCheck: "error",
      programCheckMessage:
        "Unable to check program enrollment.",
    });
  }
  };

  const updateSale = (
    saleId: number,
    updates: Partial<Sale>,
  ) => {
    setSales((current) =>
      current.map((sale) => {
        if (sale.id !== saleId) {
          return sale;
        }

        const updatedSale = {
          ...sale,
          ...updates,
        };

        if (
          updatedSale.claimantSameAsMember &&
          (updates.addressHouse !== undefined ||
            updates.addressStreet !== undefined ||
            updates.addressSubdivision !== undefined ||
            updates.addressBarangay !== undefined ||
            updates.addressCity !== undefined ||
            updates.addressProvince !== undefined ||
            updates.addressZip !== undefined)
        ) {
          updatedSale.claimantAddressHouse =
            updatedSale.addressHouse;

          updatedSale.claimantAddressStreet =
            updatedSale.addressStreet;

          updatedSale.claimantAddressSubdivision =
            updatedSale.addressSubdivision;

          updatedSale.claimantAddressBarangay =
            updatedSale.addressBarangay;

          updatedSale.claimantAddressCity =
            updatedSale.addressCity;

          updatedSale.claimantAddressProvince =
            updatedSale.addressProvince;

          updatedSale.claimantAddressZip =
            updatedSale.addressZip;
        }

        return updatedSale;
      }),
    );

    setSaveMessage("");

    if (errors[saleId]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[saleId];
        return next;
      });
    }
  };

  const addSale = () => {
    const currentSale = sales[sales.length - 1];

    if (currentSale) {
      const missing = validateSale(currentSale);

      if (missing.length > 0) {
        setErrors((current) => ({
          ...current,
          [currentSale.id]: missing,
        }));

        setSales((current) =>
          current.map((sale) =>
            sale.id === currentSale.id
              ? {
                  ...sale,
                  expanded: true,
                }
              : sale,
          ),
        );

        setSaveMessage(
          "Please complete the current sale before adding another sale.",
        );

        return;
      }
    }

    setSales((current) => [
      ...current.map((sale) => ({
        ...sale,
        expanded: false,
      })),
      createEmptySale(Date.now()),
    ]);

    setSaveMessage("");

    setTimeout(() => {
      topRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  };

  const removeSale = (id: number) => {
    if (sales.length === 1) {
      return;
    }

    setSales((current) =>
      current.filter((sale) => sale.id !== id),
    );

    setMemberResults((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    setErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    setSaveMessage("");
  };

  const toggleSale = (id: number) => {
    setSales((current) =>
      current.map((sale) =>
        sale.id === id
          ? {
              ...sale,
              expanded: !sale.expanded,
            }
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
                createEmptyBeneficiary(Date.now()),
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

  const updateBeneficiary = (
    saleId: number,
    beneficiaryId: number,
    updates: Partial<Beneficiary>,
  ) => {
    setSales((current) =>
      current.map((sale) =>
        sale.id === saleId
          ? {
              ...sale,
              beneficiaries:
                sale.beneficiaries.map(
                  (beneficiary) =>
                    beneficiary.id === beneficiaryId
                      ? {
                          ...beneficiary,
                          ...updates,
                        }
                      : beneficiary,
                ),
            }
          : sale,
      ),
    );
  };

  const selectMember = (
    saleId: number,
    memberId: string,
  ) => {
    const member = memberResults[saleId]?.find(
      (item) => item.id === memberId,
    );

    if (!member) {
      return;
    }

    updateSale(saleId, {
      existingMember: true,

      memberSearch: `${member.name.firstName} ${
        member.name.middleName
      } ${member.name.surname}`
        .replace(/\s+/g, " ")
        .trim(),

      memberNumber: member.phMemberNumber,

      programCheck: "idle",
      programCheckMessage: "",

      surname: member.name.surname,
      firstName: member.name.firstName,
      middleName: member.name.middleName,
      nameExtension: member.name.nameExtension,

      birthdate: member.birthdate,
      birthplace: member.birthplace,
      gender: member.gender,

      age:
        member.age === null
          ? ""
          : String(member.age),

      civilStatus: member.civilStatus,
      contactNumber: member.contactNumber,

      addressHouse: member.address.houseBlockLot,
      addressStreet: member.address.street,
      addressSubdivision:
        member.address.subdivisionVillage,
      addressBarangay: member.address.barangay,
      addressCity: member.address.municipalityCity,
      addressProvince: member.address.province,
      addressZip: member.address.zipCode,

      claimantName: member.claimant.completeName,
      claimantContact:
        member.claimant.contactNumber,

      claimantSameAsMember:
        member.claimant.sameAsMemberAddress,

      claimantAddressHouse:
        member.claimant.address.houseBlockLot,

      claimantAddressStreet:
        member.claimant.address.street,

      claimantAddressSubdivision:
        member.claimant.address.subdivisionVillage,

      claimantAddressBarangay:
        member.claimant.address.barangay,

      claimantAddressCity:
        member.claimant.address.municipalityCity,

      claimantAddressProvince:
        member.claimant.address.province,

      claimantAddressZip:
        member.claimant.address.zipCode,
    });

    setMemberResults((current) => {
      const next = { ...current };
      delete next[saleId];
      return next;
    });
  };

  const toggleClaimantSameAsMember = (
    saleId: number,
    checked: boolean,
  ) => {
    setSales((current) =>
      current.map((sale) => {
        if (sale.id !== saleId) {
          return sale;
        }

        if (!checked) {
          return {
            ...sale,
            claimantSameAsMember: false,
          };
        }

        return {
          ...sale,
          claimantSameAsMember: true,
          claimantAddressHouse:
            sale.addressHouse,
          claimantAddressStreet:
            sale.addressStreet,
          claimantAddressSubdivision:
            sale.addressSubdivision,
          claimantAddressBarangay:
            sale.addressBarangay,
          claimantAddressCity:
            sale.addressCity,
          claimantAddressProvince:
            sale.addressProvince,
          claimantAddressZip:
            sale.addressZip,
        };
      }),
    );

    setSaveMessage("");
  };

  const validateSale = (sale: Sale) => {
    const missing: string[] = [];

    if (!branch) {
      missing.push("Branch");
    }

    if (!mas) {
      missing.push("Marketing Account Staff");
    }

    if (!dateRemitted) {
      missing.push("Date Remitted");
    }

    if (!sale.existingMember) {
      if (!sale.surname.trim()) {
        missing.push("Surname");
      }

      if (!sale.firstName.trim()) {
        missing.push("First Name");
      }

      if (!sale.birthdate) {
        missing.push("Birthdate");
      }

      if (!sale.gender) {
        missing.push("Gender");
      }

      if (!sale.civilStatus) {
        missing.push("Civil Status");
      }

      if (!sale.contactNumber.trim()) {
        missing.push("Member Contact Number");
      }

      if (!sale.addressBarangay.trim()) {
        missing.push("Member Barangay");
      }

      if (!sale.addressCity.trim()) {
        missing.push("Member Municipality / City");
      }

      if (!sale.addressProvince.trim()) {
        missing.push("Member Province");
      }
    }

    if (!sale.claimantName.trim()) {
      missing.push("Claimant Complete Name");
    }

    if (!sale.claimantContact.trim()) {
      missing.push("Claimant Contact Number");
    }

    if (!sale.claimantAddressBarangay.trim()) {
      missing.push("Claimant Barangay");
    }

    if (!sale.claimantAddressCity.trim()) {
      missing.push("Claimant Municipality / City");
    }

    if (!sale.claimantAddressProvince.trim()) {
      missing.push("Claimant Province");
    }

    if (!sale.programId) {
      missing.push("Program");
    } else if (sale.programCheck === "duplicate") {
      missing.push("Selected program is already enrolled");
    } else if (sale.existingMember && sale.programCheck !== "available") {
      missing.push("Program enrollment check");
    }

    if (!sale.doi) {
      missing.push("DOI");
    }

    if (!sale.paymentMethod) {
      missing.push("Mode of Payment");
    }

    if (!sale.registrationFee) {
      missing.push("Registration Fee");
    }

    if (
      sale.registrationFee === "yes" &&
      !sale.registrationAmount.trim()
    ) {
      missing.push("Registration Amount");
    }

    if (!sale.amountPaid.trim()) {
      missing.push("Amount Paid");
    }

    if (!sale.orNumber.trim()) {
      missing.push("OR Number");
    }

    if (!sale.orDate) {
      missing.push("OR Date");
    }

    return missing;
  };

  const saveAllNewSales = async () => {
    setSaveMessage("");

    const validationResults: Record<
      number,
      string[]
    > = {};

    sales.forEach((sale) => {
      const missing = validateSale(sale);

      if (missing.length > 0) {
        validationResults[sale.id] = missing;
      }
    });

    setErrors(validationResults);

    if (Object.keys(validationResults).length > 0) {
      const firstInvalidId = Number(
        Object.keys(validationResults)[0],
      );

      setSales((current) =>
        current.map((sale) =>
          sale.id === firstInvalidId
            ? {
                ...sale,
                expanded: true,
              }
            : sale,
        ),
      );

      setSaveMessage(
        "Please complete all required fields before reviewing.",
      );

      return;
    }

    setSaveMessage("");
    setShowReview(true);
  };

  const confirmSaveAllNewSales =
    async () => {
      setConfirming(true);
      setSaveMessage("");

      try {
        const response = await fetch(
          "/api/sales",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              branch,
              mas,
              dateRemitted,
              sales,
            }),
          },
        );

        const result =
          await response.json();

        if (!response.ok || !result.success) {
          throw new Error(
            result.message ||
              "Unable to save new sales.",
          );
        }

        setShowReview(false);

        resetForm();

        setSaveMessage(
          `${sales.length} ${
            sales.length === 1
              ? "new sale"
              : "new sales"
          } saved successfully.`,
        );
      } catch (error: unknown) {
        console.error(
          "New Sales confirmation error:",
          error,
        );

        const message =
          error instanceof Error
            ? error.message
            : "Unable to save new sales.";

        setShowReview(false);
        setSaveMessage(message);
      } finally {
        setConfirming(false);
      }
    };

  const resetForm = () => {
    setBranch("");
    setMas("");
    setDateRemitted("");
    setSales([createEmptySale(1)]);
    setMemberResults({});
    setErrors({});
    setSaving(false);
  };

  return (
    <div
      ref={topRef}
      className="mx-auto max-w-6xl space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          New Sales
        </h1>

        <p className="text-sm text-muted-foreground">
          Encode multiple new sales from the same MAS
          in one remittance batch.
        </p>
      </div>

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
                Enter the actual remittance date for
                this batch.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {sales.map((sale, index) => {
          const matchingMembers =
            memberResults[sale.id] ?? [];

          const saleErrors =
            errors[sale.id] ?? [];

          const selectedProgram =
            programs.find(
              (program) =>
                program.id === sale.programId,
            );

          return (
            <Card key={sale.id}>
              <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">
                      Sale #{index + 1}
                    </Badge>

                    {sale.existingMember && (
                      <Badge>
                        Existing Member
                      </Badge>
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

                {saleErrors.length > 0 && (
                  <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-sm font-medium text-destructive">
                      Please complete the required
                      fields.
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Missing:{" "}
                      {saleErrors.join(", ")}
                    </p>
                  </div>
                )}
              </CardHeader>

              {sale.expanded && (
                <CardContent className="space-y-8 pt-6">
                  <section className="space-y-4">
                    <div>
                      <h2 className="font-semibold">
                        Member Search
                      </h2>

                      <p className="text-sm text-muted-foreground">
                        Search by member full name.
                        Select a matching member to
                        automatically fill the
                        information.
                      </p>
                    </div>

                    <div className="relative space-y-2">
                      <Label>
                        Search Existing Member by
                        Name
                      </Label>

                      <Input
                        placeholder="Type member full name..."
                        value={
                          sale.memberSearch
                        }
                        onChange={(event) => {
                          updateSale(
                            sale.id,
                            {
                              memberSearch:
                                event.target
                                  .value,
                              existingMember:
                                false,
                              memberNumber: "",
                            },
                          );
                        }}
                      />

                      {matchingMembers.length >
                        0 &&
                        !sale.existingMember && (
                          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-background shadow-lg">
                            {matchingMembers.map(
                              (member) => (
                                <button
                                  key={
                                    member.id
                                  }
                                  type="button"
                                  className="block w-full border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted"
                                  onClick={() =>
                                    selectMember(
                                      sale.id,
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

                    {sale.existingMember && (
                      <div className="rounded-lg border bg-muted/40 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">
                              Existing member selected
                            </p>

                            <p className="text-sm text-muted-foreground">
                              PH/Member:{" "}
                              {
                                sale.memberNumber
                              }
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

                  <section className="space-y-4">
                    <div>
                      <h2 className="font-semibold">
                        A. Personal Data
                      </h2>

                      <p className="text-sm text-muted-foreground">
                        Complete this section for a
                        new member or review the
                        information loaded from an
                        existing member.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <Label>Surname *</Label>

                        <Input
                          placeholder="Surname"
                          value={sale.surname}
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                surname:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>First Name *</Label>

                        <Input
                          placeholder="First Name"
                          value={sale.firstName}
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                firstName:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Middle Name
                        </Label>

                        <Input
                          placeholder="Middle Name"
                          value={
                            sale.middleName
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                middleName:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Name Extension
                        </Label>

                        <Input
                          placeholder="Jr., Sr., III"
                          value={
                            sale.nameExtension
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                nameExtension:
                                  event.target
                                    .value,
                              },
                            )
                          }
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
                            sale.birthdate
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                birthdate:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Birthplace
                        </Label>

                        <Input
                          placeholder="Birthplace"
                          value={
                            sale.birthplace
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                birthplace:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Gender *</Label>

                        <Select
                          value={sale.gender}
                          onValueChange={(value) =>
                            updateSale(
                              sale.id,
                              {
                                gender:
                                  value ?? "",
                              },
                            )
                          }
                        >
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
                          placeholder="Age"
                          value={sale.age}
                          readOnly={
                            sale.existingMember
                          }
                          onWheel={(event) => {
                            event.currentTarget.blur();
                          }}
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                age:
                                  event.target
                                    .value,
                              },
                            )
                          }
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
                            sale.civilStatus
                          }
                          onValueChange={(value) =>
                            updateSale(
                              sale.id,
                              {
                                civilStatus:
                                  value ?? "",
                              },
                            )
                          }
                        >
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
                        <Label>
                          Contact Number *
                        </Label>

                        <Input
                          placeholder="09XXXXXXXXX"
                          value={
                            sale.contactNumber
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                contactNumber:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Label>
                          Present Address *
                        </Label>

                        <p className="text-sm text-muted-foreground">
                          Enter the complete address.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>
                            House / Block / Lot
                            No.
                          </Label>

                          <Input
                            placeholder="House / Block / Lot No."
                            value={
                              sale.addressHouse
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                {
                                  addressHouse:
                                    event.target
                                      .value,
                                },
                              )
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Street
                          </Label>

                          <Input
                            placeholder="Street"
                            value={
                              sale.addressStreet
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                {
                                  addressStreet:
                                    event.target
                                      .value,
                                },
                              )
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Subdivision /
                            Village
                          </Label>

                          <Input
                            placeholder="Subdivision / Village"
                            value={
                              sale.addressSubdivision
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                {
                                  addressSubdivision:
                                    event.target
                                      .value,
                                },
                              )
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Barangay *
                          </Label>

                          <Input
                            placeholder="Barangay"
                            value={
                              sale.addressBarangay
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                {
                                  addressBarangay:
                                    event.target
                                      .value,
                                },
                              )
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Municipality /
                            City *
                          </Label>

                          <Input
                            placeholder="Municipality / City"
                            value={
                              sale.addressCity
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                {
                                  addressCity:
                                    event.target
                                      .value,
                                },
                              )
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            Province *
                          </Label>

                          <Input
                            placeholder="Province"
                            value={
                              sale.addressProvince
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                {
                                  addressProvince:
                                    event.target
                                      .value,
                                },
                              )
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>
                            ZIP Code
                          </Label>

                          <Input
                            inputMode="numeric"
                            placeholder="ZIP Code"
                            value={
                              sale.addressZip
                            }
                            onChange={(event) =>
                              updateSale(
                                sale.id,
                                {
                                  addressZip:
                                    event.target
                                      .value,
                                },
                              )
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </section>

                  <Separator />

                  <section className="space-y-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div>
                        <h2 className="font-semibold">
                          B. Beneficiaries
                        </h2>

                        <p className="text-sm text-muted-foreground">
                          Add only when applicable.
                        </p>
                      </div>

                      <Button
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

                    {sale.beneficiaries.length ===
                    0 ? (
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
                                      {
                                        surname:
                                          event
                                            .target
                                            .value,
                                      },
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
                                      {
                                        firstName:
                                          event
                                            .target
                                            .value,
                                      },
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
                                      {
                                        middleName:
                                          event
                                            .target
                                            .value,
                                      },
                                    )
                                  }
                                />

                                <Input
                                  type="number"
                                  placeholder="Age"
                                  value={
                                    beneficiary.age
                                  }
                                  onWheel={(event) => {
                                    event.currentTarget.blur();
                                  }}
                                  onChange={(
                                    event,
                                  ) =>
                                    updateBeneficiary(
                                      sale.id,
                                      beneficiary.id,
                                      {
                                        age:
                                          event
                                            .target
                                            .value,
                                      },
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
                                      {
                                        birthdate:
                                          event
                                            .target
                                            .value,
                                      },
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
                                      {
                                        relationship:
                                          event
                                            .target
                                            .value,
                                      },
                                    )
                                  }
                                />
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </section>

                  <Separator />

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

                        <Input
                          placeholder="Complete name"
                          value={
                            sale.claimantName
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                claimantName:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Contact Number *
                        </Label>

                        <Input
                          placeholder="09XXXXXXXXX"
                          value={
                            sale.claimantContact
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                claimantContact:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`claimant-same-address-${sale.id}`}
                        checked={
                          sale.claimantSameAsMember
                        }
                        onCheckedChange={(
                          checked,
                        ) =>
                          toggleClaimantSameAsMember(
                            sale.id,
                            checked === true,
                          )
                        }
                      />

                      <Label
                        htmlFor={`claimant-same-address-${sale.id}`}
                        className="cursor-pointer font-normal"
                      >
                        Same as Member Address
                      </Label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Input
                        placeholder="House / Block / Lot No."
                        value={
                          sale.claimantAddressHouse
                        }
                        disabled={
                          sale.claimantSameAsMember
                        }
                        onChange={(event) =>
                          updateSale(
                            sale.id,
                            {
                              claimantAddressHouse:
                                event.target
                                  .value,
                            },
                          )
                        }
                      />

                      <Input
                        placeholder="Street"
                        value={
                          sale.claimantAddressStreet
                        }
                        disabled={
                          sale.claimantSameAsMember
                        }
                        onChange={(event) =>
                          updateSale(
                            sale.id,
                            {
                              claimantAddressStreet:
                                event.target
                                  .value,
                            },
                          )
                        }
                      />

                      <Input
                        placeholder="Subdivision / Village"
                        value={
                          sale.claimantAddressSubdivision
                        }
                        disabled={
                          sale.claimantSameAsMember
                        }
                        onChange={(event) =>
                          updateSale(
                            sale.id,
                            {
                              claimantAddressSubdivision:
                                event.target
                                  .value,
                            },
                          )
                        }
                      />

                      <Input
                        placeholder="Barangay *"
                        value={
                          sale.claimantAddressBarangay
                        }
                        disabled={
                          sale.claimantSameAsMember
                        }
                        onChange={(event) =>
                          updateSale(
                            sale.id,
                            {
                              claimantAddressBarangay:
                                event.target
                                  .value,
                            },
                          )
                        }
                      />

                      <Input
                        placeholder="Municipality / City *"
                        value={
                          sale.claimantAddressCity
                        }
                        disabled={
                          sale.claimantSameAsMember
                        }
                        onChange={(event) =>
                          updateSale(
                            sale.id,
                            {
                              claimantAddressCity:
                                event.target
                                  .value,
                            },
                          )
                        }
                      />

                      <Input
                        placeholder="Province *"
                        value={
                          sale.claimantAddressProvince
                        }
                        disabled={
                          sale.claimantSameAsMember
                        }
                        onChange={(event) =>
                          updateSale(
                            sale.id,
                            {
                              claimantAddressProvince:
                                event.target
                                  .value,
                            },
                          )
                        }
                      />

                      <Input
                        inputMode="numeric"
                        placeholder="ZIP Code"
                        value={
                          sale.claimantAddressZip
                        }
                        disabled={
                          sale.claimantSameAsMember
                        }
                        onChange={(event) =>
                          updateSale(
                            sale.id,
                            {
                              claimantAddressZip:
                                event.target
                                  .value,
                            },
                          )
                        }
                      />
                    </div>
                  </section>

                  <Separator />

                  <section className="space-y-4">
                    <div>
                      <h2 className="font-semibold">
                        D. Program Details
                      </h2>

                      <p className="text-sm text-muted-foreground">
                        Select the program being
                        enrolled in. An existing member
                        may enroll in another program.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>
                          Program Type *
                        </Label>

                          <Select
                            value={sale.programId}
                            onValueChange={async (value) => {
                              const selectedProgramId = value ?? "";

                              updateSale(sale.id, {
                                programId: selectedProgramId,
                                programCheck: "idle",
                                programCheckMessage: "",
                              });

                              if (
                                sale.existingMember &&
                                sale.memberNumber &&
                                selectedProgramId
                              ) {
                                await checkMemberProgram(
                                  sale.id,
                                  sale.memberNumber,
                                  selectedProgramId,
                                );
                              } else if (
                                !sale.existingMember &&
                                selectedProgramId
                              ) {
                                updateSale(sale.id, {
                                  programCheck: "available",
                                  programCheckMessage:
                                    "Program selected. This is a new member.",
                                });
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select program" />
                            </SelectTrigger>

                            <SelectContent>
                              {activePrograms.map((program) => (
                                <SelectItem
                                  key={program.id}
                                  value={program.id}
                                >
                                  {program.code} — {program.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {sale.programCheck === "checking" && (
                            <p className="text-sm text-muted-foreground">
                              Checking existing program enrollment...
                            </p>
                          )}

                          {sale.programCheck === "available" && (
                            <p className="text-sm text-green-600">
                              {sale.programCheckMessage}
                            </p>
                          )}

                          {sale.programCheck === "duplicate" && (
                            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                              <p className="text-sm font-medium text-destructive">
                                Program already enrolled
                              </p>
                              <p className="mt-1 text-xs text-destructive/90">
                                {sale.programCheckMessage}
                              </p>
                            </div>
                          )}

                          {sale.programCheck === "error" && (
                            <p className="text-sm text-destructive">
                              {sale.programCheckMessage}
                            </p>
                          )}
                      </div>

                      <div className="space-y-2">
                        <Label>
                          DOI *
                        </Label>

                        <Input
                          type="date"
                          value={
                            sale.doi
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                doi:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>
                    </div>

                    {selectedProgram && (
                      <div className="rounded-lg border bg-muted/40 p-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Program
                            </p>

                            <p className="font-medium">
                              {
                                selectedProgram.code
                              }{" "}
                              —{" "}
                              {
                                selectedProgram.name
                              }
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
                              {
                                selectedProgram.status
                              }
                            </Badge>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>
                          Mode of Payment *
                        </Label>

                        <Select
                          value={
                            sale.paymentMethod
                          }
                          onValueChange={(
                            value,
                          ) =>
                            updateSale(
                              sale.id,
                              {
                                paymentMethod:
                                  value ?? "",
                              },
                            )
                          }
                        >
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

                        <Select
                          value={
                            sale.registrationFee
                          }
                          onValueChange={(
                            value,
                          ) =>
                            updateSale(
                              sale.id,
                              {
                                registrationFee:
                                  value ?? "",
                                ...(value !==
                                "yes"
                                  ? {
                                      registrationAmount:
                                        "",
                                    }
                                  : {}),
                              },
                            )
                          }
                        >
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
                          value={
                            sale.registrationAmount
                          }
                          disabled={
                            sale.registrationFee !==
                            "yes"
                          }
                          onWheel={(event) => {
                            event.currentTarget.blur();
                          }}
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                registrationAmount:
                                  event.target
                                    .value,
                              },
                            )
                          }
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
                        value={
                          sale.amountPaid
                        }
                        onWheel={(event) => {
                          event.currentTarget.blur();
                        }}
                        onChange={(event) =>
                          updateSale(
                            sale.id,
                            {
                              amountPaid:
                                event.target
                                  .value,
                            },
                          )
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Program Terms
                      </Label>

                      <Textarea
                        placeholder="Program terms and conditions"
                        value={
                          sale.programTerms
                        }
                        onChange={(event) =>
                          updateSale(
                            sale.id,
                            {
                              programTerms:
                                event.target
                                  .value,
                            },
                          )
                        }
                      />
                    </div>
                  </section>

                  <Separator />

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
                          placeholder="Application number"
                          value={
                            sale.applicationNo
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                applicationNo:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          OR Number *
                        </Label>

                        <Input
                          placeholder="Official receipt number"
                          value={
                            sale.orNumber
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                orNumber:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          OR Date *
                        </Label>

                        <Input
                          type="date"
                          value={sale.orDate}
                          onChange={(event) =>
                            updateSale(
                              sale.id,
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
                  </section>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={addSale}
      >
        <Plus className="mr-2 size-4" />
        Add Another Sale
      </Button>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
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
                  : "MAS not selected"}{" "}
                ·{" "}
                {dateRemitted
                  ? `Date Remitted: ${dateRemitted}`
                  : "Date Remitted not selected"}
              </p>

              <div className="mt-3 rounded-lg border bg-muted/40 p-3">
                <p className="text-xs font-medium">
                  Saving / Remittance Reminder
                </p>

                <p className="mt-1 text-xs text-muted-foreground">
                  Verify all member, program,
                  payment, OR, and remittance
                  information before saving.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {saveMessage && (
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    saveMessage.includes(
                      "successfully",
                    )
                      ? "border-green-500/30 bg-green-500/10 text-green-700"
                      : "border-destructive/30 bg-destructive/10 text-destructive"
                  }`}
                >
                  {saveMessage.includes(
                    "successfully",
                  ) && (
                    <CheckCircle2 className="size-4" />
                  )}

                  <span>{saveMessage}</span>
                </div>
              )}

              <Button
                variant="outline"
                onClick={resetForm}
                disabled={saving}
              >
                Cancel
              </Button>

              <Button
                size="lg"
                onClick={saveAllNewSales}
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : "Save All New Sales"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {showReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold">
                  Review New Sales
                </h2>

                <p className="text-sm text-muted-foreground">
                  Please verify all information before saving.
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setShowReview(false)
                }
                disabled={confirming}
              >
                Close
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <Card className="mb-6 p-5">
                <div className="mb-4">
                  <h3 className="font-semibold">
                    Batch Information
                  </h3>

                  <p className="text-sm text-muted-foreground">
                    Information shared by all sales in this batch.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label>Branch</Label>
                    <p className="mt-1 text-sm font-medium">
                      {branch || "—"}
                    </p>
                  </div>

                  <div>
                    <Label>Marketing Account Staff</Label>
                    <p className="mt-1 text-sm font-medium">
                      {mas || "—"}
                    </p>
                  </div>

                  <div>
                    <Label>Date Remitted</Label>
                    <p className="mt-1 text-sm font-medium">
                      {dateRemitted || "—"}
                    </p>
                  </div>
                </div>
              </Card>

              <div className="space-y-6">
                {sales.map((sale, index) => {
                  const selectedProgram =
                    programs.find(
                      (program) =>
                        program.id ===
                        sale.programId,
                    );

                  return (
                    <Card
                      key={sale.id}
                      className="overflow-hidden"
                    >
                      <div className="border-b bg-muted/30 px-5 py-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h3 className="font-semibold">
                              Sale #{index + 1}
                            </h3>

                            <p className="text-sm text-muted-foreground">
                              {sale.existingMember
                                ? "Existing Member"
                                : "New Member"}
                            </p>
                          </div>

                          <Badge variant="secondary">
                            {selectedProgram?.code ||
                              sale.programId ||
                              "No program"}
                          </Badge>
                        </div>
                      </div>

                      <div className="space-y-6 p-5">
                        <section>
                          <h4 className="mb-3 font-medium">
                            Member Information
                          </h4>

                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                              <Label>Member Number</Label>
                              <p className="mt-1 text-sm">
                                {sale.memberNumber || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Surname</Label>
                              <p className="mt-1 text-sm">
                                {sale.surname || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>First Name</Label>
                              <p className="mt-1 text-sm">
                                {sale.firstName || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Middle Name</Label>
                              <p className="mt-1 text-sm">
                                {sale.middleName || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Name Extension</Label>
                              <p className="mt-1 text-sm">
                                {sale.nameExtension || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Birthdate</Label>
                              <p className="mt-1 text-sm">
                                {sale.birthdate || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Birthplace</Label>
                              <p className="mt-1 text-sm">
                                {sale.birthplace || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Gender</Label>
                              <p className="mt-1 text-sm">
                                {sale.gender || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Age</Label>
                              <p className="mt-1 text-sm">
                                {sale.age || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Civil Status</Label>
                              <p className="mt-1 text-sm">
                                {sale.civilStatus || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Contact Number</Label>
                              <p className="mt-1 text-sm">
                                {sale.contactNumber || "—"}
                              </p>
                            </div>
                          </div>
                        </section>

                        <Separator />

                        <section>
                          <h4 className="mb-3 font-medium">
                            Member Address
                          </h4>

                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                              <Label>House / Block / Lot</Label>
                              <p className="mt-1 text-sm">
                                {sale.addressHouse || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Street</Label>
                              <p className="mt-1 text-sm">
                                {sale.addressStreet || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Subdivision / Village</Label>
                              <p className="mt-1 text-sm">
                                {sale.addressSubdivision || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Barangay</Label>
                              <p className="mt-1 text-sm">
                                {sale.addressBarangay || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Municipality / City</Label>
                              <p className="mt-1 text-sm">
                                {sale.addressCity || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Province</Label>
                              <p className="mt-1 text-sm">
                                {sale.addressProvince || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>ZIP Code</Label>
                              <p className="mt-1 text-sm">
                                {sale.addressZip || "—"}
                              </p>
                            </div>
                          </div>
                        </section>

                        <Separator />

                        <section>
                          <div className="mb-3 flex items-center justify-between">
                            <div>
                              <h4 className="font-medium">
                                Beneficiaries
                              </h4>

                              <p className="text-sm text-muted-foreground">
                                {sale.beneficiaries.length} beneficiary
                                {sale.beneficiaries.length ===
                                1
                                  ? ""
                                  : "ies"}
                              </p>
                            </div>
                          </div>

                          {sale.beneficiaries.length ===
                          0 ? (
                            <p className="text-sm text-muted-foreground">
                              No beneficiaries added.
                            </p>
                          ) : (
                            <div className="overflow-x-auto rounded-md border">
                              <table className="w-full text-sm">
                                <thead className="bg-muted/50">
                                  <tr>
                                    <th className="px-4 py-3 text-left font-medium">
                                      #
                                    </th>

                                    <th className="px-4 py-3 text-left font-medium">
                                      Name
                                    </th>

                                    <th className="px-4 py-3 text-left font-medium">
                                      Age
                                    </th>

                                    <th className="px-4 py-3 text-left font-medium">
                                      Birthdate
                                    </th>

                                    <th className="px-4 py-3 text-left font-medium">
                                      Relationship
                                    </th>
                                  </tr>
                                </thead>

                                <tbody>
                                  {sale.beneficiaries.map(
                                    (
                                      beneficiary,
                                      beneficiaryIndex,
                                    ) => (
                                      <tr
                                        key={
                                          beneficiary.id
                                        }
                                        className="border-t"
                                      >
                                        <td className="px-4 py-3">
                                          {beneficiaryIndex +
                                            1}
                                        </td>

                                        <td className="px-4 py-3">
                                          {[
                                            beneficiary.firstName,
                                            beneficiary.middleName,
                                            beneficiary.surname,
                                          ]
                                            .filter(Boolean)
                                            .join(" ") ||
                                            "—"}
                                        </td>

                                        <td className="px-4 py-3">
                                          {beneficiary.age ||
                                            "—"}
                                        </td>

                                        <td className="px-4 py-3">
                                          {beneficiary.birthdate ||
                                            "—"}
                                        </td>

                                        <td className="px-4 py-3">
                                          {beneficiary.relationship ||
                                            "—"}
                                        </td>
                                      </tr>
                                    ),
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </section>

                        <Separator />

                        <section>
                          <h4 className="mb-3 font-medium">
                            Claimant
                          </h4>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <Label>Complete Name</Label>
                              <p className="mt-1 text-sm">
                                {sale.claimantName || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Contact Number</Label>
                              <p className="mt-1 text-sm">
                                {sale.claimantContact || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Same as Member Address</Label>
                              <p className="mt-1 text-sm">
                                {sale.claimantSameAsMember
                                  ? "Yes"
                                  : "No"}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4">
                            <Label>Claimant Address</Label>

                            <div className="mt-2 grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4">
                              <div>
                                <Label>House / Block / Lot</Label>
                                <p className="mt-1 text-sm">
                                  {sale.claimantAddressHouse ||
                                    "—"}
                                </p>
                              </div>

                              <div>
                                <Label>Street</Label>
                                <p className="mt-1 text-sm">
                                  {sale.claimantAddressStreet ||
                                    "—"}
                                </p>
                              </div>

                              <div>
                                <Label>Subdivision / Village</Label>
                                <p className="mt-1 text-sm">
                                  {sale.claimantAddressSubdivision ||
                                    "—"}
                                </p>
                              </div>

                              <div>
                                <Label>Barangay</Label>
                                <p className="mt-1 text-sm">
                                  {sale.claimantAddressBarangay ||
                                    "—"}
                                </p>
                              </div>

                              <div>
                                <Label>Municipality / City</Label>
                                <p className="mt-1 text-sm">
                                  {sale.claimantAddressCity ||
                                    "—"}
                                </p>
                              </div>

                              <div>
                                <Label>Province</Label>
                                <p className="mt-1 text-sm">
                                  {sale.claimantAddressProvince ||
                                    "—"}
                                </p>
                              </div>

                              <div>
                                <Label>ZIP Code</Label>
                                <p className="mt-1 text-sm">
                                  {sale.claimantAddressZip ||
                                    "—"}
                                </p>
                              </div>
                            </div>
                          </div>
                        </section>

                        <Separator />

                        <section>
                          <h4 className="mb-3 font-medium">
                            Program & Payment
                          </h4>

                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                              <Label>Program</Label>
                              <p className="mt-1 text-sm">
                                {selectedProgram
                                  ? `${selectedProgram.code} — ${selectedProgram.name}`
                                  : sale.programId || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>DOI</Label>
                              <p className="mt-1 text-sm">
                                {sale.doi || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Payment Method</Label>
                              <p className="mt-1 text-sm">
                                {sale.paymentMethod || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Registration Fee</Label>
                              <p className="mt-1 text-sm">
                                {sale.registrationFee || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Registration Amount</Label>
                              <p className="mt-1 text-sm">
                                {sale.registrationAmount || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>Amount Paid</Label>
                              <p className="mt-1 text-sm">
                                {sale.amountPaid || "—"}
                              </p>
                            </div>

                            <div className="sm:col-span-2">
                              <Label>Program Terms</Label>
                              <p className="mt-1 whitespace-pre-wrap text-sm">
                                {sale.programTerms || "—"}
                              </p>
                            </div>
                          </div>
                        </section>

                        <Separator />

                        <section>
                          <h4 className="mb-3 font-medium">
                            Application & OR Information
                          </h4>

                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <div>
                              <Label>Application No.</Label>
                              <p className="mt-1 text-sm">
                                {sale.applicationNo || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>OR Number</Label>
                              <p className="mt-1 text-sm">
                                {sale.orNumber || "—"}
                              </p>
                            </div>

                            <div>
                              <Label>OR Date</Label>
                              <p className="mt-1 text-sm">
                                {sale.orDate || "—"}
                              </p>
                            </div>
                          </div>
                        </section>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Verify the information carefully before confirming.
              </p>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setShowReview(false)
                  }
                  disabled={confirming}
                >
                  Go Back & Edit
                </Button>

                <Button
                  type="button"
                  onClick={
                    confirmSaveAllNewSales
                  }
                  disabled={confirming}
                >
                  {confirming
                    ? "Saving..."
                    : "Confirm & Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}