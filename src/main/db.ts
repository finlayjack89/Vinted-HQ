/**
 * SQLite database — schema and migrations (better-sqlite3)
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';

const DB_NAME = 'vinted.db';
let db: Database.Database | null = null;

export function initDb(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, DB_NAME);
  db = new Database(dbPath);
  migrate(db);
  return db;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS search_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS snipers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price_max REAL,
      keywords TEXT,
      condition TEXT,
      budget_limit REAL DEFAULT 0,
      enabled INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT,
      request_id TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      order_id INTEGER,
      amount REAL,
      status TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
  `);
}

export function getDb(): Database.Database | null {
  return db;
}

export function closeDb(): void {
  // better-sqlite3 persists to file automatically; no explicit persist needed
  if (db) {
    db.close();
    db = null;
  }
}
