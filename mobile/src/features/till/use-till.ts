import { useReducer } from "react";

import { errorMessage } from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { feedback } from "@/features/feedback";
import { resolveRecognition } from "@/features/recognition/resolve";
import type { Recognition } from "@/features/recognition/types";
import {
  initialTillState,
  isScanning,
  tillReducer,
} from "@/features/till/till-reducer";

/** Connects camera recognitions and manual picks to the persistent cart. */
export function useTill() {
  const { store, refresh } = useShop();
  const [state, dispatch] = useReducer(tillReducer, initialTillState);

  function addVariant(variantId: string) {
    try {
      store.cart.add(variantId);
      refresh();
      feedback.success();
      dispatch({ type: "added", variantId });
    } catch (cause) {
      feedback.error();
      dispatch({ type: "failed", message: errorMessage(cause) });
    }
  }

  function handleRecognition(recognition: Recognition) {
    const resolution = resolveRecognition(store.catalogue, recognition);
    switch (resolution.status) {
      case "matched":
        return addVariant(resolution.variant.id);
      case "choose-variant":
        feedback.warning();
        return dispatch({
          type: "choose-variant",
          productId: resolution.product.id,
        });
      case "unknown":
        feedback.error();
        return recognition.kind === "barcode"
          ? dispatch({ type: "unknown-code", code: recognition.code })
          : dispatch({ type: "failed", message: "Product not recognised." });
    }
  }

  /** A manual pick: one-size products go straight to the cart. */
  function chooseProduct(productId: string) {
    const product = store.catalogue.product(productId);
    if (product?.variants.length === 1) addVariant(product.variants[0].id);
    else dispatch({ type: "choose-variant", productId });
  }

  function setQuantity(variantId: string, quantity: number) {
    try {
      store.cart.setQuantity(variantId, quantity);
      refresh();
      if (quantity === 0) dispatch({ type: "removed", variantId });
    } catch (cause) {
      feedback.error();
      dispatch({ type: "failed", message: errorMessage(cause) });
    }
  }

  return {
    state,
    scanning: isScanning(state),
    handleRecognition,
    addVariant,
    chooseProduct,
    setQuantity,
    openSearch: () => dispatch({ type: "open-search" }),
    closeSheet: () => dispatch({ type: "close-sheet" }),
  };
}
