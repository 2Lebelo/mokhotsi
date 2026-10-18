// The till's state machine. The camera only scans while no sheet is open, so a
// pending decision (unknown code, size choice, search) always blocks new scans.
// Rows are referenced by id and read fresh from the store on every render.

export type TillSheet =
  | { kind: "none" }
  | { kind: "unknown"; code: string }
  | { kind: "choose-variant"; productId: string }
  | { kind: "search" };

export type TillState = {
  sheet: TillSheet;
  /** The size most recently added, shown with quantity controls. */
  lastVariantId: string | null;
  error: string | null;
};

export type TillAction =
  | { type: "added"; variantId: string }
  | { type: "failed"; message: string }
  | { type: "unknown-code"; code: string }
  | { type: "choose-variant"; productId: string }
  | { type: "open-search" }
  | { type: "close-sheet" }
  | { type: "removed"; variantId: string };

export const initialTillState: TillState = {
  sheet: { kind: "none" },
  lastVariantId: null,
  error: null,
};

const closed: TillSheet = { kind: "none" };

export function tillReducer(state: TillState, action: TillAction): TillState {
  switch (action.type) {
    case "added":
      return { sheet: closed, lastVariantId: action.variantId, error: null };
    case "failed":
      return { ...state, sheet: closed, error: action.message };
    case "unknown-code":
      return {
        ...state,
        sheet: { kind: "unknown", code: action.code },
        error: null,
      };
    case "choose-variant":
      return {
        ...state,
        sheet: { kind: "choose-variant", productId: action.productId },
        error: null,
      };
    case "open-search":
      return { ...state, sheet: { kind: "search" }, error: null };
    case "close-sheet":
      return { ...state, sheet: closed };
    case "removed":
      return state.lastVariantId === action.variantId
        ? { ...state, lastVariantId: null }
        : state;
  }
}

export function isScanning(state: TillState): boolean {
  return state.sheet.kind === "none";
}
