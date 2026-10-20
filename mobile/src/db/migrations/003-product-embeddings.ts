import type { Migration } from "./types.ts";

// One row per taught view of a product. Vectors are tied to the embedder version
// that produced them; `image_uri` points at the source image (the product photo or a
// saved crop) so views can be re-embedded when the model changes.
export const productEmbeddings: Migration = {
  version: 3,
  name: "product-embeddings",
  up: (db) =>
    db.execSync(`
      CREATE TABLE product_embeddings (
        id TEXT PRIMARY KEY NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        model_version TEXT NOT NULL CHECK(length(model_version) > 0),
        vector BLOB NOT NULL CHECK(length(vector) > 0 AND length(vector) % 4 = 0),
        source TEXT NOT NULL CHECK(source IN ('photo', 'teach', 'correction')),
        image_uri TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX embeddings_version_product ON product_embeddings(model_version, product_id);
      CREATE INDEX embeddings_product_source ON product_embeddings(product_id, source, created_at);
    `),
};
