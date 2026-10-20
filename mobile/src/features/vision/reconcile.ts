import { File } from "expo-file-system";
import { loadImage, type Image } from "react-native-nitro-image";

import type { ShopStore } from "@/db/store";
import { MANIFEST } from "@/features/vision/config";
import { toFilePath } from "@/features/vision/crops";
import { embedImage, embedPhotoViews } from "@/features/vision/still-pipeline";
import { vision, type VisionModels } from "@/features/vision/vision-service";

const STALE_BATCH = 25;

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
      return work(models, image);
    });
  } catch {
    failed.add(uri);
    return undefined;
  }
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

  for (const { productId, photoUri } of store.embeddings.pendingPhotos(
    version,
  )) {
    if (vision.inForeground) break;
    if (failed.has(photoUri) || !exists(photoUri)) continue;
    const vectors = await withImage(photoUri, embedPhotoViews);
    if (!vectors?.length) continue;
    store.embeddings.replacePhoto({
      productId,
      modelVersion: version,
      vectors,
      imageUri: photoUri,
    });
    embedded++;
  }

  for (const stale of store.embeddings.stale(version, STALE_BATCH)) {
    if (vision.inForeground) break;
    if (!exists(stale.image_uri)) {
      // Without its image an outdated view can never be rebuilt.
      store.embeddings.removeById(stale.id);
      changed = true;
      continue;
    }
    if (failed.has(stale.image_uri)) continue;
    const view = await withImage(stale.image_uri, (models, image) =>
      embedImage(models, image, { detect: false }),
    );
    if (!view) continue;
    store.embeddings.replaceStale(stale.id, {
      productId: stale.product_id,
      modelVersion: version,
      vector: view.vector,
      source: stale.source,
      imageUri: stale.image_uri,
    });
    embedded++;
  }

  if (changed || embedded > 0) vision.invalidate();
  return { embedded };
}
