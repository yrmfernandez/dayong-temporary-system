/** A member or claimant address, entered as one complete line (house, street, barangay, city, province). */
export type Address = {
  houseBlockLot: string;
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
  sameAsMemberContact?: boolean;
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

/**
 * Program master data
 *
 * This represents the programs stored in Google Sheets.
 * Program Type in New Sales should come from these records.
 */
export type Program = {
  id: string;
  code: string;
  name: string;
  basePay: number;
  status: "active" | "inactive";
  description: string;
  registrationFeeRequired: boolean;
  registrationAmount: number;
  payBalanceTotal: number;
  ageRestricted: boolean;
  minAge: number | null;
  maxAge: number | null;
  /** New Sale incentive for programs with a registration fee (Programs Q:R). */
  saleIncentiveType?: "fixed" | "percentage" | "";
  saleIncentiveAmount?: number;
  /** Programs T:U: whether encoders may type the New Sale / Collection amount. False (the default) locks it. */
  newSaleAmountEditable?: boolean;
  /** Flexible payments: basePay is the minimum monthly payment; amounts follow what is paid. */
  flexible?: boolean;
  maxMonthlyPayment?: number | null;
  collectionAmountEditable?: boolean;
  /** MAS and Collector incentive tiers by month; month 1 applies to a New Sale without a registration fee. */
  incentiveTiers?: Array<{ role: "MAS" | "Collector"; fromMonth: number; toMonth: number; incentiveType: "fixed" | "percentage"; markUp: number; incentiveAmount: number }>;
};
/**
 * Program enrollment for a member.
 *
 * These are the values entered when registering a member
 * into a program in New Sales.
 */
export type ProgramEnrollment = {
  id: string;
  memberId: string;
  programCode: string;
  dateEnrolled: string;
  modeOfPayment: string;
  withRegistrationFee: boolean;
  registrationAmount: number;
  amountPaid: number;
  programTerms: string;
  branch: string;
  mas: string;
};

/**
 * New Sales record
 */
export type NewSale = {
  id: string;

  member: Member;

  beneficiaries: Beneficiary[];

  program: ProgramEnrollment;

  applicationNumber: string;
  orDate: string;
  /** Why an application date more than a day old is encoded late. */
  backdateReason?: string;

  dateRemitted: string;
};

/**
 * Collection record
 */
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
