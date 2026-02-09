import initSqlJs, { type Database } from 'sql.js';
import { runMigrations } from '../db/migrations.js';

let db: Database | null = null;

/**
 * Creates a fresh in-memory database with all migrations applied.
 * Used in tests to avoid file I/O.
 */
export async function setupTestDb(): Promise<Database> {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function getTestDb(): Database {
  if (!db) throw new Error('Test DB not initialized. Call setupTestDb() first.');
  return db;
}

export function teardownTestDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
