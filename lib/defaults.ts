import type {
  Address,
  Beneficiary,
  Claimant,
  Member,
  NewSale,
  PersonName,
  ProgramEnrollment,
} from "./types";

function createId(): string {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function emptyAddress(): Address {
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

export function emptyPersonName(): PersonName {
  return {
    surname: "",
    firstName: "",
    middleName: "",
    nameExtension: "",
  };
}

export function emptyClaimant(): Claimant {
  return {
    completeName: "",
    contactNumber: "",
    address: emptyAddress(),
    sameAsMemberAddress: false,
  };
}

export function emptyMember(): Member {
  return {
    id: createId(),
    phMemberNumber: "",
    name: emptyPersonName(),
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

export function emptyProgram(
  branch = "",
  mas = "",
): ProgramEnrollment {
  return {
    id: createId(),
    memberId: "",
    programCode: "",
    dateEnrolled: "",
    modeOfPayment: "",
    withRegistrationFee: false,
    registrationAmount: 0,
    amountPaid: 0,
    programTerms: "",
    branch,
    mas,
  };
}

export function emptyBeneficiary(): Beneficiary {
  return {
    id: createId(),
    surname: "",
    firstName: "",
    middleName: "",
    age: null,
    birthdate: "",
    relationship: "",
  };
}

export function emptyNewSale(
  branch = "",
  mas = "",
): NewSale {
  const member = emptyMember();
  const program = emptyProgram(branch, mas);

  program.memberId = member.id;

  return {
    id: createId(),
    member,
    program,
    beneficiaries: [],
    applicationNumber: "",
    orDate: "",
    dateRemitted: "",
  };
}
