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
      sniper_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);

    -- Inventory Vault: local "source of truth" for each listing
    CREATE TABLE IF NOT EXISTS inventory_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'GBP',
      category_id INTEGER,
      brand_id INTEGER,
      brand_name TEXT,
      size_id INTEGER,
      size_label TEXT,
      condition TEXT,
      status_id INTEGER,
      color_ids TEXT,              -- JSON array e.g. [1, 5]
      photo_urls TEXT,             -- JSON array of original Vinted CDN URLs
      local_image_paths TEXT,      -- JSON array of local cached file paths
      package_size_id INTEGER,
      item_attributes TEXT,        -- JSON array e.g. [{"code":"material","ids":[43]}]
      is_unisex INTEGER DEFAULT 0,
      status TEXT DEFAULT 'local_only',  -- 'live','local_only','discrepancy','action_required'
      extra_metadata TEXT,         -- JSON blob for any additional fields
      live_snapshot_hash TEXT,     -- sha256 over normalized live fields
      live_snapshot_fetched_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    -- Sync link between local master and Vinted item IDs
    CREATE TABLE IF NOT EXISTS inventory_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id INTEGER NOT NULL REFERENCES inventory_master(id) ON DELETE CASCADE,
      vinted_item_id INTEGER,       -- current live Vinted item ID (null if not listed)
      relist_count INTEGER DEFAULT 0,
      last_synced_at INTEGER,
      last_relist_at INTEGER,
      sync_direction TEXT,          -- 'push', 'pull', or null
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(local_id)
    );

    -- Local ontology cache for categories, brands, attributes
    CREATE TABLE IF NOT EXISTS vinted_ontology (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,    -- 'category','brand','color','condition','size_group'
      entity_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT,
      parent_id INTEGER,
      extra TEXT,                   -- JSON for entity-specific data
      fetched_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(entity_type, entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_master_status ON inventory_master(status);
    CREATE INDEX IF NOT EXISTS idx_inventory_sync_vinted_id ON inventory_sync(vinted_item_id);
    CREATE INDEX IF NOT EXISTS idx_ontology_type ON vinted_ontology(entity_type);
  `);
  // Migration: add sniper_id to purchases if missing
  const cols = database.prepare("PRAGMA table_info(purchases)").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'sniper_id')) {
    database.prepare('ALTER TABLE purchases ADD COLUMN sniper_id INTEGER').run();
  }

  // Migration: add niche listing fields to inventory_master
  const invCols = database.prepare("PRAGMA table_info(inventory_master)").all() as { name: string }[];
  const addIfMissing = (col: string, type: string) => {
    if (!invCols.some((c) => c.name === col)) {
      database.prepare(`ALTER TABLE inventory_master ADD COLUMN ${col} ${type}`).run();
    }
  };
  addIfMissing('isbn', 'TEXT');
  addIfMissing('measurement_length', 'REAL');
  addIfMissing('measurement_width', 'REAL');
  addIfMissing('model_metadata', 'TEXT'); // JSON: { collection_id, model_id }
  addIfMissing('manufacturer', 'TEXT');
  addIfMissing('manufacturer_labelling', 'TEXT');
  addIfMissing('video_game_rating_id', 'INTEGER');
  addIfMissing('shipment_prices', 'TEXT'); // JSON: { domestic, international }
  addIfMissing('live_snapshot_hash', 'TEXT');
  addIfMissing('live_snapshot_fetched_at', 'INTEGER');
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
