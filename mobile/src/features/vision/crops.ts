import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { Images } from "react-native-nitro-image";

import { fileSha256 } from "@/features/files";
import type { EmbeddedView } from "@/features/vision/types";

// Taught views keep the exact pixels the embedder saw, so their vectors can be
// rebuilt when the embedder model changes, without re-photographing the shop.

function cropDirectory(productId: string) {
  return new Directory(Paths.document, "product-crops", productId);
}

/** nitro-image reads and writes plain file paths, not file:// URIs. */
export function toFilePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ""));
}

/** Saves a crop as JPEG; returns its file and content hash (how it is synced). */
export async function saveCrop(
  productId: string,
  crop: EmbeddedView["crop"],
): Promise<{ uri: string; sha256: string }> {
  const directory = cropDirectory(productId);
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, `${randomUUID()}.jpg`);
  const image = await Images.loadFromRawPixelDataAsync({
    buffer: crop.rgbx.buffer as ArrayBuffer,
    width: crop.size,
    height: crop.size,
    pixelFormat: "RGBX",
  });
  try {
    // Quality is 0–100: the crop is re-embedded whenever the model changes.
    await image.saveToFileAsync(toFilePath(file.uri), "jpg", 92);
  } finally {
    image.dispose();
  }
  return { uri: file.uri, sha256: await fileSha256(file.uri) };
}

export function deleteFiles(uris: readonly string[]): void {
  for (const uri of uris) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      /* A leftover file never affects matching; the row is already gone. */
    }
  }
}
