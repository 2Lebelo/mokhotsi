/**
 * An in-memory SQLite database for repository tests, built from the same drizzle migrations
 * the app bundles. Node's built-in `node:sqlite` is synchronous like expo-sqlite, and drizzle's
 * node-sqlite and expo drivers share the same sync query API, so repositories run unchanged.
 *
 * Use from a test file:
 *   jest.mock('@/db/client', () => require('./support/testDb').mockClientModule());
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/node-sqlite';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle');
const TABLES = [
  'sale_items',
  'sales',
  'embeddings',
  'product_images',
  'products',
  'outbox',
  'sync_state',
  'metrics',
];

export function createTestDb() {
  const client = new DatabaseSync(':memory:');
  client.exec('PRAGMA foreign_keys = ON;');
  const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) client.exec(statement);
    }
  }
  return { client, db: drizzle({ client }) };
}

/** The shape of `src/db/client.ts`, backed by an in-memory database. */
export function mockClientModule() {
  const { client, db } = createTestDb();
  return { DATABASE_NAME: ':memory:', db, __client: client };
}

/** Empty every table between tests (child tables first, for the foreign keys). */
export function resetTables(client: DatabaseSync): void {
  for (const table of TABLES) client.exec(`DELETE FROM ${table};`);
}
