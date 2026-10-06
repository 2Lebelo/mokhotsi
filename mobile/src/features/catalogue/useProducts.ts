import { useMemo } from 'react';

import { listProducts } from '@/db/repositories/products';
import type { Product } from '@/db/schema';
import { useAuth } from '@/features/auth/useAuth';
import { attempt } from '@/lib/attempt';
import { formatCents } from '@/lib/money';

export interface ProductRow {
  id: string;
  name: string;
  priceLabel: string;
  barcode: string | null;
}

function toRow(p: Product): ProductRow {
  return { id: p.id, name: p.name, priceLabel: formatCents(p.priceCents), barcode: p.barcode };
}

export interface ProductsView {
  products: ProductRow[];
  /** Set while the repository is still a stub, or on a read error. */
  error: string | null;
}

export function useProducts(): ProductsView {
  const { state } = useAuth();
  const shopId = state.status === 'signed_in' ? state.session.shopId : null;
  return useMemo<ProductsView>(() => {
    if (!shopId) return { products: [], error: 'Not signed in' };
    // TODO(feature): refresh when products change (e.g. drizzle useLiveQuery + enableChangeListener).
    const result = attempt(() => listProducts(shopId));
    return result.ok
      ? { products: result.value.map(toRow), error: null }
      : { products: [], error: result.error.message };
  }, [shopId]);
}
