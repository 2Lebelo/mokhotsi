import type { Candidate } from "../../ml/vector-index.ts";
import type { LiveDetection } from "./use-live-pipeline.ts";
import type { EmbeddedView } from "./types.ts";

// The identify screen's state machine. Processing runs only while no sheet is
// open; the latest embedded view is kept so a cashier's correction can teach it.

export type IdentifySheet =
  | { kind: "none" }
  | { kind: "matches"; confident: boolean }
  | { kind: "size"; productId: string }
  | { kind: "search" };

export type IdentifyState = {
  sheet: IdentifySheet;
  detection: LiveDetection | null;
  /** Best products for `view`, best first. */
  ranking: Candidate[];
  view: EmbeddedView | null;
  /** When `view` was embedded (ms since epoch). */
  viewAt: number;
  error: string | null;
};

export type IdentifyAction =
  | { type: "detected"; detection: LiveDetection }
  | {
      type: "matched";
      view: EmbeddedView;
      ranking: Candidate[];
      locked: boolean;
      at: number;
    }
  | { type: "show-matches" }
  | { type: "choose-size"; productId: string }
  | { type: "search" }
  | { type: "failed"; message: string }
  | { type: "retry" };

export const initialIdentifyState: IdentifyState = {
  sheet: { kind: "none" },
  detection: null,
  ranking: [],
  view: null,
  viewAt: 0,
  error: null,
};

export function identifyReducer(
  state: IdentifyState,
  action: IdentifyAction,
): IdentifyState {
  switch (action.type) {
    case "detected":
      return state.sheet.kind === "none"
        ? { ...state, detection: action.detection }
        : state;
    case "matched":
      if (state.sheet.kind !== "none") return state;
      return {
        ...state,
        view: action.view,
        viewAt: action.at,
        ranking: action.ranking,
        sheet: action.locked
          ? { kind: "matches", confident: true }
          : state.sheet,
      };
    case "show-matches":
      return state.ranking.length
        ? { ...state, sheet: { kind: "matches", confident: false } }
        : state;
    case "choose-size":
      return { ...state, sheet: { kind: "size", productId: action.productId } };
    case "search":
      return { ...state, sheet: { kind: "search" } };
    case "failed":
      return { ...state, sheet: { kind: "none" }, error: action.message };
    case "retry":
      return { ...initialIdentifyState };
  }
}

export function isProcessing(state: IdentifyState): boolean {
  return state.sheet.kind === "none";
}

/** An item is held still and being matched: show a spinner until the matches appear. */
export function isIdentifying(state: IdentifyState): boolean {
  return (
    isProcessing(state) &&
    state.detection?.box != null &&
    state.detection.stable
  );
}

/** A view older than this may show a different item and must not teach anything. */
export const CORRECTION_MAX_AGE_MS = 8000;

/**
 * Whether choosing `productId` corrects the model: the cashier picked something
 * other than its best guess for a view the camera saw moments ago, so that view
 * should teach the chosen product.
 */
export function isCorrection(
  state: IdentifyState,
  productId: string,
  now: number,
): boolean {
  return (
    state.view !== null &&
    now - state.viewAt <= CORRECTION_MAX_AGE_MS &&
    state.ranking[0]?.productId !== productId
  );
}
