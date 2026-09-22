"use client";

import { useState } from "react";
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

import { mockMembers } from "@/lib/mock-members";
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

type Sale = {
  id: number;
  expanded: boolean;
  existingMember: boolean;
  memberSearch: string;
  memberNumber: string;
  beneficiaries: Beneficiary[];
  programId: string;

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
  dateEnrolled: string;
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
  dateEnrolled: "",
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
  const [branch, setBranch] = useState("");
  const [mas, setMas] = useState("");

  const [sales, setSales] = useState<Sale[]>([
    createEmptySale(1),
  ]);

  const [errors, setErrors] = useState<
    Record<number, string[]>
  >({});

  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const activePrograms = programs.filter(
    (program) => program.status === "active",
  );

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
    setSales((current) => [
      ...current,
      createEmptySale(Date.now()),
    ]);

    setSaveMessage("");
  };

  const removeSale = (id: number) => {
    if (sales.length === 1) {
      return;
    }

    setSales((current) =>
      current.filter((sale) => sale.id !== id),
    );

    setErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
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
    const member = mockMembers.find(
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
    }

    if (!sale.dateEnrolled) {
      missing.push("Date Enrolled");
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
        "Please complete all required fields before saving.",
      );

      return;
    }

    setSaving(true);

    await new Promise((resolve) =>
      setTimeout(resolve, 700),
    );

    setSaving(false);

    setSaveMessage(
      `${sales.length} ${
        sales.length === 1
          ? "new sale"
          : "new sales"
      } saved successfully.`,
    );

    setErrors({});
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          New Sales
        </h1>

        <p className="text-sm text-muted-foreground">
          Encode multiple new sales from the same MAS
          in one batch.
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

      <div className="space-y-4">
        {sales.map((sale, index) => {
          const memberSearch = sale.memberSearch
            .trim()
            .toLowerCase();

          const matchingMembers = memberSearch
            ? mockMembers
                .filter((member) => {
                  const fullName =
                    `${member.name.firstName} ${member.name.middleName} ${member.name.surname}`
                      .replace(/\s+/g, " ")
                      .trim()
                      .toLowerCase();

                  return fullName.includes(
                    memberSearch,
                  );
                })
                .slice(0, 5)
            : [];

          const saleErrors =
            errors[sale.id] ?? [];

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
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>
                          Program Type *
                        </Label>

                        <Select
                          value={
                            sale.programId
                          }
                          onValueChange={(
                            value,
                          ) =>
                            updateSale(
                              sale.id,
                              {
                                programId:
                                  value ?? "",
                              },
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select program" />
                          </SelectTrigger>

                          <SelectContent>
                            {activePrograms.map(
                              (program) => (
                                <SelectItem
                                  key={
                                    program.id
                                  }
                                  value={
                                    program.id
                                  }
                                >
                                  {program.code} —{" "}
                                  {program.name}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Date Enrolled *
                        </Label>

                        <Input
                          type="date"
                          value={
                            sale.dateEnrolled
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              {
                                dateEnrolled:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        />
                      </div>
                    </div>

                    {sale.programId && (
                      <div className="rounded-lg border bg-muted/40 p-4">
                        {(() => {
                          const selectedProgram =
                            programs.find(
                              (program) =>
                                program.id ===
                                sale.programId,
                            );

                          if (
                            !selectedProgram
                          ) {
                            return null;
                          }

                          return (
                            <div className="grid gap-3 sm:grid-cols-3">
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
                          );
                        })()}
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
        Add New Sale
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
                  : "MAS not selected"}
              </p>

              <div className="mt-3 rounded-lg border bg-muted/40 p-3">
                <p className="text-xs font-medium">
                  Saving / Remittance Reminder
                </p>

                <p className="mt-1 text-xs text-muted-foreground">
                  Verify all member, program,
                  payment, and OR information before
                  saving.
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

              <Button variant="outline">
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
    </div>
  );
}