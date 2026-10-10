import { listSales } from '@/db/repositories/sales';
import type { Sale } from '@/db/schema';
import { useAuth } from '@/features/auth/useAuth';
import { useLiveRead } from '@/features/data/useLiveRead';
import { attempt } from '@/lib/attempt';
import { formatCents } from '@/lib/money';

export interface SaleRow {
  id: string;
  totalLabel: string;
  createdAtLabel: string;
}

function toRow(s: Sale): SaleRow {
  return {
    id: s.id,
    totalLabel: formatCents(s.totalCents),
    createdAtLabel: new Date(s.createdAt).toLocaleString(),
  };
}

export interface SalesView {
  sales: SaleRow[];
  error: string | null;
}

const PAGE_SIZE = 50;

function read(shopId: string | null): SalesView {
  if (!shopId) return { sales: [], error: 'Not signed in' };
  // TODO(feature): keyset pagination (listSales `before`) and daily totals.
  const result = attempt(() => listSales(shopId, { limit: PAGE_SIZE }));
  return result.ok
    ? { sales: result.value.map(toRow), error: null }
    : { sales: [], error: result.error.message };
}

/** The latest sales, refreshed when a sale is recorded or pulled. */
export function useSales(): SalesView {
  const { state } = useAuth();
  const shopId = state.status === 'signed_in' ? state.session.shopId : null;
  return useLiveRead(['sales'], read, shopId);
}
