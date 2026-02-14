/**
 * Ontology Service — fetches, caches, and diffs Vinted's category/brand/color taxonomy.
 *
 * On app startup: fetches latest ontology from bridge, compares to local SQLite cache.
 * If a category ID changed but name+slug match, bulk-updates inventory_master references.
 * If a category used by an item is deleted, sets status to 'action_required' and alerts the renderer.
 */

import { BrowserWindow } from 'electron';
import * as bridge from './bridge';
import * as inventoryDb from './inventoryDb';
import { logger } from './logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OntologyDiffResult {
  type: string;
  migrated: { oldId: number; newId: number; name: string }[];
  deleted: { entityId: number; name: string; affectedItems: number }[];
  added: number;
  updated: number;
  total: number;
}

// ─── Ontology Refresh ───────────────────────────────────────────────────────

/**
 * Fetch and cache the category tree from Vinted.
 * Returns the diff result showing what changed.
 */
export async function refreshCategories(): Promise<OntologyDiffResult | null> {
  const result = await bridge.fetchOntologyCategories();
  if (!result.ok) {
    logger.warn('ontology-fetch-failed', { type: 'category', error: (result as { message?: string }).message });
    return null;
  }

  const remoteData = (result as { data: unknown }).data as { catalogs?: unknown[] } | unknown;
  let remoteCatalogs: { id: number; title: string; code?: string; url?: string; catalogs?: unknown[] }[] = [];

  // Vinted returns nested catalogs — flatten them
  if (remoteData && typeof remoteData === 'object' && 'catalogs' in (remoteData as Record<string, unknown>)) {
    remoteCatalogs = flattenCatalogs((remoteData as { catalogs: unknown[] }).catalogs);
  } else if (Array.isArray(remoteData)) {
    remoteCatalogs = flattenCatalogs(remoteData);
  }

  if (remoteCatalogs.length === 0) {
    logger.warn('ontology-empty', { type: 'category' });
    return null;
  }

  // Diff against local cache
  const diff = diffAndUpdate('category', remoteCatalogs);

  logger.info('ontology-refreshed', {
    type: 'category',
    total: remoteCatalogs.length,
    migrated: diff.migrated.length,
    deleted: diff.deleted.length,
  });

  return diff;
}

/**
 * Fetch and cache brands from Vinted (optionally filtered by category).
 */
export async function refreshBrands(categoryId?: number): Promise<OntologyDiffResult | null> {
  const result = await bridge.fetchOntologyBrands(categoryId);
  if (!result.ok) {
    logger.warn('ontology-fetch-failed', { type: 'brand', error: (result as { message?: string }).message });
    return null;
  }

  const remoteData = (result as { data: unknown }).data;
  let remoteBrands: { id: number; title: string; slug?: string }[] = [];

  if (remoteData && typeof remoteData === 'object' && 'brands' in (remoteData as Record<string, unknown>)) {
    remoteBrands = ((remoteData as { brands: unknown[] }).brands || []).map((b: unknown) => {
      const brand = b as Record<string, unknown>;
      return { id: Number(brand.id), title: String(brand.title || brand.name || ''), slug: brand.slug as string | undefined };
    });
  }

  if (remoteBrands.length === 0) return null;

  const entities = remoteBrands.map((b) => ({
    entity_id: b.id,
    name: b.title,
    slug: b.slug,
  }));

  inventoryDb.upsertOntologyBatch('brand', entities);

  return {
    type: 'brand',
    migrated: [],
    deleted: [],
    added: entities.length,
    updated: entities.length,
    total: entities.length,
  };
}

/**
 * Fetch and cache colors from Vinted.
 */
export async function refreshColors(): Promise<void> {
  const result = await bridge.fetchOntologyColors();
  if (!result.ok) return;

  const remoteData = (result as { data: unknown }).data;
  let remoteColors: { id: number; title: string; hex?: string }[] = [];

  if (remoteData && typeof remoteData === 'object' && 'colors' in (remoteData as Record<string, unknown>)) {
    remoteColors = ((remoteData as { colors: unknown[] }).colors || []).map((c: unknown) => {
      const color = c as Record<string, unknown>;
      return { id: Number(color.id), title: String(color.title || ''), hex: color.hex as string | undefined };
    });
  }

  if (remoteColors.length === 0) return;

  const entities = remoteColors.map((c) => ({
    entity_id: c.id,
    name: c.title,
    extra: c.hex ? JSON.stringify({ hex: c.hex }) : undefined,
  }));

  inventoryDb.upsertOntologyBatch('color', entities);
  logger.info('ontology-refreshed', { type: 'color', total: remoteColors.length });
}

// ─── Full Ontology Refresh (Startup) ────────────────────────────────────────

/**
 * Run full ontology refresh. Called on startup (non-blocking).
 * Fetches categories, brands, and colors. Diffs categories against local cache.
 * If categories changed and items are affected, sends alert to renderer.
 */
