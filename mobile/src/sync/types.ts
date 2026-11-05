/** A signed Cloudinary upload, from POST /sync/photos/uploads: send `fields` unchanged. */
export type UploadTicket = { url: string; fields: Record<string, string> };

/** What Cloudinary answers to an upload; the API checks its signature (POST /photos/confirm). */
export type CloudinaryUpload = {
  public_id: string;
  version: number;
  signature: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
};

/**
 * The file system as sync needs it. The app uses features/files.ts (Expo); tests use a fake,
 * which keeps everything in src/sync free of native modules.
 */
export interface FileStore {
  /** Lower-case hex SHA-256 of the file's bytes. */
  sha256(uri: string): Promise<string>;
  exists(uri: string): boolean;
  /** Size in bytes (0 when the file is missing). */
  size(uri: string): number;
  upload(uri: string, ticket: UploadTicket): Promise<CloudinaryUpload>;
  /** Saves `url` to `uri` (replacing a partial earlier attempt). */
  download(url: string, uri: string): Promise<void>;
  /** Where an image synced from another phone is kept, by its hash. */
  uriFor(sha256: string): string;
}
