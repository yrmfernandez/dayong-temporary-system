import type { Member } from "./types";

export const mockMembers: Member[] = [
  {
    id: "member-001",
    phMemberNumber: "PH-000001",
    name: {
      surname: "Dela Cruz",
      firstName: "Juan",
      middleName: "Santos",
      nameExtension: "",
    },
    birthdate: "1990-05-15",
    birthplace: "Davao City",
    gender: "male",
    age: 36,
    civilStatus: "married",
    contactNumber: "09171234567",
    address: {
      houseBlockLot: "Blk 1 Lot 2",
      street: "Sample Street",
      subdivisionVillage: "Sample Village",
      barangay: "Mintal",
      municipalityCity: "Davao City",
      province: "Davao del Sur",
      zipCode: "8000",
    },
    claimant: {
      completeName: "Maria Dela Cruz",
      contactNumber: "09181234567",
      sameAsMemberAddress: true,
      address: {
        houseBlockLot: "Blk 1 Lot 2",
        street: "Sample Street",
        subdivisionVillage: "Sample Village",
        barangay: "Mintal",
        municipalityCity: "Davao City",
        province: "Davao del Sur",
        zipCode: "8000",
      },
    },
  },
];