export async function refreshAll(): Promise<void> {
  try {
    const catDiff = await refreshCategories();

    // Fire off brands and colors in parallel (non-critical)
    await Promise.allSettled([
      refreshBrands(),
      refreshColors(),
    ]);

    // If category changes affected inventory items, alert the renderer
    if (catDiff && catDiff.deleted.length > 0) {
      const affectedItems = catDiff.deleted.flatMap((d) => {
        const items = inventoryDb.getItemsUsingCategory(d.entityId);
        return items.map((i) => ({ localId: i.id, title: i.title, oldCategory: d.name }));
      });

      if (affectedItems.length > 0) {
        notifyOntologyAlert(catDiff.deleted, affectedItems);
      }
    }
  } catch (err) {
    logger.error('ontology-refresh-error', { error: String(err) });
  }
}

// ─── Internal: Diff & Update ────────────────────────────────────────────────

function flattenCatalogs(catalogs: unknown[], parentId?: number): { id: number; title: string; code?: string; url?: string; parentId?: number }[] {
  const result: { id: number; title: string; code?: string; url?: string; parentId?: number }[] = [];
  if (!Array.isArray(catalogs)) return result;

  for (const cat of catalogs) {
    const c = cat as Record<string, unknown>;
    const id = Number(c.id);
    const title = String(c.title || c.name || '');
    const code = c.code as string | undefined;
    const url = c.url as string | undefined;

    result.push({ id, title, code, url, parentId });

    if (c.catalogs && Array.isArray(c.catalogs)) {
      result.push(...flattenCatalogs(c.catalogs, id));
    }
  }

  return result;
}

function diffAndUpdate(
  entityType: string,
  remoteEntities: { id: number; title: string; code?: string; url?: string; parentId?: number }[]
): OntologyDiffResult {
  const local = inventoryDb.getOntologyEntities(entityType);
  const migrated: OntologyDiffResult['migrated'] = [];
  const deleted: OntologyDiffResult['deleted'] = [];

  // Build lookup maps
  const localByNameSlug = new Map<string, typeof local[0]>();
  const localById = new Map<number, typeof local[0]>();
  for (const entity of local) {
    const key = `${entity.name.toLowerCase()}|${(entity.slug || '').toLowerCase()}`;
    localByNameSlug.set(key, entity);
    localById.set(entity.entity_id, entity);
  }

  const remoteById = new Map<number, typeof remoteEntities[0]>();
  const remoteByName = new Map<string, typeof remoteEntities[0]>();
  for (const entity of remoteEntities) {
    remoteById.set(entity.id, entity);
    const key = `${entity.title.toLowerCase()}|${(entity.code || entity.url || '').toLowerCase()}`;
    remoteByName.set(key, entity);
  }

  // Detect ID changes: same name+slug exists in remote but with different ID
  for (const localEntity of local) {
    const key = `${localEntity.name.toLowerCase()}|${(localEntity.slug || '').toLowerCase()}`;
    const remoteMatch = remoteByName.get(key);

    if (remoteMatch && remoteMatch.id !== localEntity.entity_id) {
      // Category ID changed but name stayed the same → migrate
      if (entityType === 'category') {
        const count = inventoryDb.updateCategoryIdBulk(localEntity.entity_id, remoteMatch.id);
        if (count > 0) {
          migrated.push({ oldId: localEntity.entity_id, newId: remoteMatch.id, name: localEntity.name });
          logger.info('ontology-migrated', {
            type: entityType,
            oldId: localEntity.entity_id,
            newId: remoteMatch.id,
            name: localEntity.name,
            itemsUpdated: count,
          });
        }
      } else if (entityType === 'brand') {
        inventoryDb.updateBrandIdBulk(localEntity.entity_id, remoteMatch.id);
      }
    }
  }

  // Detect deletions: local entity_id not present in remote at all,
  // AND no name match found (truly deleted, not just renamed)
  for (const localEntity of local) {
    if (!remoteById.has(localEntity.entity_id)) {
      const key = `${localEntity.name.toLowerCase()}|${(localEntity.slug || '').toLowerCase()}`;
      if (!remoteByName.has(key)) {
        const affectedItems = inventoryDb.getItemsUsingCategory(localEntity.entity_id);
        if (affectedItems.length > 0) {
          deleted.push({
            entityId: localEntity.entity_id,
            name: localEntity.name,
            affectedItems: affectedItems.length,
          });
          // Mark affected items as needing attention
          for (const item of affectedItems) {
            inventoryDb.setInventoryStatus(item.id, 'action_required');
          }
        }
      }
    }
  }

  // Upsert all remote entities into local cache
  const entities = remoteEntities.map((e) => ({
    entity_id: e.id,
    name: e.title,
    slug: e.code || e.url,
    parent_id: e.parentId,
  }));
  inventoryDb.upsertOntologyBatch(entityType, entities);

  return {
    type: entityType,
    migrated,
    deleted,
    added: remoteEntities.length - local.length,
    updated: remoteEntities.length,
    total: remoteEntities.length,
  };
}

// ─── Renderer Notification ──────────────────────────────────────────────────

function notifyOntologyAlert(
  deletedCategories: OntologyDiffResult['deleted'],
  affectedItems: { localId: number; title: string; oldCategory: string }[]
): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('wardrobe:ontology-alert', {
      deletedCategories,
      affectedItems,
    });
  }
}
