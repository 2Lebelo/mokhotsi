import type { ShopStore } from "../db/store.ts";
import type { FileStore } from "./types.ts";

export type BindOptions = {
  shopId: string;
  /**
   * This phone holds the shop's data claim: its file is the shop's history, which the
   * server does not have yet. Any other phone downloads the shop instead.
   */
  claimant: boolean;
  /** The embedder this phone runs; its views are uploaded with the claimed data. */
  modelVersion: string;
};

/**
 * Ties a shop file to its shop on the server, once. From then on every change is queued.
 *
 * - The claimant uploads everything it has, in the order the server needs it: products
 *   (with photo hashes), each size's stock as an opening movement, every past sale and
 *   reversal as `imported` (already reflected in that stock), then the stored views.
 * - Any other phone empties the file of what it held before (a development phone, a
 *   reinstall) and downloads the shop, so two catalogues are never merged by accident.
 */
export async function bindShop(
  store: ShopStore,
  files: FileStore,
  options: BindOptions,
): Promise<void> {
  if (store.sync.isBound()) return;
  if (!options.claimant) {
    store.transaction(() => {
      if (store.hasData()) store.sync.resetForSnapshot();
      store.sync.bind(options.shopId, { snapshot: true });
    });
    return;
  }

  // Hashing reads whole files, so it happens before the (synchronous) transaction.
  await hashImages(store, files);
  store.transaction(() => {
    store.sync.bind(options.shopId, { snapshot: false });
    store.catalogue.queueAll();
    store.stock.queueOpeningStock();
    store.sales.queueImported();
    store.embeddings.queueAll(options.modelVersion);
  });
}

/** Hashes photos and crops saved before images were synced (still on this phone). */
async function hashImages(store: ShopStore, files: FileStore): Promise<void> {
  for (const uri of store.catalogue.unhashedPhotos())
    if (files.exists(uri)) store.catalogue.setPhotoHash(uri, await files.sha256(uri));
  for (const uri of store.embeddings.unhashedCrops())
    if (files.exists(uri)) store.embeddings.setImageHash(uri, await files.sha256(uri));
}
