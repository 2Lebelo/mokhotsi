import type { ShopStore } from "@/db/store";
import { LEARNING, MANIFEST } from "@/features/vision/config";
import { deleteFiles, saveCrop } from "@/features/vision/crops";
import type { EmbeddedView } from "@/features/vision/types";
import { vision } from "@/features/vision/vision-service";

// Product photos are learnt in the background (see reconcile.ts). The only view
// written from the foreground is a cashier's correction, kept here so the crop
// file, the database row, the correction cap, and the in-memory index never drift.

/** Learns from a cashier's correction at the till: this view belongs to that product. */
export async function saveCorrection(
  store: ShopStore,
  productId: string,
  view: EmbeddedView,
): Promise<void> {
  const imageUri = await saveCrop(productId, view.crop);
  store.embeddings.add({
    productId,
    modelVersion: MANIFEST.embedder.model_version,
    vector: view.vector,
    source: "correction",
    imageUri,
  });
  deleteFiles(
    store.embeddings.pruneCorrections(productId, LEARNING.maxCorrections),
  );
  vision.invalidate();
}
