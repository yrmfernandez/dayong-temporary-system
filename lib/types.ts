export type Address = {
  houseBlockLot: string;
  street: string;
  subdivisionVillage: string;
  barangay: string;
  municipalityCity: string;
  province: string;
  zipCode: string;
};

export type PersonName = {
  surname: string;
  firstName: string;
  middleName: string;
  nameExtension: string;
};

export type Claimant = {
  completeName: string;
  contactNumber: string;
  sameAsMemberAddress: boolean;
  address: Address;
};

export type Beneficiary = {
  id: string;
  surname: string;
  firstName: string;
  middleName: string;
  age: number | null;
  birthdate: string;
  relationship: string;
};

export type Member = {
  id: string;
  phMemberNumber: string;

  name: PersonName;

  birthdate: string;
  birthplace: string;
  gender: string;
  age: number | null;
  civilStatus: string;
  contactNumber: string;

  address: Address;

  claimant: Claimant;
};

export type ProgramEnrollment = {
  id: string;

  // The member who owns this program
  memberId: string;

  programType: string;
  dateEnrolled: string;

  modeOfPayment: string;

  withRegistrationFee: boolean;
  registrationAmount: number;

  amountPaid: number;

  programTerms: string;

  branch: string;
  mas: string;
};

export type Program = {
  id: string;

  code: string;
  name: string;

  basePay: number;

  masCommission: number;
  collectorCommission: number;

  commissionType: "fixed" | "percentage";

  description: string;

  dateStarted: string;
  dateEnded: string | null;

  status: "active" | "inactive";
};

export type NewSale = {
  id: string;

  member: Member;

  beneficiaries: Beneficiary[];

  program: ProgramEnrollment;

  applicationNumber: string;

  orNumber: string;
  orDate: string;

  dateRemitted: string;
};

export type Collection = {
  id: string;

  memberId: string;
  programId: string;

  branch: string;
  marketingAgent: string;

  phMemberNumber: string;

  orNumber: string;
  orDate: string;

  amountCollected: number;

  monthOf: string;

  nop: number;

  dateRemitted: string;

  reactivation: boolean;
  transferred: boolean;

  ifSuspended: string;

  originalMasOfficerName: string;

  status: string;
};