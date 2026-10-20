import type { Migration } from "./types.ts";

// A product can have a second photo (another angle). Both photos are embedded in
// the background for visual matching; `photo_uri` stays the thumbnail.
export const productSecondPhoto: Migration = {
  version: 4,
  name: "product-second-photo",
  up: (db) => db.execSync("ALTER TABLE products ADD COLUMN photo2_uri TEXT;"),
};
