import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { Directory, File, Paths, UploadType } from "expo-file-system";

import { toHex, type Sha256 } from "@/lib/hmac";
import type { CloudinaryUpload, FileStore, UploadTicket } from "@/sync/types";

/** SHA-256 on the phone's native crypto. */
export const sha256: Sha256 = async (data) =>
  new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, data as Uint8Array<ArrayBuffer>));

/** Lower-case hex SHA-256 of a file's bytes: how images are synced and deduplicated. */
export async function fileSha256(uri: string): Promise<string> {
  const bytes = new Uint8Array(await new File(uri).arrayBuffer());
  return toHex(await sha256(bytes));
}

// Images synced from other phones, named by content hash (one copy per image per phone).
function syncedDirectory() {
  return new Directory(Paths.document, "synced-files");
}

/** Images on this phone's storage, as sync/shop-sync.ts uses them. */
export const files: FileStore = {
  sha256: fileSha256,

  exists(uri) {
    try {
      return new File(uri).exists;
    } catch {
      return false;
    }
  },

  size(uri) {
    try {
      return new File(uri).size ?? 0;
    } catch {
      return 0;
    }
  },

  async upload(uri: string, ticket: UploadTicket): Promise<CloudinaryUpload> {
    const result = await new File(uri).upload(ticket.url, {
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType: "image/jpeg",
      parameters: ticket.fields,
    });
    if (result.status < 200 || result.status >= 300)
      throw new Error(`The image upload failed (${result.status}).`);
    const body = JSON.parse(result.body) as CloudinaryUpload;
    return {
      public_id: body.public_id,
      version: body.version,
      signature: body.signature,
      format: body.format,
      bytes: body.bytes,
      width: body.width,
      height: body.height,
    };
  },

  async download(url, uri) {
    syncedDirectory().create({ idempotent: true, intermediates: true });
    await File.downloadFileAsync(url, new File(uri), { idempotent: true });
  },

  uriFor(hash) {
    return new File(syncedDirectory(), `${hash}.jpg`).uri;
  },
};
