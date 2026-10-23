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
  /** What the shop paid per unit; null when not set. */
  cost_cents: number | null;
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
  /** Omitted or null means no cost price is recorded. */
  cost_cents?: number | null;
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
  /** Cash given back through reversals; 0 when none. */
  refunded_cents: number;
  /** Units returned through reversals; 0 when none. */
  reversed_count: number;
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
  /** Cost per unit at the time of sale; null when it was not set. */
  unit_cost_cents: number | null;
  /** Units of this line already reversed. */
  reversed_quantity: number;
  /** Whether the size is still sold, so returns can go back on the shelf. */
  variant_active: number;
};

/** A refund against a sale: when, why, and how much cash went back. */
export type SaleReversal = {
  id: string;
  sale_id: string;
  reason: string;
  refund_cents: number;
  created_at: string;
};

/** One receipt line to reverse: how many units, and whether they go back to stock. */
export type ReversalLineInput = {
  saleItemId: string;
  quantity: number;
  restock: boolean;
};

export type PeriodKind = "today" | "week" | "month" | "quarter";

export type PeriodSummary = {
  /** Takings before refunds. */
  gross_cents: number;
  refunds_cents: number;
  net_cents: number;
  sale_count: number;
  /** Profit on units kept by customers whose cost is known, less write-offs. */
  profit_cents: number;
  /** Net revenue of the units profit is measured on, for the margin. */
  costed_revenue_cents: number;
  /** Units sold whose size had no cost price; left out of profit. */
  uncosted_units: number;
  /** Cost of returned units that were not put back in stock. */
  writeoff_cents: number;
  previous_net_cents: number;
  previous_profit_cents: number;
};

/** How one size sold over a period. */
export type ProductPerformance = {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_label: string;
  photo_uri: string | null;
  /** Units kept by customers (sold less reversed). */
  units: number;
  net_cents: number;
  /** Null when no sold unit had a cost price. */
  profit_cents: number | null;
  uncosted_units: number;
  writeoff_cents: number;
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
