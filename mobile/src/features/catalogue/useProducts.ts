import { useCallback } from 'react';

import { listProducts, upsertProduct } from '@/db/repositories/products';
import type { Product } from '@/db/schema';
import { useAuth } from '@/features/auth/useAuth';
import { useLiveRead } from '@/features/data/useLiveRead';
import { useSync } from '@/features/sync/useSync';
import { attempt } from '@/lib/attempt';
import { formatCents, parseToCents } from '@/lib/money';

export interface ProductRow {
  id: string;
  name: string;
  priceLabel: string;
  barcode: string | null;
  product: Product;
}

function toRow(p: Product): ProductRow {
  return { id: p.id, name: p.name, priceLabel: formatCents(p.priceCents), barcode: p.barcode, product: p };
}

export interface NewProductInput {
  name: string;
  /** As typed, e.g. "12.50" or "M12.50". */
  price: string;
  barcode?: string;
}

export interface ProductsView {
  products: ProductRow[];
  /** Set on a read error. */
  error: string | null;
  /** Saves locally (and queues it for sync); returns an error message or null. */
  createProduct(input: NewProductInput): string | null;
}

function read(shopId: string | null): Pick<ProductsView, 'products' | 'error'> {
  if (!shopId) return { products: [], error: 'Not signed in' };
  const result = attempt(() => listProducts(shopId));
  return result.ok
    ? { products: result.value.map(toRow), error: null }
    : { products: [], error: result.error.message };
}

export function useProducts(): ProductsView {
  const { state } = useAuth();
  const sync = useSync();
  const shopId = state.status === 'signed_in' ? state.session.shopId : null;
  const view = useLiveRead(['products'], read, shopId);

  const createProduct = useCallback(
    (input: NewProductInput): string | null => {
      if (!shopId) return 'Not signed in';
      const name = input.name.trim();
      if (!name) return 'Enter a product name.';
      const priceCents = parseToCents(input.price);
      if (priceCents === null) return 'Enter a price like 12.50.';
      const result = attempt(() =>
        upsertProduct({ shopId, name, priceCents, barcode: input.barcode?.trim() || null }),
      );
      if (!result.ok) return result.error.message;
      sync.request('manual');
      return null;
    },
    [shopId, sync],
  );

  return { ...view, createProduct };
}
