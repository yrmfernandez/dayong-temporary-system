"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Search,
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

import { emptyBeneficiary, emptyNewSale } from "@/lib/defaults";
import { mockMembers } from "@/lib/mock-members";

import type {
  Address,
  Beneficiary,
  Member,
  NewSale,
} from "@/lib/types";

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

function calculateAge(birthdate: string): number | null {
  if (!birthdate) return null;

  const birth = new Date(birthdate);
  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();

  const monthDifference =
    today.getMonth() - birth.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 &&
      today.getDate() < birth.getDate())
  ) {
    age--;
  }

  return age >= 0 ? age : null;
}

export default function NewSalesPage() {
  const [branch, setBranch] = useState("");
  const [mas, setMas] = useState("");

  const [sales, setSales] = useState<NewSale[]>([
    emptyNewSale(),
  ]);

  const [expandedSales, setExpandedSales] =
    useState<Record<string, boolean>>({
      [sales[0].id]: true,
    });

  const [searchResults, setSearchResults] =
    useState<Record<string, Member | null>>({});

  const [searchMessage, setSearchMessage] =
    useState<Record<string, string>>({});

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

  const addSale = () => {
    const newSale = emptyNewSale(branch, mas);

    setSales((current) => [
      ...current,
      newSale,
    ]);

    setExpandedSales((current) => ({
      ...current,
      [newSale.id]: true,
    }));
  };

  const removeSale = (saleId: string) => {
    if (sales.length === 1) return;

    setSales((current) =>
      current.filter(
        (sale) => sale.id !== saleId,
      ),
    );

    setExpandedSales((current) => {
      const updated = { ...current };
      delete updated[saleId];
      return updated;
    });

    setSearchResults((current) => {
      const updated = { ...current };
      delete updated[saleId];
      return updated;
    });

    setSearchMessage((current) => {
      const updated = { ...current };
      delete updated[saleId];
      return updated;
    });
  };

  const toggleSale = (saleId: string) => {
    setExpandedSales((current) => ({
      ...current,
      [saleId]: !current[saleId],
    }));
  };

  const searchMember = (sale: NewSale) => {
    const memberNumber =
      sale.member.phMemberNumber.trim();

    if (!memberNumber) {
      setSearchMessage((current) => ({
        ...current,
        [sale.id]:
          "Please enter a PH / Member Number.",
      }));

      setSearchResults((current) => ({
        ...current,
        [sale.id]: null,
      }));

      return;
    }

    const foundMember = mockMembers.find(
      (member) =>
        member.phMemberNumber.toLowerCase() ===
        memberNumber.toLowerCase(),
    );

    setSearchResults((current) => ({
      ...current,
      [sale.id]: foundMember ?? null,
    }));

    setSearchMessage((current) => ({
      ...current,
      [sale.id]: foundMember
        ? "Existing member found."
        : "No member found. This can be registered as a new member.",
    }));
  };

  const useExistingMember = (
    saleId: string,
    member: Member,
  ) => {
    updateSale(saleId, (sale) => ({
      ...sale,

      member: {
        ...member,

        address: {
          ...member.address,
        },

        claimant: {
          ...member.claimant,

          address: {
            ...member.claimant.address,
          },
        },
      },

      program: {
        ...sale.program,
        memberId: member.id,
      },
    }));

    setSearchMessage((current) => ({
      ...current,
      [saleId]:
        "Existing member selected. You can now add the new program.",
    }));
  };

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

          sameAsMemberAddress: checked,

          address: checked
            ? { ...sale.member.address }
            : {
                ...sale.member.claimant.address,
              },
        },
      },
    }));
  };

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

  const saveSales = () => {
    const encodedDate =
      new Date().toISOString();

    const preparedSales = sales.map(
      (sale) => ({
        ...sale,

        program: {
          ...sale.program,
          branch,
          mas,
        },

        dateRemitted: encodedDate,
      }),
    );

    console.log(
      "NEW SALES TO SAVE:",
      preparedSales,
    );

    alert(
      `${preparedSales.length} new sale${
        preparedSales.length === 1
          ? ""
          : "s"
      } prepared successfully.`,
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* HEADER */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          New Sales
        </h1>

        <p className="text-sm text-muted-foreground">
          Register new members and their program
          enrollments.
        </p>
      </div>

      {/* BATCH INFORMATION */}
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
                onValueChange={(value) => {
                  const selected = value ?? "";

                  setBranch(selected);

                  setSales((current) =>
                    current.map((sale) => ({
                      ...sale,

                      program: {
                        ...sale.program,
                        branch: selected,
                      },
                    })),
                  );
                }}
              >
                <SelectTrigger className="w-full">
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
                onValueChange={(value) => {
                  const selected = value ?? "";

                  setMas(selected);

                  setSales((current) =>
                    current.map((sale) => ({
                      ...sale,

                      program: {
                        ...sale.program,
                        mas: selected,
                      },
                    })),
                  );
                }}
              >
                <SelectTrigger className="w-full">
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
              <Label>Date Encoded</Label>

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

      {/* SALES */}
      <div className="space-y-4">
        {sales.map((sale, index) => {
          const expanded =
            expandedSales[sale.id] ?? true;

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
                    {sales.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
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
                      variant="ghost"
                      size="icon"
                      type="button"
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
                  {/* MEMBER SEARCH */}
                  <section className="space-y-4">
                    <div>
                      <h2 className="font-semibold">
                        Member
                      </h2>

                      <p className="text-sm text-muted-foreground">
                        Search first if the member
                        may already exist.
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-2">
                        <Label>
                          PH / Member Number
                        </Label>

                        <Input
                          value={
                            sale.member
                              .phMemberNumber
                          }
                          onChange={(event) =>
                            updateSale(
                              sale.id,
                              (current) => ({
                                ...current,

                                member: {
                                  ...current.member,

                                  phMemberNumber:
                                    event
                                      .target
                                      .value,
                                },
                              }),
                            )
                          }
                          placeholder="Enter PH / Member Number"
                        />
                      </div>

                      <Button
                        variant="outline"
                        type="button"
                        onClick={() =>
                          searchMember(sale)
                        }
                      >
                        <Search className="mr-2 size-4" />
                        Search
                      </Button>
                    </div>

                    {searchMessage[
                      sale.id
                    ] && (
                      <div className="space-y-3">
                        <div className="rounded-lg border bg-muted/40 p-4">
                          <p className="text-sm font-medium">
                            {
                              searchMessage[
                                sale.id
                              ]
                            }
                          </p>
                        </div>

                        {searchResults[
                          sale.id
                        ] && (
                          <div className="rounded-lg border p-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-medium">
                                  {
                                    searchResults[
                                      sale.id
                                    ]?.name
                                      .surname
                                  }
                                  ,{" "}
                                  {
                                    searchResults[
                                      sale.id
                                    ]?.name
                                      .firstName
                                  }{" "}
                                  {
                                    searchResults[
                                      sale.id
                                    ]?.name
                                      .middleName
                                  }
                                </p>

                                <p className="text-sm text-muted-foreground">
                                  PH / Member No.:{" "}
                                  {
                                    searchResults[
                                      sale.id
                                    ]
                                      ?.phMemberNumber
                                  }
                                </p>

                                <p className="text-sm text-muted-foreground">
                                  {
                                    searchResults[
                                      sale.id
                                    ]?.address
                                      .barangay
                                  }
                                  ,{" "}
                                  {
                                    searchResults[
                                      sale.id
                                    ]?.address
                                      .municipalityCity
                                  }
                                </p>
                              </div>

                              <Button
                                type="button"
                                onClick={() => {
                                  const member =
                                    searchResults[
                                      sale.id
                                    ];

                                  if (member) {
                                    useExistingMember(
                                      sale.id,
                                      member,
                                    );
                                  }
                                }}
                              >
                                Use Existing Member
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  <Separator />

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
                            sale.member.name
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
                          placeholder="Surname"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>
                          First Name *
                        </Label>

                        <Input
                          value={
                            sale.member.name
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
                            sale.member.name
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
                            sale.member.name
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
                            sale.member.gender
                          }
                          onValueChange={(value) =>
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
                            sale.member.age ??
                            ""
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
                          onValueChange={(value) =>
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

                    {/* MEMBER ADDRESS */}
                    <div className="space-y-4">
                      <div>
                        <Label>
                          Present Address *
                        </Label>

                        <p className="text-sm text-muted-foreground">
                          Enter the complete member
                          address.
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
                                  sale.member
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
                                placeholder={label}
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
                          If applicable and eligible
                          for the program.
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
                              onChange={(event) =>
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
                              onChange={(event) =>
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
                              onChange={(event) =>
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
                              onChange={(event) =>
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
                              onChange={(event) =>
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
                              onChange={(event) =>
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
                        The person authorized to claim
                        the member&apos;s benefits in
                        case of the member&apos;s death.
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

                    {/* CLAIMANT ADDRESS */}
                    <div className="space-y-4">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                          <Label>
                            Address *
                          </Label>

                          <p className="text-sm text-muted-foreground">
                            Enter the claimant&apos;s
                            address.
                          </p>
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
                                  sale.member
                                    .claimant
                                    .address[
                                    field
                                  ]
                                }
                                disabled={
                                  sale.member
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
                                placeholder={label}
                              />
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  </section>

                  <Separator />

                  {/* PROGRAM */}
                  <section className="space-y-4">
                    <div>
                      <h2 className="font-semibold">
                        D. Program Details
                      </h2>

                      <p className="text-sm text-muted-foreground">
                        To be filled by the Marketing
                        Account Staff.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>
                          Program Type *
                        </Label>

                        <Select
                          value={
                            sale.program
                              .programType
                          }
                          onValueChange={(value) =>
                            updateSale(
                              sale.id,
                              (current) => ({
                                ...current,

                                program: {
                                  ...current.program,
                                  programType:
                                    value ?? "",
                                },
                              }),
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select program" />
                          </SelectTrigger>

                          <SelectContent>
                            <SelectItem value="cash-assistance">
                              Cash Assistance
                            </SelectItem>

                            <SelectItem value="special-program">
                              Special Program
                            </SelectItem>

                            <SelectItem value="family-program">
                              Family Program
                            </SelectItem>

                            <SelectItem value="services">
                              Services
                            </SelectItem>

                            <SelectItem value="non-commissionable">
                              Non-Commissionable
                            </SelectItem>
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
                      <div className="space-y-2">
                        <Label>
                          Mode of Payment *
                        </Label>

                        <Select
                          value={
                            sale.program
                              .modeOfPayment
                          }
                          onValueChange={(value) =>
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
                          onValueChange={(value) =>
                            updateSale(
                              sale.id,
                              (current) => ({
                                ...current,

                                program: {
                                  ...current.program,

                                  withRegistrationFee:
                                    value ===
                                    "yes",
                                },
                              }),
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
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
                          value={
                            sale.program
                              .registrationAmount ||
                            ""
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

                    <div className="space-y-2">
                      <Label>
                        Amount Paid *
                      </Label>

                      <Input
                        type="number"
                        value={
                          sale.program.amountPaid ||
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
                                    event.target
                                      .value,
                                  ) || 0,
                              },
                            }),
                          )
                        }
                        placeholder="0.00"
                      />
                    </div>

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
                          value={sale.orNumber}
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
                          value={sale.orDate}
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
                        Automatically recorded when
                        the Entry Clerk saves/encodes
                        the transaction.
                      </p>
                    </div>
                  </section>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* ADD ANOTHER SALE */}
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
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
            >
              Cancel
            </Button>

            <Button
              type="button"
              size="lg"
              onClick={saveSales}
            >
              Save All New Sales
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}