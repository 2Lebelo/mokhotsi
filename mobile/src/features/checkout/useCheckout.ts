import { useCallback, useMemo, useState } from 'react';

import type { MatchMethod } from '@/contracts/sync';
import { recordSale } from '@/db/repositories/sales';
import { getOrCreateDeviceId } from '@/db/repositories/syncState';
import type { Product } from '@/db/schema';
import { useAuth } from '@/features/auth/useAuth';
import { useSync } from '@/features/sync/useSync';
import { formatCents, sumCents, type Cents } from '@/lib/money';

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
  /** Error from the last completeSale attempt. */
  error: string | null;
  addProduct(product: Product, matchMethod: MatchMethod, matchScore: number | null): void;
  removeLine(productId: string): void;
  /** Writes the sale + outbox row locally (never waits for the network). True on success. */
  completeSale(): boolean;
}

/** Merge a product into the cart: one line per product, qty + 1 when it is already there. */
export function addToCart(
  lines: readonly CartLine[],
  product: Product,
  matchMethod: MatchMethod,
  matchScore: number | null,
): CartLine[] {
  const existing = lines.find((l) => l.product.id === product.id);
  if (!existing) return [...lines, { product, qty: 1, matchMethod, matchScore }];
  return lines.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
}

/** Cart state for the sell screen. */
export function useCheckout(): Checkout {
  const { state } = useAuth();
  const sync = useSync();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const shopId = state.status === 'signed_in' ? state.session.shopId : null;

  const totalCents = useMemo(() => sumCents(lines.map((l) => l.qty * l.product.priceCents)), [lines]);

  const addProduct = useCallback((product: Product, matchMethod: MatchMethod, matchScore: number | null) => {
    setError(null);
    setLines((current) => addToCart(current, product, matchMethod, matchScore));
  }, []);

  const removeLine = useCallback((productId: string) => {
    setLines((current) => current.filter((l) => l.product.id !== productId));
  }, []);

  const completeSale = useCallback((): boolean => {
    if (!shopId || lines.length === 0) return false;
    try {
      recordSale({
        shopId,
        deviceId: getOrCreateDeviceId(),
        lines: lines.map((l) => ({
          productId: l.product.id,
          qty: l.qty,
          unitPriceCents: l.product.priceCents,
          matchScore: l.matchScore,
          matchMethod: l.matchMethod,
        })),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
    setLines([]);
    setError(null);
    sync.request('after_sale');
    return true;
  }, [shopId, lines, sync]);

  return {
    lines,
    totalCents,
    totalLabel: formatCents(totalCents),
    error,
    addProduct,
    removeLine,
    completeSale,
  };
}
