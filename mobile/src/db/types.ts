export type Product = {
  id: string;
  name: string;
  category: string;
  /** The main photo, shown as the thumbnail. */
  photo_uri: string | null;
  /** An optional second angle, used only for visual matching. */
  photo2_uri: string | null;
  created_at: string;
  updated_at: string;
};

/** One sellable size of a product, with its own price, stock, and barcode. */
export type Variant = {
  id: string;
  product_id: string;
  size_milli: number;
  unit: string;
  price_cents: number;
  stock: number;
  barcode: string | null;
  position: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductWithVariants = Product & { variants: Variant[] };

/** A size joined with the product fields a till, cart, or receipt shows. */
export type SellableVariant = Variant & {
  product_name: string;
  category: string;
  photo_uri: string | null;
};

export type VariantInput = {
  /** An existing size's id; omitted for a new size. */
  id?: string;
  size_milli: number;
  unit: string;
  price_cents: number;
  stock: number;
  barcode: string | null;
};

export type ProductInput = {
  name: string;
  category: string;
  photo_uri: string | null;
  /** Omitted means no second photo. */
  photo2_uri?: string | null;
  variants: VariantInput[];
};

export type CartItem = SellableVariant & { quantity: number };

export type Sale = {
  id: string;
  total_cents: number;
  /** Cash handed over; null for sales recorded before cash was captured. */
  tendered_cents: number | null;
  change_cents: number | null;
  created_at: string;
  item_count: number;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  variant_id: string;
  product_name: string;
  variant_label: string;
  category: string;
  barcode: string | null;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

export type Dashboard = {
  product_count: number;
  unit_count: number;
  out_of_stock: number;
  today_total: number;
  today_sales: number;
};

/** Where a stored view came from: a product photo, a legacy guided capture, or a till correction. */
export type EmbeddingSource = "photo" | "teach" | "correction";

export type EmbeddingInput = {
  productId: string;
  modelVersion: string;
  /** L2-normalised. */
  vector: Float32Array;
  source: EmbeddingSource;
  /** The product photo or saved crop the vector was computed from. */
  imageUri: string | null;
};

/** A stored view whose model version is outdated and whose image can be re-embedded. */
export type StaleEmbedding = {
  id: string;
  product_id: string;
  source: EmbeddingSource;
  image_uri: string;
};
