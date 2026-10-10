import { count, eq, inArray } from 'drizzle-orm';

import type { PullChanges } from '@/contracts/sync';
import { base64ToFloat32 } from '@/lib/base64';
import { newId, type Uuid } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { isoToMs } from '@/lib/time';
import { db, type Tx } from '@/db/client';
import { notifyChanged } from '@/db/changes';
import { embeddings, outbox, productImages, products, saleItems, sales, syncState } from '@/db/schema';

import { pendingEntityIds } from './outbox';

const log = createLogger('db.sync');

/** Keys stored in the sync_state table. */
export type SyncStateKey = 'device_id' | 'shop_id' | 'pull_cursor' | 'last_push_at' | 'last_pull_at';

export function getSyncValue(key: SyncStateKey): string | undefined {
  return db.select({ value: syncState.value }).from(syncState).where(eq(syncState.key, key)).get()?.value;
}

function setIn(tx: Tx | typeof db, key: SyncStateKey, value: string): void {
  tx.insert(syncState)
    .values({ key, value })
    .onConflictDoUpdate({ target: syncState.key, set: { value } })
    .run();
}

export function setSyncValue(key: SyncStateKey, value: string): void {
  setIn(db, key, value);
  notifyChanged('sync_state');
}

/** This install's stable id, created on first use (sent with sign-in and every push). */
export function getOrCreateDeviceId(): Uuid {
  const existing = getSyncValue('device_id');
  if (existing) return existing;
  const id = newId();
  setSyncValue('device_id', id);
  return id;
}

export class UnsyncedChangesError extends Error {
  constructor(readonly pending: number) {
    super(`${pending} change(s) on this phone are not backed up yet. Sync them before switching shop.`);
    this.name = 'UnsyncedChangesError';
  }
}

/**
 * Forget the local copy of a shop (used when signing in to a different shop). Refuses while
 * the outbox holds anything, so unsynced sales are never thrown away — unless
 * `discardUnsynced` is set, which only the __DEV__ bypass data (never synced) may use.
 * Keeps device_id and metrics.
 */
export function resetLocalData(options: { discardUnsynced?: boolean } = {}): void {
  db.transaction((tx) => {
    const pending = tx.select({ n: count() }).from(outbox).get()?.n ?? 0;
    if (pending > 0 && !options.discardUnsynced) throw new UnsyncedChangesError(pending);
    tx.delete(outbox).run();
    tx.delete(saleItems).run();
    tx.delete(sales).run();
    tx.delete(embeddings).run();
    tx.delete(productImages).run();
    tx.delete(products).run();
    tx.delete(syncState)
      .where(inArray(syncState.key, ['shop_id', 'pull_cursor', 'last_push_at', 'last_pull_at']))
      .run();
  });
  notifyChanged('products', 'embeddings', 'product_images', 'sales', 'outbox', 'sync_state');
}

export interface AppliedPage {
  applied: number;
  /** Skipped because a local change is waiting to be pushed, or the referenced product is missing. */
  skipped: number;
}

/**
 * Apply one pulled page AND store its cursor in a single transaction, so a crash can never
 * advance the cursor without the data (or vice versa). Remote changes never create outbox rows.
 *
 * - A record whose id has a pending outbox op is skipped: the local change wins until it is
 *   pushed, after which a later pull brings back the server's view.
 * - Products are upserted by id (soft deletes included); embeddings are inserted or, when
 *   `deleted`, removed locally; sales are insert-only.
 */
export function applyPulledPage(shopId: Uuid, changes: PullChanges, nextCursor: string): AppliedPage {
  let applied = 0;
  let skipped = 0;
  db.transaction((tx) => {
    const pendingProducts = pendingEntityIds(
      tx,
      'products',
      changes.products.map((p) => p.id),
    );
    for (const p of changes.products) {
      if (pendingProducts.has(p.id)) {
        skipped++;
        continue;
      }
      const row = {
        id: p.id,
        shopId,
        name: p.name,
        priceCents: p.price_cents,
        barcode: p.barcode,
        updatedAt: isoToMs(p.updated_at),
        deleted: p.deleted,
      };
      tx.insert(products)
        .values(row)
        .onConflictDoUpdate({
          target: products.id,
          set: {
            name: row.name,
            priceCents: row.priceCents,
            barcode: row.barcode,
            updatedAt: row.updatedAt,
            deleted: row.deleted,
          },
        })
        .run();
      applied++;
    }

    const pendingEmbeddings = pendingEntityIds(
      tx,
      'embeddings',
      changes.embeddings.map((e) => e.id),
    );
    for (const e of changes.embeddings) {
      if (pendingEmbeddings.has(e.id)) {
        skipped++;
        continue;
      }
      if (e.deleted) {
        tx.delete(embeddings).where(eq(embeddings.id, e.id)).run();
        applied++;
        continue;
      }
      if (!productExists(tx, e.product_id)) {
        log.warn('pulled embedding skipped: product missing locally', { id: e.id, productId: e.product_id });
        skipped++;
        continue;
      }
      tx.insert(embeddings)
        .values({
          id: e.id,
          productId: e.product_id,
          vector: base64ToFloat32(e.vector_b64),
          dim: e.dim,
          modelVersion: e.model_version,
          createdAt: isoToMs(e.created_at),
        })
        .onConflictDoNothing()
        .run();
      applied++;
    }

    const pendingSales = pendingEntityIds(
      tx,
      'sales',
      changes.sales.map((s) => s.id),
    );
    for (const s of changes.sales) {
      if (pendingSales.has(s.id) || saleExists(tx, s.id)) {
        skipped++;
        continue;
      }
      const missing = s.items.find((i) => !productExists(tx, i.product_id));
      if (missing) {
        log.warn('pulled sale skipped: product missing locally', { id: s.id, productId: missing.product_id });
        skipped++;
        continue;
      }
      tx.insert(sales)
        .values({
          id: s.id,
          shopId,
          totalCents: s.total_cents,
          createdAt: isoToMs(s.created_at),
          deviceId: s.device_id,
        })
        .run();
      tx.insert(saleItems)
        .values(
          s.items.map((i) => ({
            id: i.id,
            saleId: s.id,
            productId: i.product_id,
            qty: i.qty,
            unitPriceCents: i.unit_price_cents,
            matchScore: i.match_score,
            matchMethod: i.match_method,
          })),
        )
        .run();
      applied++;
    }

    // Last, so the cursor only moves once everything above succeeded.
    setIn(tx, 'pull_cursor', nextCursor);
    setIn(tx, 'last_pull_at', String(Date.now()));
  });
  notifyChanged('products', 'embeddings', 'sales', 'sync_state');
  return { applied, skipped };
}

function productExists(tx: Tx, id: Uuid): boolean {
  return tx.select({ id: products.id }).from(products).where(eq(products.id, id)).get() !== undefined;
}

function saleExists(tx: Tx, id: Uuid): boolean {
  return tx.select({ id: sales.id }).from(sales).where(eq(sales.id, id)).get() !== undefined;
}
