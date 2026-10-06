import { useCallback, useState } from 'react';

import type { MatchMethod } from '@/contracts/sync';
import type { Product } from '@/db/schema';
import { notImplemented } from '@/lib/errors';
import { formatCents, type Cents } from '@/lib/money';

export interface CartLine {
  product: Product;
  qty: number;
  matchScore: number | null;
  matchMethod: MatchMethod;
}

export interface Checkout {
  lines: CartLine[];
  totalCents: Cents;
  totalLabel: string;
  addProduct(product: Product, matchMethod: MatchMethod, matchScore: number | null): void;
  removeLine(productId: string): void;
  /** Writes the sale + outbox row locally (never waits for the network). */
  completeSale(): void;
}

/** Cart state for the sell screen. */
export function useCheckout(): Checkout {
  const [lines] = useState<CartLine[]>([]);

  const addProduct = useCallback((product: Product, matchMethod: MatchMethod, matchScore: number | null) => {
    // TODO(feature): merge into lines (qty + 1 if already present) using integer cents.
    notImplemented(`checkout.addProduct (${product.id}, ${matchMethod}, ${matchScore})`);
  }, []);

  const removeLine = useCallback((productId: string) => {
    // TODO(feature): remove the line for productId.
    notImplemented(`checkout.removeLine (${productId})`);
  }, []);

  const completeSale = useCallback(() => {
    // TODO(feature): sales.recordSale({ shopId, deviceId, lines }) → clear cart → sync.request('after_sale').
    notImplemented('checkout.completeSale');
  }, []);

  return { lines, totalCents: 0, totalLabel: formatCents(0), addProduct, removeLine, completeSale };
}
