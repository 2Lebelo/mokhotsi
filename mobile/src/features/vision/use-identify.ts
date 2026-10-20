import { router } from "expo-router";
import { useReducer, useState } from "react";

import { errorMessage } from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { MatchVoter } from "@/ml/voter";
import { feedback } from "@/features/feedback";
import { resolveRecognition } from "@/features/recognition/resolve";
import { MANIFEST } from "@/features/vision/config";
import { saveCorrection } from "@/features/vision/enrolment";
import {
  identifyReducer,
  initialIdentifyState,
  isCorrection,
  isIdentifying,
  isProcessing,
} from "@/features/vision/identify-reducer";
import type { EmbeddedView } from "@/features/vision/types";
import type { LiveDetection } from "@/features/vision/use-live-pipeline";
import { vision } from "@/features/vision/vision-service";

/**
 * The identify flow: embedded views → ranking against known products → voted
 * lock → cashier picks → size (if 2+) → cart → back to the Till. Picking anything
 * other than the model's best guess teaches that view to the chosen product.
 */
export function useIdentify() {
  const { store, refresh } = useShop();
  const [state, dispatch] = useReducer(identifyReducer, initialIdentifyState);
  const [voter] = useState(() => new MatchVoter(MANIFEST.matching));
  const index = vision.vectorIndex(store);

  function onView(view: EmbeddedView, { single }: { single: boolean }) {
    const ranking = index.topK(view.vector, MANIFEST.matching.top_k);
    // A single captured photo is shown directly; live views must win repeatedly.
    const locked = single ? ranking.length > 0 : voter.push(ranking) !== null;
    if (locked) feedback.success();
    dispatch({ type: "matched", view, ranking, locked, at: Date.now() });
  }

  function addToCart(variantId: string) {
    try {
      store.cart.add(variantId);
      refresh();
      feedback.success();
      router.navigate({ pathname: "/till", params: { added: variantId } });
    } catch (cause) {
      feedback.error();
      dispatch({ type: "failed", message: errorMessage(cause) });
    }
  }

  function pick(productId: string) {
    if (state.view && isCorrection(state, productId, Date.now())) {
      const view = state.view;
      saveCorrection(store, productId, view)
        .then(refresh)
        .catch(() => {
          /* Learning is best effort; the sale continues regardless. */
        });
    }
    const resolution = resolveRecognition(store.catalogue, {
      kind: "visual",
      productId,
      score: state.ranking.find((c) => c.productId === productId)?.score ?? 0,
    });
    if (resolution.status === "matched") addToCart(resolution.variant.id);
    else if (resolution.status === "choose-variant")
      dispatch({ type: "choose-size", productId });
    else
      dispatch({
        type: "failed",
        message: "This product has no sizes for sale.",
      });
  }

  function retry() {
    voter.reset();
    dispatch({ type: "retry" });
  }

  return {
    state,
    processing: isProcessing(state),
    /** An item is held still and being matched: show the spinner. */
    identifying: isIdentifying(state),
    knownViews: index.size,
    onDetection: (detection: LiveDetection) =>
      dispatch({ type: "detected", detection }),
    onView,
    onError: (message: string) => dispatch({ type: "failed", message }),
    showMatches: () => dispatch({ type: "show-matches" }),
    search: () => dispatch({ type: "search" }),
    pick,
    addToCart,
    retry,
  };
}
