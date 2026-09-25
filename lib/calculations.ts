import type { Collection, Program } from "./types";

export type CollectionStatus =
  | "U"
  | "ADV."
  | "60 D"
  | "90 D"
  | "120 D"
  | "150 D"
  | "NS";

export function calculateTMD(
  programAmount: number,
  nop: number,
): number {
  return programAmount * nop;
}

export function calculateBalance(
  basePay: number,
  status: CollectionStatus,
): number {
  switch (status) {
    case "60 D":
      return basePay * 2;

    case "90 D":
      return basePay * 3;

    case "120 D":
      return basePay * 4;

    case "U":
      return basePay * 1;

    case "ADV.":
      return basePay * 0;

    case "150 D":
      return basePay * 5;

    case "NS":
      return basePay * 1;

    default:
      return 0;
  }
}

export function getNextNOP(
  memberId: string,
  programId: string,
  collections: Collection[],
): number {
  const programCollections =
    collections.filter(
      (collection) =>
        collection.memberId === memberId &&
        collection.programId === programId,
    );

  if (programCollections.length === 0) {
    return 1;
  }

  const highestNOP = Math.max(
    ...programCollections.map(
      (collection) => collection.nop,
    ),
  );

  return highestNOP + 1;
}

export function getProgramBasePay(
  program: Pick<Program, "basePay">,
): number {
  return program.basePay;
}

export function calculateCollectionTMD(
  program: Pick<Program, "basePay">,
  nop: number,
): number {
  const basePay = getProgramBasePay(program);

  return calculateTMD(basePay, nop);
}
