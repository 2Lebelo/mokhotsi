export type Product = {
  id: string;
  name: string;
  category: string;
  photo_uri: string | null;
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
  variants: VariantInput[];
};

export type CartItem = SellableVariant & { quantity: number };

export type Sale = {
  id: string;
  total_cents: number;
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
