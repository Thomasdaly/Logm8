import * as SQLite from 'expo-sqlite';
import type { SqlDb } from '../lib/eventStore';

/** expo-sqlite adapter for the event store (local-first, works offline). */
export async function openExpoDb(name = 'logm8.db'): Promise<SqlDb> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => {
      await db.runAsync(sql, [...params]);
    },
    all: <T,>(sql: string, params: ReadonlyArray<string | number | null>) => db.getAllAsync<T>(sql, [...params]),
  };
}
