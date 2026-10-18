import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

function photoDirectory() {
  return new Directory(Paths.document, "product-photos");
}

function ownsPhoto(uri: string) {
  return uri.startsWith(`${photoDirectory().uri.replace(/\/$/, "")}/`);
}

export function savePhoto(source: string | null): string | null {
  if (!source) return null;
  const directory = photoDirectory();
  if (ownsPhoto(source)) return source;
  directory.create({ idempotent: true, intermediates: true });
  const extension =
    source.split("?")[0].match(/\.(jpg|jpeg|png|webp|heic)$/i)?.[1] ?? "jpg";
  const target = new File(directory, `${randomUUID()}.${extension}`);
  try {
    new File(source).copy(target);
  } catch (error) {
    removePhoto(target.uri);
    throw error;
  }
  return target.uri;
}

export function removePhoto(uri: string | null): void {
  if (!uri || !ownsPhoto(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* A saved product is valid even if old-photo cleanup fails. */
  }
}
