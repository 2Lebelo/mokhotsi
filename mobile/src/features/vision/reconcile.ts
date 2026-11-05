import { File } from "expo-file-system";
import { loadImage, type Image } from "react-native-nitro-image";

import type { ShopStore } from "@/db/store";
import { MANIFEST } from "@/features/vision/config";
import { fileSha256, sha256 } from "@/features/files";
import { derivedViewId } from "@/sync/ids";
import { toFilePath } from "@/features/vision/crops";
import {
  disposeImages,
  embedImage,
  embedPhotoViews,
} from "@/features/vision/still-pipeline";
import { vision, type VisionModels } from "@/features/vision/vision-service";

const STALE_BATCH = 25;
/** Photos saved before images were synced, hashed per run (each read is a whole file). */
const HASH_BATCH = 2;

export type ReconcileResult = { embedded: number };

/** Images that failed to embed this session; retried after the next app start. */
const failed = new Set<string>();

function exists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * Runs one image file through the models in the background; undefined if a
 * camera screen took over or the image could not be embedded.
 */
async function withImage<T>(
  uri: string,
  work: (models: VisionModels, image: Image) => Promise<T>,
): Promise<T | undefined> {
  try {
    return await vision.runInBackground(async () => {
      const models = await vision.load();
      const image = await loadImage({ filePath: toFilePath(uri) });
      try {
        return await work(models, image);
      } finally {
        disposeImages(image);
      }
    });
  } catch {
    failed.add(uri);
    return undefined;
  }
}

/** Hashes a few photos saved before images were synced, so they can be uploaded. */
async function hashOlderPhotos(store: ShopStore): Promise<void> {
  for (const uri of store.catalogue.unhashedPhotos(HASH_BATCH)) {
    if (!exists(uri)) continue;
    try {
      store.catalogue.setPhotoHash(uri, await fileSha256(uri));
    } catch {
      /* Unreadable for now; tried again on the next run. */
    }
  }
}

/** Derived ids for the views of one image (see sync/ids.ts); random without a hash. */
function viewIds(
  version: string,
  imageSha: string | null,
  count: number,
): Promise<string[] | undefined> {
  if (!imageSha) return Promise.resolve(undefined);
  return Promise.all(
    Array.from({ length: count }, (_, n) => derivedViewId(sha256, version, imageSha, n)),
  );
}

/**
 * Brings stored vectors in line with the catalogue and the current embedder:
 * product photos (main and second) that changed or were never embedded, and
 * saved-crop views from an older model. Pending work is derived from the database, so an interrupted run
 * continues next time. Yields to camera screens between items, and loads models
 * only when there is an image that can actually be embedded.
 */
export async function reconcileEmbeddings(
  store: ShopStore,
): Promise<ReconcileResult> {
  const version = MANIFEST.embedder.model_version;
  let embedded = 0;
  let changed = store.embeddings.removeStalePhotos(version) > 0;
  await hashOlderPhotos(store);

  for (const { productId, photoUri, photoSha } of store.embeddings.pendingPhotos(
    version,
  )) {
    if (vision.inForeground) break;
    // A photo synced from another phone may still be downloading.
    if (failed.has(photoUri) || !exists(photoUri)) continue;
    const vectors = await withImage(photoUri, embedPhotoViews);
    if (!vectors?.length) continue;
    store.embeddings.replacePhoto({
      productId,
      modelVersion: version,
      vectors,
      ids: await viewIds(version, photoSha, vectors.length),
      imageUri: photoUri,
      imageSha256: photoSha,
    });
    embedded++;
  }

  for (const stale of store.embeddings.stale(version, STALE_BATCH)) {
    if (vision.inForeground) break;
    if (!exists(stale.image_uri)) {
      // A crop synced from another phone may still be downloading; one lost here can
      // never be rebuilt, so its outdated view goes.
      const downloading =
        stale.image_sha256 && store.files.get(stale.image_sha256)?.state === "missing";
      if (!downloading) {
        store.embeddings.forget(stale.id);
        changed = true;
      }
      continue;
    }
    if (failed.has(stale.image_uri)) continue;
    const view = await withImage(stale.image_uri, (models, image) =>
      embedImage(models, image, { detect: false }),
    );
    if (!view) continue;
    store.embeddings.replaceStale(stale.id, {
      id: (await viewIds(version, stale.image_sha256, 1))?.[0],
      productId: stale.product_id,
      modelVersion: version,
      vector: view.vector,
      source: stale.source,
      imageUri: stale.image_uri,
      imageSha256: stale.image_sha256,
    });
    embedded++;
  }

  if (changed || embedded > 0) vision.invalidate();
  return { embedded };
}
