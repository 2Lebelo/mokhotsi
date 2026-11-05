import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import type { Image } from "react-native-nitro-image";

import { centerSquare } from "@/ml/geometry";
import { toFilePath } from "@/features/vision/crops";
import { disposeImages } from "@/features/vision/still-pipeline";

/** Side of a stored product photo: plenty for a thumbnail and for embedding (448 px). */
const PHOTO_SIZE = 1080;

/**
 * Free space below which no new photo is taken. A photo is about 0.3 MB, but a phone this
 * full also starts failing database writes, and Android is already clearing app caches.
 */
const MIN_FREE_BYTES = 50 * 1024 * 1024;

/** When this JS runtime started: a staged photo older than this belongs to no open form. */
const RUNTIME_STARTED = Date.now();

/** Cache files written by versions before photos were staged in app documents. */
const LEGACY_CACHE_PHOTO = /^photo-[0-9a-f-]{36}\.jpg$/i;

export const PHOTO_MESSAGES = {
  lost: "The photo is no longer on this phone. Please add it again.",
  storageFull:
    "Your phone's storage is almost full. Free up some space, then try again.",
} as const;

/** A photo step failed for a reason the cashier can act on; the message is safe to show. */
export class PhotoError extends Error {
  override name = "PhotoError";
}

// Photos live in app documents, never in the cache: Android deletes cache files whenever
// storage runs low, even while the form showing them is still open (the copy on save then
// fails with "No such file").

/** Photos of saved products. */
function photoDirectory() {
  return new Directory(Paths.document, "product-photos");
}

/** Photos taken or chosen in a product form that is not saved yet. */
function stagingDirectory() {
  return new Directory(Paths.document, "photo-staging");
}

function isInside(directory: Directory, uri: string) {
  return uri.startsWith(`${directory.uri.replace(/\/$/, "")}/`);
}

function ownsPhoto(uri: string) {
  return isInside(photoDirectory(), uri);
}

export function photoExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/** Whether there is room to take a photo; an unreadable figure never blocks the shop. */
export function hasRoomForPhoto(): boolean {
  try {
    return Paths.availableDiskSpace >= MIN_FREE_BYTES;
  } catch {
    return true;
  }
}

/**
 * A message about a failed photo step that is safe to show. A PhotoError already says what
 * to do; anything else (a native exception) is logged and replaced by `fallback`.
 */
export function photoProblem(cause: unknown, fallback: string): string {
  if (cause instanceof PhotoError) return cause.message;
  console.warn(
    `[photos] ${fallback} ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  return hasRoomForPhoto() ? fallback : PHOTO_MESSAGES.storageFull;
}

/**
 * Copies a staged photo into product storage; resolves once the copy is complete on disk.
 * The staged file is left alone, so a save that fails later can be retried; the form
 * discards it once the product is saved.
 */
export async function savePhoto(source: string | null): Promise<string | null> {
  if (!source) return null;
  if (ownsPhoto(source)) return source;
  if (!photoExists(source)) throw new PhotoError(PHOTO_MESSAGES.lost);
  const directory = photoDirectory();
  const extension =
    source.split("?")[0].match(/\.(jpg|jpeg|png|webp|heic)$/i)?.[1] ?? "jpg";
  const target = new File(directory, `${randomUUID()}.${extension}`);
  try {
    directory.create({ idempotent: true, intermediates: true });
    // `copy` is asynchronous: the target does not exist until it resolves.
    await new File(source).copy(target);
  } catch (error) {
    removePhoto(target.uri);
    if (!photoExists(source)) throw new PhotoError(PHOTO_MESSAGES.lost);
    throw new PhotoError(
      photoProblem(error, "The photo could not be stored. Please try again."),
    );
  }
  return target.uri;
}

/**
 * Turns a captured or chosen image into a product photo: its centre square, at most
 * PHOTO_SIZE pixels, as a JPEG in the staging directory (`savePhoto` copies it into product
 * storage when the product is saved). A full-resolution photo would cost every later decode
 * (thumbnails, the background embedder) tens of megabytes. The caller still owns `image`.
 */
export async function squarePhoto(image: Image): Promise<string> {
  const square = centerSquare(image.width, image.height);
  const size = Math.min(square.size, PHOTO_SIZE);
  const owned: Image[] = [];
  try {
    const cropped = await image.cropAsync(
      square.x,
      square.y,
      square.x + square.size,
      square.y + square.size,
    );
    owned.push(cropped);
    const resized =
      size === square.size ? cropped : await cropped.resizeAsync(size, size);
    owned.push(resized);
    const directory = stagingDirectory();
    directory.create({ idempotent: true, intermediates: true });
    const file = new File(directory, `${randomUUID()}.jpg`);
    await resized.saveToFileAsync(toFilePath(file.uri), "jpg", 85);
    return file.uri;
  } finally {
    disposeImages(...owned.filter((each) => !each.equals(image)));
  }
}

/** Deletes a photo that no saved product uses. */
export function removePhoto(uri: string | null): void {
  if (!uri || !ownsPhoto(uri)) return;
  deleteQuietly(new File(uri));
}

/** Deletes a photo taken in a form that was not saved; any other file is left alone. */
export function discardStagedPhoto(uri: string | null | undefined): void {
  if (!uri || !isInside(stagingDirectory(), uri)) return;
  deleteQuietly(new File(uri));
}

/**
 * Deletes staged photos left by forms that were never saved (the app was closed or
 * crashed), and the cache copies older versions left behind. Files from before this JS
 * runtime started cannot belong to an open form, so this is safe to call at any time.
 */
export function sweepStagedPhotos(): void {
  sweep(stagingDirectory(), () => true);
  sweep(Paths.cache, (name) => LEGACY_CACHE_PHOTO.test(name));
}

function sweep(directory: Directory, matches: (name: string) => boolean) {
  let entries: (Directory | File)[];
  try {
    if (!directory.exists) return;
    entries = directory.list();
  } catch {
    return; // Leftovers are retried at the next start.
  }
  for (const entry of entries)
    if (
      entry instanceof File &&
      matches(entry.name) &&
      (entry.lastModified ?? 0) < RUNTIME_STARTED
    )
      deleteQuietly(entry);
}

function deleteQuietly(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    /* A leftover file costs a little space; it never breaks a product. */
  }
}
