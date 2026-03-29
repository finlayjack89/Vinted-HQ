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
    CREATE TABLE IF NOT EXISTS sniper_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sniper_id INTEGER NOT NULL,
      sniper_name TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      title TEXT,
      price TEXT,
      photo_url TEXT,
      url TEXT,
      simulated INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_sniper_hits_created ON sniper_hits(created_at);

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
      collection_id INTEGER,
      model_id INTEGER,
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

    -- Photo lineage tracker for relist image mutation pipeline
    CREATE TABLE IF NOT EXISTS inventory_photos (
      internal_photo_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      vinted_photo_id TEXT,
      generation INTEGER DEFAULT 0,
      original_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inv_photos_item ON inventory_photos(item_id);

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

    -- Persisted relist queue (survives app restarts)
    CREATE TABLE IF NOT EXISTS relist_queue (
      local_id INTEGER PRIMARY KEY,
      status TEXT DEFAULT 'pending',        -- pending|mutating|uploading|done|error|interrupted
      error TEXT,
      enqueued_at INTEGER DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER
    );

    -- Locally cached sold orders (enriched from conversation API)
    CREATE TABLE IF NOT EXISTS sold_orders (
      transaction_id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      item_id INTEGER,
      title TEXT NOT NULL,
      price_amount TEXT,
      price_currency TEXT DEFAULT 'GBP',
      status TEXT,
      transaction_user_status TEXT,
      date TEXT,
      buyer_username TEXT,
      buyer_id INTEGER,
      photo_url TEXT,
      photo_thumbnails TEXT,
      listing_price REAL,
      listed_at INTEGER,
      originally_listed_at INTEGER,
      enriched_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_sold_orders_status ON sold_orders(transaction_user_status);
    CREATE INDEX IF NOT EXISTS idx_sold_orders_item ON sold_orders(item_id);

    -- Bought orders (purchases) — local persistence + enrichment cache
    CREATE TABLE IF NOT EXISTS bought_orders (
      transaction_id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      item_id INTEGER,
      price_amount TEXT,
      price_currency TEXT DEFAULT 'GBP',
      status TEXT,
      transaction_user_status TEXT,
      date TEXT,
      photo_url TEXT,
      seller_username TEXT,
      listing_price REAL,
      enriched_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_bought_orders_status ON bought_orders(transaction_user_status);
    CREATE INDEX IF NOT EXISTS idx_bought_orders_item ON bought_orders(item_id);

    -- Auto-Message CRM: per-item rules for auto-responding to "like" notifications
    CREATE TABLE IF NOT EXISTS auto_message_configs (
      item_id TEXT PRIMARY KEY,
      message_text TEXT,
      offer_price REAL,
      delay_minutes INTEGER DEFAULT 5,
      send_offer_first INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    -- Auto-Message CRM: dedup + audit log of dispatched messages/offers
    CREATE TABLE IF NOT EXISTS auto_message_logs (
      notification_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      action_type TEXT DEFAULT 'message',
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      timestamp INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_aml_item ON auto_message_logs(item_id);
    CREATE INDEX IF NOT EXISTS idx_aml_status ON auto_message_logs(status);

    -- Auto-Message CRM: reusable preset messages
    CREATE TABLE IF NOT EXISTS auto_message_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Auto-Message CRM: users to never auto-message
    CREATE TABLE IF NOT EXISTS crm_ignored_users (
      username TEXT PRIMARY KEY,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Item Intelligence: completed analysis reports
    CREATE TABLE IF NOT EXISTS intelligence_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id INTEGER,                     -- FK to inventory_master (nullable for feed items)
      vinted_item_id INTEGER,               -- Vinted item ID
      mode TEXT NOT NULL,                    -- 'auth_only', 'market_only', 'full'
      report_json TEXT NOT NULL,             -- Full IntelligenceReport as JSON
      verdict TEXT,                          -- Auth verdict string (for quick filtering)
      confidence REAL,                       -- Top-level confidence (for quick filtering)
      listing_title TEXT,
      listing_price REAL,
      duration_seconds REAL,
      cost_usd REAL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_intel_reports_local ON intelligence_reports(local_id);
    CREATE INDEX IF NOT EXISTS idx_intel_reports_vinted ON intelligence_reports(vinted_item_id);
    CREATE INDEX IF NOT EXISTS idx_intel_reports_created ON intelligence_reports(created_at);

    -- Item Intelligence: encrypted API key storage
    CREATE TABLE IF NOT EXISTS intelligence_api_keys (
      key_name TEXT PRIMARY KEY,             -- 'gemini', 'anthropic', 'perplexity', 'serpapi'
      encrypted_value TEXT NOT NULL,         -- Base64-encoded safeStorage encrypted blob
      updated_at INTEGER DEFAULT (unixepoch())
    );
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
  // Sync/cache metadata
  addIfMissing('list_fingerprint', 'TEXT');
  addIfMissing('detail_hydrated_at', 'INTEGER');
  addIfMissing('detail_source', 'TEXT');
  addIfMissing('discrepancy_reason', 'TEXT');
  addIfMissing('isbn', 'TEXT');
  addIfMissing('measurement_length', 'REAL');
  addIfMissing('measurement_width', 'REAL');
  addIfMissing('model_metadata', 'TEXT'); // JSON: { collection_id, model_id }
  addIfMissing('collection_id', 'INTEGER');
  addIfMissing('model_id', 'INTEGER');
  addIfMissing('manufacturer', 'TEXT');
  addIfMissing('manufacturer_labelling', 'TEXT');
  addIfMissing('video_game_rating_id', 'INTEGER');
  addIfMissing('shipment_prices', 'TEXT'); // JSON: { domestic, international }
  addIfMissing('live_snapshot_hash', 'TEXT');
  addIfMissing('live_snapshot_fetched_at', 'INTEGER');
  // Wardrobe reconciliation: track when an item was last seen during a sync
  addIfMissing('last_seen_at', 'INTEGER');

  // Migration: auto_message_configs delay range (single delay_minutes → delay_min + delay_max)
  const amcCols = database.prepare("PRAGMA table_info(auto_message_configs)").all() as { name: string }[];
  if (!amcCols.some((c) => c.name === 'delay_min_minutes')) {
    database.prepare('ALTER TABLE auto_message_configs ADD COLUMN delay_min_minutes INTEGER DEFAULT 2').run();
    database.prepare('ALTER TABLE auto_message_configs ADD COLUMN delay_max_minutes INTEGER DEFAULT 10').run();
    // Seed from existing delay_minutes if present
    database.prepare('UPDATE auto_message_configs SET delay_min_minutes = delay_minutes, delay_max_minutes = delay_minutes WHERE delay_min_minutes = 2 AND delay_minutes != 2').run();
  }

  // One-shot migration: reset sold_orders enrichment so dates re-populate from
  // conversation API (previously used inventory_master.created_at which was
  // the local DB import date, not the actual Vinted listing date).
  // We use the presence of `date_fix_applied` column as the "already ran" marker.
  const soldCols = database.prepare("PRAGMA table_info(sold_orders)").all() as { name: string }[];
  if (soldCols.some((c) => c.name === 'enriched_at') && !soldCols.some((c) => c.name === 'date_fix_applied')) {
    database.prepare("ALTER TABLE sold_orders ADD COLUMN date_fix_applied INTEGER DEFAULT 0").run();
    database.prepare(
      "UPDATE sold_orders SET enriched_at = NULL, listed_at = NULL, originally_listed_at = NULL"
    ).run();
  }

  // Migration: add like_date and receiver_username to auto_message_logs
  const logCols = database.prepare("PRAGMA table_info(auto_message_logs)").all() as { name: string }[];
  if (!logCols.some((c) => c.name === 'like_date')) {
    database.prepare('ALTER TABLE auto_message_logs ADD COLUMN like_date INTEGER').run();
  }
  if (!logCols.some((c) => c.name === 'receiver_username')) {
    database.prepare('ALTER TABLE auto_message_logs ADD COLUMN receiver_username TEXT').run();
  }

  // One-shot migration: clear bought_orders table that was polluted with sold items
  // (bug: type param was briefly changed to order_type, causing sold items to be cached as bought)
  const boughtPurged = database.prepare("SELECT value FROM settings WHERE key = 'bought_orders_purged_v1'").get() as { value: string } | undefined;
  if (!boughtPurged) {
    database.prepare('DELETE FROM bought_orders').run();
    database.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('bought_orders_purged_v1', '1', unixepoch())").run();
  }

  // One-shot migration: clean $undefined RSC reference strings from numeric columns.
  // The Chrome extension's deep sync stored Next.js RSC "$undefined" literals as text
  // in integer columns (status_id, brand_id, etc.), breaking the relist pipeline.
  const rscCleaned = database.prepare("SELECT value FROM settings WHERE key = 'rsc_undefined_cleaned_v1'").get() as { value: string } | undefined;
  if (!rscCleaned) {
    const rscNumericCols = [
      'status_id', 'brand_id', 'size_id', 'category_id', 'package_size_id',
      'collection_id', 'model_id', 'video_game_rating_id',
    ];
    for (const col of rscNumericCols) {
      database.prepare(`UPDATE inventory_master SET ${col} = NULL WHERE typeof(${col}) = 'text' AND ${col} LIKE '$%'`).run();
    }
    // Also force re-sync for any affected items so next deep sync re-fetches valid data
    database.prepare("UPDATE inventory_master SET detail_hydrated_at = NULL WHERE detail_source = 'extension' AND status_id IS NULL").run();
    database.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('rsc_undefined_cleaned_v1', '1', unixepoch())").run();
  }
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
