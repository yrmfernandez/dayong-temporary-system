/** What a clearing covers (lib/clearing.ts); kept apart from it so browser components can use it. */
export type ClearingKind = "New Sales" | "Collections";
export type ClearingCovers = "Both" | ClearingKind;
export const CLEARING_COVERS: ClearingCovers[] = ["Both", "New Sales", "Collections"];
/** The kinds a clearing lets the clerk encode. */
export const coveredKinds = (covers: ClearingCovers): ClearingKind[] => covers === "Both" ? ["New Sales", "Collections"] : [covers];
