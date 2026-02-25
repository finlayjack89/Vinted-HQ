/**
 * Inventory Vault — CRUD helpers for inventory_master, inventory_sync, and vinted_ontology.
 * All functions operate synchronously via better-sqlite3.
 */

import { getDb } from './db';
import type Database from 'better-sqlite3';

// ─── Types (mirror global.d.ts for internal use) ───

export interface InventoryMasterRow {
  id: number;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  category_id: number | null;
  brand_id: number | null;
  brand_name: string | null;
  size_id: number | null;
  size_label: string | null;
  condition: string | null;
  status_id: number | null;
  color_ids: string | null;          // JSON
  photo_urls: string | null;         // JSON
  local_image_paths: string | null;  // JSON
  package_size_id: number | null;
  item_attributes: string | null;    // JSON
  is_unisex: number;
  status: string;
  extra_metadata: string | null;     // JSON
  list_fingerprint: string | null;
  detail_hydrated_at: number | null;
  detail_source: string | null;
  discrepancy_reason: string | null;
  isbn: string | null;
  measurement_length: number | null;
  measurement_width: number | null;
  model_metadata: string | null;     // JSON: { collection_id, model_id }
  manufacturer: string | null;
  manufacturer_labelling: string | null;
  video_game_rating_id: number | null;
  shipment_prices: string | null;    // JSON: { domestic, international }
  live_snapshot_hash: string | null;
  live_snapshot_fetched_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface InventorySyncRow {
  id: number;
  local_id: number;
  vinted_item_id: number | null;
  relist_count: number;
  last_synced_at: number | null;
  last_relist_at: number | null;
  sync_direction: string | null;
  created_at: number;
}

export interface InventoryItemJoined extends InventoryMasterRow {
  vinted_item_id: number | null;
  relist_count: number;
  last_synced_at: number | null;
  last_relist_at: number | null;
  sync_direction: string | null;
}

export interface OntologyRow {
  id: number;
  entity_type: string;
  entity_id: number;
  name: string;
  slug: string | null;
  parent_id: number | null;
  extra: string | null;  // JSON
  fetched_at: number;
}

// ─── Helpers ───

function db(): Database.Database {
  const d = getDb();
  if (!d) throw new Error('Database not initialized — call initDb() first');
  return d;
}

/**
 * Parse JSON string fields from a raw SQLite row into proper JS arrays/objects.
 * SQLite stores these as TEXT; the renderer expects parsed values.
 */
function parseJsonFields<T extends Partial<InventoryMasterRow>>(row: T): T {
  const r = { ...row };
  const jsonStringFields: (keyof InventoryMasterRow)[] = [
    'color_ids',
    'photo_urls',
    'local_image_paths',
    'item_attributes',
    'extra_metadata',
    'model_metadata',
    'shipment_prices',
  ];
  for (const key of jsonStringFields) {
    const val = (r as Record<string, unknown>)[key];
    if (typeof val === 'string') {
      try {
        (r as Record<string, unknown>)[key] = JSON.parse(val);
      } catch {
        // leave as-is if malformed JSON
      }
    } else if (val === null || val === undefined) {
      // For array-type fields, default to empty array so the renderer doesn't need null checks
      if (key === 'color_ids' || key === 'photo_urls' || key === 'local_image_paths' || key === 'item_attributes') {
        (r as Record<string, unknown>)[key] = [];
      }
    }
  }
  return r;
}

// ─── Inventory Master + Sync ───

const JOIN_QUERY = `
  SELECT m.*, s.vinted_item_id, COALESCE(s.relist_count, 0) AS relist_count,
         s.last_synced_at, s.last_relist_at, s.sync_direction
  FROM inventory_master m
  LEFT JOIN inventory_sync s ON s.local_id = m.id
`;

/**
 * Get all inventory items, optionally filtered by status.
 */
export function getAllInventoryItems(filter?: { status?: string }): InventoryItemJoined[] {
  let rows: InventoryItemJoined[];
  if (filter?.status) {
    rows = db()
      .prepare(`${JOIN_QUERY} WHERE m.status = ? ORDER BY m.updated_at DESC`)
      .all(filter.status) as InventoryItemJoined[];
  } else {
    rows = db()
      .prepare(`${JOIN_QUERY} ORDER BY m.updated_at DESC`)
      .all() as InventoryItemJoined[];
  }
  return rows.map(parseJsonFields);
}

/**
 * Get a single inventory item by local ID.
 */
export function getInventoryItem(localId: number): InventoryItemJoined | undefined {
  const row = db()
    .prepare(`${JOIN_QUERY} WHERE m.id = ?`)
    .get(localId) as InventoryItemJoined | undefined;
  return row ? parseJsonFields(row) : undefined;
}

/**
 * Get inventory items linked to a specific Vinted item ID.
 */
export function getInventoryItemByVintedId(vintedItemId: number): InventoryItemJoined | undefined {
  const row = db()
    .prepare(`${JOIN_QUERY} WHERE s.vinted_item_id = ?`)
    .get(vintedItemId) as InventoryItemJoined | undefined;
  return row ? parseJsonFields(row) : undefined;
}

/**
 * Insert or update an inventory master record.
 * If `data.id` is provided and exists, updates. Otherwise inserts.
 * Returns the local ID.
 */
export function upsertInventoryItem(data: Partial<InventoryMasterRow> & { title: string; price: number }): number {
  const d = db();

  if (data.id) {
    const existing = d.prepare('SELECT id FROM inventory_master WHERE id = ?').get(data.id);
    if (existing) {
      d.prepare(`
        UPDATE inventory_master SET
          title = COALESCE(?, title),
          description = COALESCE(?, description),
          price = COALESCE(?, price),
          currency = COALESCE(?, currency),
          category_id = COALESCE(?, category_id),
          brand_id = COALESCE(?, brand_id),
          brand_name = COALESCE(?, brand_name),
          size_id = COALESCE(?, size_id),
          size_label = COALESCE(?, size_label),
          condition = COALESCE(?, condition),
          status_id = COALESCE(?, status_id),
          color_ids = COALESCE(?, color_ids),
          photo_urls = COALESCE(?, photo_urls),
          local_image_paths = COALESCE(?, local_image_paths),
          package_size_id = COALESCE(?, package_size_id),
          item_attributes = COALESCE(?, item_attributes),
          is_unisex = COALESCE(?, is_unisex),
          status = COALESCE(?, status),
          extra_metadata = COALESCE(?, extra_metadata),
          list_fingerprint = COALESCE(?, list_fingerprint),
          detail_hydrated_at = COALESCE(?, detail_hydrated_at),
          detail_source = COALESCE(?, detail_source),
          discrepancy_reason = COALESCE(?, discrepancy_reason),
          isbn = COALESCE(?, isbn),
          measurement_length = COALESCE(?, measurement_length),
          measurement_width = COALESCE(?, measurement_width),
          model_metadata = COALESCE(?, model_metadata),
          manufacturer = COALESCE(?, manufacturer),
          manufacturer_labelling = COALESCE(?, manufacturer_labelling),
          video_game_rating_id = COALESCE(?, video_game_rating_id),
          shipment_prices = COALESCE(?, shipment_prices),
          live_snapshot_hash = COALESCE(?, live_snapshot_hash),
          live_snapshot_fetched_at = COALESCE(?, live_snapshot_fetched_at),
          updated_at = unixepoch()
        WHERE id = ?
      `).run(
        data.title, data.description ?? null, data.price, data.currency ?? 'GBP',
        data.category_id ?? null, data.brand_id ?? null, data.brand_name ?? null,
        data.size_id ?? null, data.size_label ?? null, data.condition ?? null,
        data.status_id ?? null,
        data.color_ids ?? null, data.photo_urls ?? null, data.local_image_paths ?? null,
        data.package_size_id ?? null, data.item_attributes ?? null,
        data.is_unisex ?? null, data.status ?? null, data.extra_metadata ?? null,
        data.list_fingerprint ?? null,
        data.detail_hydrated_at ?? null,
        data.detail_source ?? null,
        data.discrepancy_reason ?? null,
        data.isbn ?? null,
        data.measurement_length ?? null,
        data.measurement_width ?? null,
        data.model_metadata ?? null,
        data.manufacturer ?? null,
        data.manufacturer_labelling ?? null,
        data.video_game_rating_id ?? null,
        data.shipment_prices ?? null,
        (data as Partial<InventoryMasterRow>).live_snapshot_hash ?? null,
        (data as Partial<InventoryMasterRow>).live_snapshot_fetched_at ?? null,
        data.id
      );
      return data.id;
    }
  }

  const result = d.prepare(`
    INSERT INTO inventory_master (
      title, description, price, currency, category_id, brand_id, brand_name,
      size_id, size_label, condition, status_id, color_ids, photo_urls, local_image_paths,
      package_size_id, item_attributes, is_unisex, status, extra_metadata,
      list_fingerprint, detail_hydrated_at, detail_source, discrepancy_reason,
      isbn, measurement_length, measurement_width, model_metadata,
      manufacturer, manufacturer_labelling, video_game_rating_id, shipment_prices,
      live_snapshot_hash, live_snapshot_fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.title, data.description ?? null, data.price, data.currency ?? 'GBP',
    data.category_id ?? null, data.brand_id ?? null, data.brand_name ?? null,
    data.size_id ?? null, data.size_label ?? null, data.condition ?? null,
    data.status_id ?? null,
    data.color_ids ?? null, data.photo_urls ?? null, data.local_image_paths ?? null,
    data.package_size_id ?? null, data.item_attributes ?? null,
    data.is_unisex ?? 0, data.status ?? 'local_only', data.extra_metadata ?? null,
    data.list_fingerprint ?? null,
    data.detail_hydrated_at ?? null,
    data.detail_source ?? null,
    data.discrepancy_reason ?? null,
    data.isbn ?? null,
    data.measurement_length ?? null,
    data.measurement_width ?? null,
    data.model_metadata ?? null,
    data.manufacturer ?? null,
    data.manufacturer_labelling ?? null,
    data.video_game_rating_id ?? null,
    data.shipment_prices ?? null,
    (data as Partial<InventoryMasterRow>).live_snapshot_hash ?? null,
    (data as Partial<InventoryMasterRow>).live_snapshot_fetched_at ?? null
  );

  return Number(result.lastInsertRowid);
}

const JSON_TEXT_COLUMNS = new Set<keyof InventoryMasterRow>([
  'color_ids',
  'photo_urls',
  'local_image_paths',
  'item_attributes',
  'extra_metadata',
  'model_metadata',
  'shipment_prices',
]);

function normalizeValueForDb(key: keyof InventoryMasterRow, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (JSON_TEXT_COLUMNS.has(key)) {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return value;
}

/**
 * Insert or update an inventory master record using explicit assignment.
 * - Only fields present on `data` are updated (undefined => no-op)
 * - `null` values are treated as an explicit clear
 *
 * This is intentionally different from upsertInventoryItem(), which uses
 * COALESCE to avoid overwriting existing values with null during sync.
 */
export function upsertInventoryItemExplicit(data: Partial<InventoryMasterRow> & { title: string; price: number }): number {
  const d = db();
  const hasOwn = (k: keyof InventoryMasterRow) => Object.prototype.hasOwnProperty.call(data, k);

  if (data.id) {
    const existing = d.prepare('SELECT id FROM inventory_master WHERE id = ?').get(data.id);
    if (existing) {
      const updateable: (keyof InventoryMasterRow)[] = [
        'title',
        'description',
        'price',
        'currency',
        'category_id',
        'brand_id',
        'brand_name',
        'size_id',
        'size_label',
        'condition',
        'status_id',
        'color_ids',
        'photo_urls',
        'local_image_paths',
        'package_size_id',
        'item_attributes',
        'is_unisex',
        'status',
        'extra_metadata',
        'list_fingerprint',
        'detail_hydrated_at',
        'detail_source',
        'discrepancy_reason',
        'isbn',
        'measurement_length',
        'measurement_width',
        'model_metadata',
        'manufacturer',
        'manufacturer_labelling',
        'video_game_rating_id',
        'shipment_prices',
        'live_snapshot_hash',
        'live_snapshot_fetched_at',
      ];

      const sets: string[] = [];
      const values: unknown[] = [];
      for (const key of updateable) {
        if (!hasOwn(key)) continue;
        const raw = (data as Record<string, unknown>)[key];
        if (raw === undefined) continue; // absent update
        sets.push(`${String(key)} = ?`);
        values.push(normalizeValueForDb(key, raw));
      }

      if (sets.length > 0) {
        const sql = `UPDATE inventory_master SET ${sets.join(', ')}, updated_at = unixepoch() WHERE id = ?`;
        d.prepare(sql).run(...values, data.id);
      } else {
        // Still bump updated_at so user actions count as local edits.
        d.prepare('UPDATE inventory_master SET updated_at = unixepoch() WHERE id = ?').run(data.id);
      }

      return data.id;
    }
  }

  // Insert (explicit assignment; includes all known columns).
  const result = d.prepare(`
    INSERT INTO inventory_master (
      title, description, price, currency, category_id, brand_id, brand_name,
      size_id, size_label, condition, status_id, color_ids, photo_urls, local_image_paths,
      package_size_id, item_attributes, is_unisex, status, extra_metadata,
      list_fingerprint, detail_hydrated_at, detail_source, discrepancy_reason,
      isbn, measurement_length, measurement_width, model_metadata,
      manufacturer, manufacturer_labelling, video_game_rating_id, shipment_prices,
      live_snapshot_hash, live_snapshot_fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.title,
    normalizeValueForDb('description', data.description ?? null),
    data.price,
    data.currency ?? 'GBP',
    data.category_id ?? null,
    data.brand_id ?? null,
    data.brand_name ?? null,
    data.size_id ?? null,
    data.size_label ?? null,
    data.condition ?? null,
    data.status_id ?? null,
    normalizeValueForDb('color_ids', data.color_ids ?? null),
    normalizeValueForDb('photo_urls', data.photo_urls ?? null),
    normalizeValueForDb('local_image_paths', data.local_image_paths ?? null),
    data.package_size_id ?? null,
    normalizeValueForDb('item_attributes', data.item_attributes ?? null),
    data.is_unisex ?? 0,
    data.status ?? 'local_only',
    normalizeValueForDb('extra_metadata', data.extra_metadata ?? null),
    data.list_fingerprint ?? null,
    data.detail_hydrated_at ?? null,
    data.detail_source ?? null,
    data.discrepancy_reason ?? null,
    data.isbn ?? null,
    data.measurement_length ?? null,
    data.measurement_width ?? null,
    normalizeValueForDb('model_metadata', data.model_metadata ?? null),
    data.manufacturer ?? null,
    data.manufacturer_labelling ?? null,
    data.video_game_rating_id ?? null,
    normalizeValueForDb('shipment_prices', data.shipment_prices ?? null),
    data.live_snapshot_hash ?? null,
    data.live_snapshot_fetched_at ?? null,
  );

  return Number(result.lastInsertRowid);
}

/**
 * Update only the local_image_paths field without touching other columns.
 */
export function updateLocalImagePaths(localId: number, pathsJson: string): void {
  db().prepare('UPDATE inventory_master SET local_image_paths = ?, updated_at = unixepoch() WHERE id = ?')
    .run(pathsJson, localId);
}

/**
 * Update only the persisted live snapshot metadata for an item.
 * This is intentionally narrow so sync can record external changes without
 * overwriting the user's local edits.
 */
export function updateLiveSnapshot(localId: number, hash: string, fetchedAt: number): void {
  db().prepare(`
    UPDATE inventory_master
    SET live_snapshot_hash = ?, live_snapshot_fetched_at = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(hash, fetchedAt, localId);
}

/**
 * Update only the status field of an inventory item.
 */
export function setInventoryStatus(localId: number, status: string): void {
  db().prepare('UPDATE inventory_master SET status = ?, updated_at = unixepoch() WHERE id = ?')
    .run(status, localId);
}

/**
 * Delete an inventory master record (cascades to sync via FK).
 */
export function deleteInventoryItem(localId: number): boolean {
  const result = db().prepare('DELETE FROM inventory_master WHERE id = ?').run(localId);
  return result.changes > 0;
}

// ─── Inventory Sync ───

/**
 * Create or update the sync record linking a local item to a Vinted item ID.
 */
export function upsertSyncRecord(localId: number, vintedItemId: number | null, direction?: string): void {
  db().prepare(`
    INSERT INTO inventory_sync (local_id, vinted_item_id, sync_direction, last_synced_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(local_id) DO UPDATE SET
      vinted_item_id = excluded.vinted_item_id,
      sync_direction = excluded.sync_direction,
      last_synced_at = unixepoch()
  `).run(localId, vintedItemId, direction ?? null);
}

/**
 * Increment the relist count and update the last_relist_at timestamp.
 */
export function incrementRelistCount(localId: number): void {
  db().prepare(`
    UPDATE inventory_sync
    SET relist_count = relist_count + 1, last_relist_at = unixepoch()
    WHERE local_id = ?
  `).run(localId);
}

/**
 * Get the current relist count for an item.
 */
export function getRelistCount(localId: number): number {
  const row = db().prepare('SELECT relist_count FROM inventory_sync WHERE local_id = ?').get(localId) as { relist_count: number } | undefined;
  return row?.relist_count ?? 0;
}

// ─── Ontology Cache ───

/**
 * Get all ontology entities of a given type.
 */
export function getOntologyEntities(entityType: string): OntologyRow[] {
  return db()
    .prepare('SELECT * FROM vinted_ontology WHERE entity_type = ? ORDER BY name')
    .all(entityType) as OntologyRow[];
}

/**
 * Get a single ontology entity by type and ID.
 */
export function getOntologyEntity(entityType: string, entityId: number): OntologyRow | undefined {
  return db()
    .prepare('SELECT * FROM vinted_ontology WHERE entity_type = ? AND entity_id = ?')
    .get(entityType, entityId) as OntologyRow | undefined;
}

/**
 * Bulk upsert ontology entities. Replaces existing entries for the same type+entity_id.
 */
export function upsertOntologyBatch(
  entityType: string,
  entities: { entity_id: number; name: string; slug?: string; parent_id?: number; extra?: string }[]
): void {
  const d = db();
  const stmt = d.prepare(`
    INSERT INTO vinted_ontology (entity_type, entity_id, name, slug, parent_id, extra, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      name = excluded.name,
      slug = excluded.slug,
      parent_id = excluded.parent_id,
      -- Preserve existing extra when caller doesn't provide one.
      extra = COALESCE(excluded.extra, vinted_ontology.extra),
      fetched_at = unixepoch()
  `);

  const insertMany = d.transaction((items: typeof entities) => {
    for (const e of items) {
      stmt.run(entityType, e.entity_id, e.name, e.slug ?? null, e.parent_id ?? null, e.extra ?? null);
    }
  });

  insertMany(entities);
}

/**
 * Clear all cached ontology entities of a given type.
 */
export function clearOntologyType(entityType: string): void {
  db().prepare('DELETE FROM vinted_ontology WHERE entity_type = ?').run(entityType);
}

/**
 * Get all inventory items using a specific category ID.
 */
export function getItemsUsingCategory(categoryId: number): InventoryItemJoined[] {
  return db()
    .prepare(`${JOIN_QUERY} WHERE m.category_id = ?`)
    .all(categoryId) as InventoryItemJoined[];
}

/**
 * Bulk update category_id across all inventory_master records.
 * Used when ontology diffing detects a category ID change.
 */
export function updateCategoryIdBulk(oldCategoryId: number, newCategoryId: number): number {
  const result = db().prepare(
    'UPDATE inventory_master SET category_id = ?, updated_at = unixepoch() WHERE category_id = ?'
  ).run(newCategoryId, oldCategoryId);
  return result.changes;
}

/**
 * Bulk update brand_id across all inventory_master records.
 */
export function updateBrandIdBulk(oldBrandId: number, newBrandId: number): number {
  const result = db().prepare(
    'UPDATE inventory_master SET brand_id = ?, updated_at = unixepoch() WHERE brand_id = ?'
  ).run(newBrandId, oldBrandId);
  return result.changes;
}

/**
 * Merge a JSON patch into an ontology entity's `extra` column.
 * This is used for derived metadata (e.g. category requires_size) that should
 * survive normal ontology refreshes.
 */
export function mergeOntologyExtra(entityType: string, entityId: number, patch: Record<string, unknown>): void {
  const row = getOntologyEntity(entityType, entityId);
  if (!row) return;

  let base: Record<string, unknown> = {};
  if (row.extra && typeof row.extra === 'string') {
    try {
      const parsed = JSON.parse(row.extra) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore malformed extra */
    }
  }

  const next = { ...base, ...patch };
  db().prepare('UPDATE vinted_ontology SET extra = ? WHERE entity_type = ? AND entity_id = ?')
    .run(JSON.stringify(next), entityType, entityId);
}

/**
 * Determine if a category requires a size selection.
 *
 * Returns:
 * - true/false when we have cached knowledge in the category tree
 * - null when unknown (callers may fetch size_groups to resolve and cache)
 */
export function categoryRequiresSize(catalogId: number): boolean | null {
  let cur: number | null = catalogId;
  let hops = 0;
  while (cur && hops < 30) {
    hops++;
    const row = getOntologyEntity('category', cur);
    if (!row) return null;
    if (row.extra && typeof row.extra === 'string') {
      try {
        const parsed = JSON.parse(row.extra) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          if (typeof obj.requires_size === 'boolean') return obj.requires_size;
        }
      } catch {
        /* ignore */
      }
    }
    cur = row.parent_id ?? null;
  }
  return null;
}
