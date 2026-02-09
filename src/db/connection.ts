import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('db');

let db: Database | null = null;
let dbPath: string;

export async function initDatabase(path: string): Promise<Database> {
  dbPath = resolve(path);
  const dir = dirname(dbPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
    log.info({ path: dbPath }, 'Database loaded from disk');
  } else {
    db = new SQL.Database();
    log.info({ path: dbPath }, 'New database created');
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  return db;
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
  log.debug('Database saved to disk');
}

export function closeDatabase(): void {
  if (!db) return;
  saveDatabase();
  db.close();
  db = null;
  log.info('Database closed');
}
