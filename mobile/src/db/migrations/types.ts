import type { SQLiteDatabase } from "expo-sqlite";

export type Migration = {
  /** The `user_version` the database has once this step is applied. */
  version: number;
  name: string;
  /** Runs inside a transaction with foreign keys off; never change a shipped step. */
  up: (db: SQLiteDatabase) => void;
};
