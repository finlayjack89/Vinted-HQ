/**
 * Inventory Service — the core orchestrator for wardrobe sync and the stealth relist queue.
 *
 * Responsibilities:
 *   - Pull/Push sync between local Vault and Vinted wardrobe
 *   - In-memory "Waiting Room" relist queue with randomized bulk timing
 *   - Image caching to disk
 *   - Queue lifecycle (enqueue, dequeue, process, abort on shutdown)
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as bridge from './bridge';
import * as inventoryDb from './inventoryDb';
import * as proxyService from './proxyService';
import { logger } from './logger';
import * as settings from './settings';
import { buildLiveSnapshotFromItemData, buildLiveSnapshotFromVintedDetail, hashLiveSnapshot, hashLiveSnapshotV1Compatible } from './liveSnapshot';

import type { RelistQueueEntry } from '../types/global';

type DetailCompletenessResult = {
  ok: boolean;
  complete: boolean;
  missing: string[];
  category_id: number | null;
  requires_size: boolean;
  requires_size_known: boolean;
  detail_hydrated_at: number | null;
  detail_source: string | null;
};

/** Check if a value is a valid positive integer (guards against '$undefined' strings from RSC). */
function isPositiveInt(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  }
  return false;
}

function coerceNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? parsed.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function coerceUnknownArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function resolveCategoryRequiresSize(catalogId: number): Promise<{ requiresSize: boolean; known: boolean }> {
  const cached = inventoryDb.categoryRequiresSize(catalogId);
  if (typeof cached === 'boolean') return { requiresSize: cached, known: true };

  try {
    const r = await bridge.fetchOntologySizes(catalogId);
    if (r.ok) {
      const now = Math.floor(Date.now() / 1000);
      const data = (r as { ok: true; data: unknown }).data as unknown;
      const root = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const groups = Array.isArray(root.size_groups) ? (root.size_groups as unknown[]) : [];

      let requiresSize = false;
      for (const g of groups) {
        if (!g || typeof g !== 'object') continue;
        const sizes = (g as Record<string, unknown>).sizes;
        if (Array.isArray(sizes)) {
          if (sizes.length > 0) { requiresSize = true; break; }
        } else {
          requiresSize = true;
          break;
        }
      }

      inventoryDb.mergeOntologyExtra('category', catalogId, {
        requires_size: requiresSize,
        requires_size_fetched_at: now,
      });

      return { requiresSize, known: true };
    }

    // Some categories legitimately have no sizes and the endpoint may respond 404.
    // When that happens, treat it as "no size required" and cache the result so we
    // don't repeatedly fall back to the unsafe requiresSize=true default.
    const code = (r as { code?: string }).code ?? '';
    const message = (r as { message?: string }).message ?? '';
    const looksLikeNoSize404 =
      code === 'HTTP_ERROR' && (message.startsWith('HTTP 404:') || message.includes('HTTP 404'));
    if (looksLikeNoSize404) {
      const now = Math.floor(Date.now() / 1000);
      inventoryDb.mergeOntologyExtra('category', catalogId, {
        requires_size: false,
        requires_size_fetched_at: now,
      });
      logger.info('category-requires-size-cached-404', { catalogId }, undefined);
      return { requiresSize: false, known: true };
    }
  } catch (err) {
    logger.warn('category-requires-size-resolve-failed', { catalogId, error: String(err) });
  }

  // Safe fallback: treat unknown as requiring size so we don't omit a required field.
  return { requiresSize: true, known: false };
}

/**
 * Shared detail-completeness evaluator used by:
 * - sync logic (avoid repeated hydration loops)
 * - save validation (avoid sending known-invalid payloads)
 * - edit modal logic (decide when to fetch)
 */
export async function getDetailCompleteness(localId: number): Promise<DetailCompletenessResult> {
  const item = inventoryDb.getInventoryItem(localId);
  if (!item) {
    return { ok: false, complete: false, missing: ['item_not_found'], category_id: null, requires_size: true, requires_size_known: false, detail_hydrated_at: null, detail_source: null };
  }

  const categoryId = typeof item.category_id === 'number' ? item.category_id : null;
  const { requiresSize, known } = categoryId ? await resolveCategoryRequiresSize(categoryId) : { requiresSize: true, known: false };

  const missing: string[] = [];
  if (!isPositiveInt(item.category_id)) missing.push('category_id');
  if (!isPositiveInt(item.brand_id)) missing.push('brand_id');
  if (!isPositiveInt(item.status_id)) missing.push('status_id');
  if (requiresSize && !isPositiveInt(item.size_id)) missing.push('size_id');

  const desc = typeof item.description === 'string' ? item.description : '';
  if (!desc.trim()) missing.push('description');

  const colorIds = coerceNumberArray(item.color_ids);
  if (colorIds.length === 0) missing.push('color_ids');

  const pkg = typeof item.package_size_id === 'number' ? item.package_size_id : Number(item.package_size_id ?? 0);
  if (!Number.isFinite(pkg) || pkg <= 0) missing.push('package_size_id');

  return {
    ok: true,
    complete: missing.length === 0,
    missing,
    category_id: categoryId,
    requires_size: requiresSize,
    requires_size_known: known,
    detail_hydrated_at: (item as unknown as { detail_hydrated_at?: number | null }).detail_hydrated_at ?? null,
    detail_source: (item as unknown as { detail_source?: string | null }).detail_source ?? null,
  };
}

// ─── Image Cache Helpers ────────────────────────────────────────────────────

function imageCacheDir(): string {
  return path.join(app.getPath('userData'), 'image_cache');
}

function itemImageDir(localId: number): string {
  const dir = path.join(imageCacheDir(), String(localId));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function downloadAndCacheImage(url: string, localId: number, index: number): Promise<string> {
  const dir = itemImageDir(localId);
  const filePath = path.join(dir, `${index}.jpg`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuf));
    return filePath;
  } catch (err) {
    logger.warn('image-download-failed', { url, localId, index, error: String(err) });
    return '';
  }
}

function loadCachedImages(localId: number): Buffer[] {
  const dir = path.join(imageCacheDir(), String(localId));
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png') || f.endsWith('.webp'))
    .sort();

  return files.map((f) => fs.readFileSync(path.join(dir, f)));
}

// ─── Pull from Vinted ───────────────────────────────────────────────────────

const DETAIL_SKIP_TTL_SECONDS = 24 * 60 * 60; // 24h: skip repeated detail fetches within a day
// Vinted item pages are now client-rendered; the Python bridge HTML scrape
// no longer includes the core numeric IDs required for edit/save flows.
// Keep the bridge implementation for future API-based extraction, but
// default to browser-based extraction for correctness.
const USE_PYTHON_BRIDGE_ITEM_DETAIL = false;

function computeWardrobeListFingerprint(vintedItem: Record<string, unknown>): string {
  const priceObj = vintedItem.price as Record<string, unknown> | undefined;
  const price = parseFloat(String(priceObj?.amount ?? vintedItem.price ?? 0));
  const currency = String(priceObj?.currency_code ?? 'GBP');

  const photos = (vintedItem.photos as Record<string, unknown>[] | undefined) ?? [];
  const photoUrls = photos
    .map((p) => String(p.url || p.full_size_url || ''))
    .filter(Boolean);

  // Best-effort brand + size strings (wardrobe list typically includes them).
  let brandName = '';
  const brandField = vintedItem.brand_dto ?? vintedItem.brand;
  if (brandField && typeof brandField === 'object') {
    const brandObj = brandField as Record<string, unknown>;
    brandName = String(brandObj.title || brandObj.name || '');
  } else if (typeof brandField === 'string') {
    brandName = brandField;
  }
  if (!brandName && typeof vintedItem.brand_title === 'string') brandName = vintedItem.brand_title;
  if (!brandName && typeof vintedItem._dom_brand === 'string') brandName = vintedItem._dom_brand;

  let sizeLabel = '';
  if (typeof vintedItem.size_title === 'string') sizeLabel = vintedItem.size_title;
  if (!sizeLabel && vintedItem.size && typeof vintedItem.size === 'object') {
    const so = vintedItem.size as Record<string, unknown>;
    sizeLabel = String(so.title || so.name || '');
  } else if (!sizeLabel && typeof vintedItem.size === 'string') {
    sizeLabel = vintedItem.size;
  }
  if (!sizeLabel && vintedItem.size_dto && typeof vintedItem.size_dto === 'object') {
    const so = vintedItem.size_dto as Record<string, unknown>;
    sizeLabel = String(so.title || so.name || '');
  }
  if (!sizeLabel && typeof vintedItem._dom_size === 'string') sizeLabel = vintedItem._dom_size.trim();

  const payload = {
    id: Number(vintedItem.id || 0),
    title: String(vintedItem.title || '').trim(),
    price,
    currency,
    brand: brandName.trim(),
    size: sizeLabel.trim(),
    // Include status flags rather than volatile counters (views/favourites).
    is_draft: vintedItem.is_draft === true,
    is_hidden: vintedItem.is_hidden === true,
    is_closed: vintedItem.is_closed === true,
    is_reserved: vintedItem.is_reserved === true,
    photo_urls: photoUrls,
  };

  const json = JSON.stringify(payload);
  return crypto.createHash('sha256').update(json).digest('hex');
}

function isCompleteForEditCached(item: inventoryDb.InventoryItemJoined): boolean {
  const desc = typeof item.description === 'string' ? item.description : '';
  const colorIds = coerceNumberArray(item.color_ids);
  const pkg = typeof item.package_size_id === 'number' ? item.package_size_id : Number(item.package_size_id ?? 0);

  if (!isPositiveInt(item.category_id)) return false;
  if (!isPositiveInt(item.brand_id)) return false;
  if (!isPositiveInt(item.status_id)) return false;
  if (!desc.trim()) return false;
  if (colorIds.length === 0) return false;
  if (!Number.isFinite(pkg) || pkg <= 0) return false;

  const requiresSize = inventoryDb.categoryRequiresSize(Number(item.category_id));
  if (requiresSize === null) return false; // unknown => don't skip expensive detail fetch
  if (requiresSize && !isPositiveInt(item.size_id)) return false;

  return true;
}

function applyGapFillStructuralPatch(params: {
  existing: inventoryDb.InventoryItemJoined;
  itemDetail: Record<string, unknown>;
  snapshotFetchedAt: number;
  listFingerprint?: string;
  detailSource?: string;
}): void {
  const { existing, itemDetail, snapshotFetchedAt, listFingerprint, detailSource } = params;

  const d = itemDetail;
  const brandObj = (d.brand_dto ?? d.brand) as Record<string, unknown> | string | null;
  const brandDict = brandObj && typeof brandObj === 'object' ? (brandObj as Record<string, unknown>) : null;
  const catObj = (d.category ?? d.catalog) as Record<string, unknown> | undefined;
  const sizeObj = d.size && typeof d.size === 'object' ? (d.size as Record<string, unknown>) : null;
  const statusObj = d.status && typeof d.status === 'object' ? (d.status as Record<string, unknown>) : null;

  const resolvedBrandId = d.brand_id ? Number(d.brand_id) : (brandDict?.id ? Number(brandDict.id) : 0);
  const resolvedBrandName = d.brand_title ? String(d.brand_title)
    : (brandDict?.title ? String(brandDict.title)
      : (brandDict?.name ? String(brandDict.name)
        : (typeof brandObj === 'string' ? String(brandObj) : '')));
  const resolvedCatId = d.catalog_id ? Number(d.catalog_id)
    : (catObj && typeof catObj === 'object' && catObj.id ? Number(catObj.id) : 0);
  const resolvedSizeId = d.size_id ? Number(d.size_id) : (sizeObj?.id ? Number(sizeObj.id) : 0);
  const resolvedSizeLabel = d.size_title ? String(d.size_title)
    : (sizeObj?.title ? String(sizeObj.title)
      : (sizeObj?.name ? String(sizeObj.name) : ''));
  const resolvedStatusId = d.status_id ? Number(d.status_id) : (statusObj?.id ? Number(statusObj.id) : 0);

  let resolvedPkgId = d.package_size_id ? Number(d.package_size_id) : 0;
  if (!resolvedPkgId && d.package_size && typeof d.package_size === 'object') {
    const pkg = d.package_size as Record<string, unknown>;
    if (pkg.id) resolvedPkgId = Number(pkg.id);
  }

  const resolvedColorIds = Array.isArray(d.color_ids)
    ? (d.color_ids as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  const patch: Record<string, unknown> = { id: existing.id, title: existing.title, price: existing.price };
  let changed = false;

  // Structural ID gaps
  if (!existing.category_id && resolvedCatId > 0) { patch.category_id = resolvedCatId; changed = true; }
  if (!existing.brand_id && resolvedBrandId > 0) { patch.brand_id = resolvedBrandId; changed = true; }
  if (!existing.brand_name && resolvedBrandName) { patch.brand_name = resolvedBrandName; changed = true; }

  const requiresSize = (existing.category_id || resolvedCatId)
    ? inventoryDb.categoryRequiresSize(Number(existing.category_id || resolvedCatId))
    : null;
  // If requires_size is unknown, it's still safe to fill a real size_id (when present)
  // without overwriting an existing one.
  if (requiresSize !== false && !existing.size_id && resolvedSizeId > 0) { patch.size_id = resolvedSizeId; changed = true; }
  if (!existing.size_label && resolvedSizeLabel) { patch.size_label = resolvedSizeLabel; changed = true; }
  if (!existing.status_id && resolvedStatusId > 0) { patch.status_id = resolvedStatusId; changed = true; }
  if (!existing.package_size_id && resolvedPkgId > 0) { patch.package_size_id = resolvedPkgId; changed = true; }

  // JSON-ish fields (treat empty arrays as gaps)
  const existingColors = coerceNumberArray(existing.color_ids);
  if (existingColors.length === 0 && resolvedColorIds.length > 0) { patch.color_ids = JSON.stringify(resolvedColorIds); changed = true; }

  const existingAttrs = coerceUnknownArray(existing.item_attributes);
  if (existingAttrs.length === 0 && d.item_attributes && Array.isArray(d.item_attributes)) {
    patch.item_attributes = JSON.stringify(d.item_attributes);
    changed = true;
  }

  const existingDesc = typeof existing.description === 'string' ? existing.description : '';
  const liveDesc = typeof d.description === 'string' ? d.description : '';
  if (!existingDesc.trim() && liveDesc.trim()) { patch.description = liveDesc; changed = true; }

  // Cache metadata
  if ((!existing.detail_hydrated_at || existing.detail_hydrated_at <= 0) && snapshotFetchedAt > 0) {
    patch.detail_hydrated_at = snapshotFetchedAt;
    changed = true;
  }
  if (!existing.detail_source && detailSource) {
    patch.detail_source = detailSource;
    changed = true;
  }
  if (typeof listFingerprint === 'string' && listFingerprint && existing.list_fingerprint !== listFingerprint) {
    patch.list_fingerprint = listFingerprint;
    changed = true;
  }

  if (changed) {
    inventoryDb.upsertInventoryItem(patch as Parameters<typeof inventoryDb.upsertInventoryItem>[0]);
  }
}

/**
 * Pull all listings from Vinted wardrobe into the local Vault.
 * Downloads and caches images. Creates/updates inventory_master + inventory_sync.
 */
export async function pullFromVinted(userId: number): Promise<{
  pulled: number;
  errors: string[];
}> {
  const requestId = crypto.randomUUID();
  const startedAtMs = Date.now();
  const syncBatchTime = Math.floor(startedAtMs / 1000);
  const errors: string[] = [];
  let pulled = 0;
  let page = 1;
  let totalPages = 1;
  let syncCompletedSuccessfully = true;

  // Use any scraping proxy, ignoring cooldown (one-off operation, not polling)
  const proxy = proxyService.getAnyScrapingProxy();
  const transportMode = proxyService.getTransportMode();
  const browserProxyMode = settings.getSetting('browser_proxy_mode');
  const scrapingProxies = settings.getSetting('scrapingProxies');
  const legacyProxyUrls = settings.getSetting('proxyUrls');
  const scrapingProxyCount = Array.isArray(scrapingProxies) ? scrapingProxies.length : 0;
  const legacyProxyUrlCount = Array.isArray(legacyProxyUrls) ? legacyProxyUrls.length : 0;

  let proxyHost: string | null = null;
  let proxyPort: string | null = null;
  if (proxy) {
    try {
      const u = new URL(proxy);
      proxyHost = u.hostname || null;
      proxyPort = u.port || null;
    } catch {
      proxyHost = null;
      proxyPort = null;
    }
  }

  logger.info(
    'wardrobe-pull-start',
    {
      userId,
      transportMode,
      browser_proxy_mode: browserProxyMode,
      proxyHost,
      proxyPort,
      usingProxy: Boolean(proxy),
    },
    requestId,
  );

  emitSyncProgress('pull', 'starting', 0, 0);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  while (page <= totalPages) {
    const result = await bridge.fetchWardrobe(userId, page, 20, proxy);
    if (!result.ok) {
      errors.push(`Page ${page}: ${(result as { message?: string }).message}`);
      syncCompletedSuccessfully = false;
      break;
    }

    const data = (result as { data: unknown }).data as {
      items: Record<string, unknown>[];
      pagination: { total_pages: number; total_entries: number };
    };

    totalPages = data.pagination?.total_pages ?? 1;
    const totalEntries = data.pagination?.total_entries ?? 0;
    logger.debug('wardrobe-pull-page', { page, totalPages, totalEntries, itemCount: data.items.length }, requestId);

    for (const vintedItem of data.items) {
      const usedBrowserFallback = false;
      try {
        const vintedId = Number(vintedItem.id);
        const existing = inventoryDb.getInventoryItemByVintedId(vintedId);
        const snapshotFetchedAt = Math.floor(Date.now() / 1000);
        const listFingerprint = computeWardrobeListFingerprint(vintedItem);

        // Ensure the item exists locally so we have a stable localId for caching, etc.
        // For existing items with a stored snapshot, we avoid overwriting local fields
        // until we've compared the live snapshot hash.
        const localId = existing ? existing.id : upsertFromVintedItem(vintedItem, { source: 'wardrobe_list', list_fingerprint: listFingerprint, syncBatchTime });

        // Sold items (closed + not draft) cannot be edited or relisted.
        // Skip the expensive detail extraction, but still ensure the local status reflects "sold".
        const isSoldItem = vintedItem.is_closed === true && vintedItem.is_draft !== true;
        if (isSoldItem) {
          emitSyncProgress(
            'pull',
            'progress',
            pulled,
            totalEntries,
            `Sold — skipping details (${pulled + 1}/${totalEntries}) — ${vintedId}`,
          );

          // Only upsert list data when transitioning into sold (avoids bumping updated_at every sync).
          if (existing && existing.status !== 'sold') {
            upsertFromVintedItem(vintedItem, { source: 'wardrobe_list', list_fingerprint: listFingerprint, syncBatchTime });
          } else {
            // Still update the sync record timestamp (does not touch inventory_master.updated_at).
            inventoryDb.upsertSyncRecord(localId, vintedId, 'pull');
            inventoryDb.touchLastSeenAt(localId, syncBatchTime);
          }

          // Ensure images exist at least once for UI performance.
          const hasCachedImages = existing && Array.isArray(existing.local_image_paths) && existing.local_image_paths.length > 0;
          if (existing && !hasCachedImages) {
            const photos = (vintedItem.photos as Record<string, unknown>[] | undefined) ?? [];
            const photoUrls = photos.map((p) => String(p.url || p.full_size_url || '')).filter(Boolean);
            const localPaths: string[] = [];
            for (let i = 0; i < photoUrls.length; i++) {
              const cached = await downloadAndCacheImage(photoUrls[i], localId, i);
              if (cached) localPaths.push(cached);
            }
            if (localPaths.length > 0) {
              inventoryDb.updateLocalImagePaths(localId, JSON.stringify(localPaths));
            }
          }

          pulled++;
          emitSyncProgress('pull', 'progress', pulled, totalEntries);
          continue;
        }

        // If the item is already marked discrepancy, do not overwrite local fields during sync.
        // We still update snapshot metadata when possible so the user can see if live changed.
        const isDiscrepancy = existing?.status === 'discrepancy';

        // Incremental sync fast-path: if the wardrobe list fingerprint is unchanged AND we have a
        // recent, complete cached detail record, skip expensive detail extraction entirely.
        if (existing && !isDiscrepancy && existing.list_fingerprint === listFingerprint) {
          const hydratedAt = existing.detail_hydrated_at ?? null;
          const isFresh = typeof hydratedAt === 'number' && hydratedAt > 0 && snapshotFetchedAt - hydratedAt < DETAIL_SKIP_TTL_SECONDS;

          if (isFresh && isCompleteForEditCached(existing)) {
            emitSyncProgress(
              'pull',
              'progress',
              pulled,
              totalEntries,
              `Up to date (${pulled + 1}/${totalEntries}) — ${vintedId}`
            );

            // Still update the sync record timestamp (does not touch inventory_master.updated_at).
            inventoryDb.upsertSyncRecord(localId, vintedId, 'pull');
            inventoryDb.touchLastSeenAt(localId, syncBatchTime);

            // Ensure images exist at least once for UI performance.
            const hasCachedImages = Array.isArray(existing.local_image_paths) && existing.local_image_paths.length > 0;
            if (!hasCachedImages) {
              const photos = (vintedItem.photos as Record<string, unknown>[] | undefined) ?? [];
              const photoUrls = photos.map((p) => String(p.url || p.full_size_url || '')).filter(Boolean);
              const localPaths: string[] = [];
              for (let i = 0; i < photoUrls.length; i++) {
                const cached = await downloadAndCacheImage(photoUrls[i], localId, i);
                if (cached) localPaths.push(cached);
              }
              if (localPaths.length > 0) {
                inventoryDb.updateLocalImagePaths(localId, JSON.stringify(localPaths));
              }
            }

            logger.debug(
              'wardrobe-pull-skip-detail',
              {
                localId,
                vintedId,
                reason: 'fingerprint_fresh_complete',
                hydratedAt,
                cacheAgeSeconds: typeof hydratedAt === 'number' && hydratedAt > 0 ? snapshotFetchedAt - hydratedAt : null,
                listFingerprint,
              },
              requestId,
            );

            pulled++;
            emitSyncProgress('pull', 'progress', pulled, totalEntries);
            continue;
          }
        }

        emitSyncProgress(
          'pull',
          'progress',
          pulled,
          totalEntries,
          `Fetching details (${pulled + 1}/${totalEntries}) — ${vintedId}`
        );
        logger.debug(
          'wardrobe-pull-fetch-detail',
          { localId, vintedId, hadExisting: Boolean(existing), isDiscrepancy, listFingerprint },
          requestId,
        );

        // Second pass: fetch full item detail to compute a stable live snapshot hash
        // and (when safe) fill missing fields.
        // NOTE: No proxy — this endpoint is geo-sensitive (non-UK proxies → wrong domain)
        let itemDetail: Record<string, unknown> | null = null;
        let bridgeDetail: Record<string, unknown> | null = null;
        let liveHash: string | null = null;
        let liveHashV1: string | null = null;
        let bridgeFetchOk: boolean | null = null;
        let bridgeFetchCode: string | null = null;
        let bridgeDebugSummary: Record<string, unknown> | null = null;
        // Fast path: Python bridge HTML scrape (can be blocked by bot detection).
        if (USE_PYTHON_BRIDGE_ITEM_DETAIL) {
          try {
            const detailResult = await bridge.fetchItemDetail(vintedId);
            if (detailResult.ok) {
              const detailData = (detailResult as { data: unknown }).data as Record<string, unknown>;
              bridgeFetchOk = true;
              const dbg = (detailData as Record<string, unknown>)._debug;
              if (dbg && typeof dbg === 'object') {
                const d = dbg as Record<string, unknown>;
                const edit = d.edit_page as Record<string, unknown> | undefined;
                const view = d.view_page as Record<string, unknown> | undefined;
                bridgeDebugSummary = {
                  pagesTried: Array.isArray(d.pages_tried) ? d.pages_tried.slice(0, 6) : null,
                  editNuxtTags: typeof edit?.nuxt_tags === 'number' ? edit.nuxt_tags : null,
                  viewNuxtTags: typeof view?.nuxt_tags === 'number' ? view.nuxt_tags : null,
                  editHasError: typeof edit?.error === 'string' && edit.error.length > 0,
                  viewHasError: typeof view?.error === 'string' && view.error.length > 0,
                  editItemKeysLen: Array.isArray(edit?.item_keys) ? edit.item_keys.length : null,
                  viewItemKeysLen: Array.isArray(view?.item_keys) ? view.item_keys.length : null,
                };
              }
              bridgeDetail = (detailData.item ?? detailData) as Record<string, unknown>;
              itemDetail = bridgeDetail;
              logger.debug(
                'wardrobe-pull-bridge-detail-ok',
                { localId, vintedId, keyCount: Object.keys(bridgeDetail).length },
                requestId,
              );
            } else {
              bridgeFetchOk = false;
              const code = (detailResult as { code?: string }).code ?? '';
              const msg = (detailResult as { message?: string }).message ?? '';
              bridgeFetchCode = code || null;
              logger.warn('wardrobe-pull-bridge-detail-failed', { localId, vintedId, code, message: msg }, requestId);
            }
          } catch (err) {
            bridgeFetchOk = null;
            bridgeFetchCode = 'EXCEPTION';
            logger.warn('wardrobe-pull-bridge-detail-exception', { localId, vintedId, error: String(err) }, requestId);
          }
        }

        // If bridge returned present-but-incomplete data (missing core numeric IDs),
        // prefer browser extraction anyway.
        const bridgeCoreIds = (() => {
          if (!bridgeDetail) return { incomplete: false, brandId: 0, catalogId: 0, statusId: 0 };
          const d = bridgeDetail;
          const brandObj = (d.brand_dto ?? d.brand) as Record<string, unknown> | string | null;
          const brandDict = brandObj && typeof brandObj === 'object' ? (brandObj as Record<string, unknown>) : null;
          const catObj = (d.category ?? d.catalog) as Record<string, unknown> | undefined;
          const statusObj = d.status && typeof d.status === 'object' ? (d.status as Record<string, unknown>) : null;

          const brandId = d.brand_id ? Number(d.brand_id) : (brandDict?.id ? Number(brandDict.id) : 0);
          const catalogId = d.catalog_id ? Number(d.catalog_id)
            : (catObj && typeof catObj === 'object' && catObj.id ? Number(catObj.id) : 0);
          const statusId = d.status_id ? Number(d.status_id) : (statusObj?.id ? Number(statusObj.id) : 0);

          // These numeric IDs are required for a valid edit/save payload.
          const incomplete = !(brandId > 0 && catalogId > 0 && statusId > 0);
          return { incomplete, brandId, catalogId, statusId };
        })();
        const isBridgeIncomplete = bridgeCoreIds.incomplete;
        if (isBridgeIncomplete) {
          logger.info(
            'wardrobe-pull-bridge-incomplete',
            { localId, vintedId, brandId: bridgeCoreIds.brandId, catalogId: bridgeCoreIds.catalogId, statusId: bridgeCoreIds.statusId },
            requestId,
          );
        }

        // We no longer block the main sync loop with a slow browser extraction fallback.
        // If the bridge fails or is incomplete, we just log a warning and let the
        // post-sync backfill or the Edit modal handle the heavy extraction later.
        if (!itemDetail || isBridgeIncomplete) {
          logger.info(
            'wardrobe-pull-browser-fallback-skipped',
            {
              localId,
              vintedId,
              reason: !itemDetail ? 'bridge_missing' : 'bridge_incomplete',
              bridgeCoreIds: isBridgeIncomplete ? bridgeCoreIds : undefined,
            },
            requestId,
          );
          // If bridge was incomplete but we have some data, keep it so we can at least
          // update the snapshot hash.
          if (!itemDetail && bridgeDetail) itemDetail = bridgeDetail;
        }

        if (!itemDetail) {
          logger.warn('wardrobe-pull-item-detail-missing', { localId, vintedId }, requestId);
        }

        const effectiveDetailSource =
          itemDetail && bridgeDetail && itemDetail === bridgeDetail
            ? 'bridge'
            : (usedBrowserFallback ? 'browser' : 'bridge');

        if (itemDetail) {
          // Browser extraction should include `id`, but ensure it's set so upserts
          // always link to the right local record.
          const detailId = Number((itemDetail as Record<string, unknown>).id ?? 0);
          if (detailId <= 0) {
            (itemDetail as Record<string, unknown>).id = vintedId;
          }
        }

        if (itemDetail) {
          try {
            const snap = buildLiveSnapshotFromVintedDetail(itemDetail);
            liveHash = hashLiveSnapshot(snap);
            liveHashV1 = hashLiveSnapshotV1Compatible(snap);
          } catch {
            /* ignore snapshot issues */
          }
        }

        if (liveHash) {
          // Always persist the newest snapshot metadata we observed.
          inventoryDb.updateLiveSnapshot(localId, liveHash, snapshotFetchedAt);
          logger.debug(
            'wardrobe-pull-snapshot-updated',
            { localId, vintedId, liveHashPrefix: liveHash.slice(0, 3), snapshotFetchedAt },
            requestId,
          );
        }

        if (isDiscrepancy) {
          // Never overwrite local fields while discrepancy is active.
          if (itemDetail && existing) {
            applyGapFillStructuralPatch({
              existing,
              itemDetail,
              snapshotFetchedAt,
              listFingerprint,
              detailSource: effectiveDetailSource,
            });
          }
          logger.info(
            'wardrobe-pull-discrepancy-skip-overwrite',
            { localId, vintedId, detailSource: effectiveDetailSource, hadDetail: Boolean(itemDetail) },
            requestId,
          );
          pulled++;
          emitSyncProgress('pull', 'progress', pulled, totalEntries);
          inventoryDb.touchLastSeenAt(localId, syncBatchTime);
          continue;
        }

        const prevHash = existing?.live_snapshot_hash ?? null;
        if (prevHash && !liveHash) {
          // We have a baseline snapshot but couldn't fetch a new one to compare.
          // Avoid overwriting local fields without confirming live state.
          logger.warn(
            'wardrobe-pull-snapshot-compare-skipped',
            { localId, vintedId, prevHashPrefix: prevHash.slice(0, 3), hadDetail: Boolean(itemDetail), detailSource: effectiveDetailSource },
            requestId,
          );
          if (itemDetail && existing) {
            applyGapFillStructuralPatch({
              existing,
              itemDetail,
              snapshotFetchedAt,
              listFingerprint,
              detailSource: effectiveDetailSource,
            });
          }
          pulled++;
          emitSyncProgress('pull', 'progress', pulled, totalEntries);
          inventoryDb.touchLastSeenAt(localId, syncBatchTime);
          continue;
        }
        const liveChanged = (() => {
          if (!prevHash || !liveHash) return false;
          if (prevHash.startsWith('v2:')) return prevHash !== liveHash;
          // v1 stored plain sha256 hex without version prefix and without photos.
          if (liveHashV1) return prevHash !== liveHashV1;
          return prevHash !== liveHash;
        })();

        if (prevHash && liveHash && liveChanged) {
          // Live listing changed externally; mark discrepancy and do not overwrite local fields.
          inventoryDb.setInventoryStatus(localId, 'discrepancy');
          {
            const cur = existing ?? inventoryDb.getInventoryItem(localId);
            if (cur) {
              inventoryDb.upsertInventoryItemExplicit({
                id: cur.id,
                title: cur.title,
                price: cur.price,
                discrepancy_reason: 'external_change',
              } as Parameters<typeof inventoryDb.upsertInventoryItemExplicit>[0]);
            }
          }
          logger.info(
            'wardrobe-discrepancy-detected',
            {
              localId,
              vintedId,
              reason: 'external_change',
              prevHashPrefix: prevHash.slice(0, 3),
              liveHashPrefix: liveHash.slice(0, 3),
              detailSource: effectiveDetailSource,
            },
            requestId,
          );
          if (itemDetail && existing) {
            applyGapFillStructuralPatch({
              existing,
              itemDetail,
              snapshotFetchedAt,
              listFingerprint,
              detailSource: effectiveDetailSource,
            });
          }
          pulled++;
          emitSyncProgress('pull', 'progress', pulled, totalEntries);
          inventoryDb.touchLastSeenAt(localId, syncBatchTime);
          continue;
        }

        // Safe to update local from live now.
        // For existing items, upsert list data after snapshot comparison to avoid silent overwrites.
        if (existing) {
          upsertFromVintedItem(vintedItem, { source: 'wardrobe_list', list_fingerprint: listFingerprint, syncBatchTime });
        }
        if (itemDetail) {
          // Re-upsert with full detail data — fills in all the missing fields.
          upsertFromVintedItem(itemDetail, {
            source: 'detail',
            detail_hydrated_at: snapshotFetchedAt,
            detail_source: effectiveDetailSource,
            syncBatchTime,
          });
        }
        logger.debug(
          'wardrobe-pull-local-upserted',
          { localId, vintedId, hadDetail: Boolean(itemDetail), detailSource: effectiveDetailSource },
          requestId,
        );

        // Download and cache photos (only when we are applying sync updates).
        const photos = (vintedItem.photos as Record<string, unknown>[] | undefined) ?? [];
        const photoUrls = photos.map((p) => String(p.url || p.full_size_url || ''));
        const localPaths: string[] = [];

        for (let i = 0; i < photoUrls.length; i++) {
          if (photoUrls[i]) {
            const cached = await downloadAndCacheImage(photoUrls[i], localId, i);
            if (cached) localPaths.push(cached);
          }
        }

        // Update local image paths (targeted update — don't overwrite other fields)
        if (localPaths.length > 0) {
          inventoryDb.updateLocalImagePaths(localId, JSON.stringify(localPaths));
        }

      } catch (err) {
        errors.push(`Item ${vintedItem.id}: ${String(err)}`);
        logger.error('wardrobe-pull-item-error', { vintedId: String(vintedItem.id ?? ''), error: String(err) }, requestId);
      } finally {
        pulled++;
        emitSyncProgress('pull', 'progress', pulled, totalEntries);
        // Browser fetch uses a hidden BrowserWindow; give Electron a moment
        // to tear it down before spinning up the next one.
        if (usedBrowserFallback) {
          await sleep(500);
        }
      }
    }

    page++;
  }

  // Post-sync backfill removed: scraping logic moved to Chrome Extension.

  // ─── Wardrobe Reconciliation Sweep ───
  // Mark items not seen during this full sync as 'removed'.
  // Only runs when we successfully iterated all pages (avoids false positives on API errors).
  if (syncCompletedSuccessfully) {
    const swept = inventoryDb.sweepRemovedItems(syncBatchTime);
    if (swept > 0) {
      logger.info('wardrobe-reconciliation-sweep', { swept, syncBatchTime }, requestId);
    }
  } else {
    logger.warn('wardrobe-reconciliation-sweep-skipped', { reason: 'sync_incomplete', syncBatchTime }, requestId);
  }

  emitSyncProgress('pull', 'complete', pulled, pulled);
  logger.info(
    'wardrobe-pull-complete',
    { pulled, errors: errors.length, durationMs: Date.now() - startedAtMs },
    requestId,
  );
  return { pulled, errors };
}

/**
 * Convert a Vinted API item object into a local inventory_master record.
 */
function upsertFromVintedItem(
  vintedItem: Record<string, unknown>,
  opts?: { source?: 'wardrobe_list' | 'detail'; list_fingerprint?: string; detail_hydrated_at?: number; detail_source?: string; syncBatchTime?: number }
): number {
  const vintedId = Number(vintedItem.id);
  const priceObj = vintedItem.price as Record<string, unknown> | undefined;
  const price = parseFloat(String(priceObj?.amount ?? vintedItem.price ?? 0));
  const currency = String(priceObj?.currency_code ?? 'GBP');

  const photos = (vintedItem.photos as Record<string, unknown>[] | undefined) ?? [];
  const photoUrls = photos.map((p) => String(p.url || p.full_size_url || ''));

  // Handle brand — wardrobe list gives brand as a string, item detail gives brand_dto as object
  let brandId: number | null = null;
  let brandName: string | null = null;
  const brandField = vintedItem.brand_dto ?? vintedItem.brand;
  if (brandField && typeof brandField === 'object') {
    const brandObj = brandField as Record<string, unknown>;
    brandId = brandObj.id ? Number(brandObj.id) : null;
    brandName = String(brandObj.title || brandObj.name || '');
  } else if (typeof brandField === 'string') {
    brandName = brandField;
  }
  // Browser extraction can provide brand_title / _dom_brand without brand_dto.
  if (!brandName && typeof vintedItem.brand_title === 'string') brandName = vintedItem.brand_title;
  if (!brandName && typeof vintedItem._dom_brand === 'string') brandName = vintedItem._dom_brand;
  if (vintedItem.brand_id) brandId = Number(vintedItem.brand_id);

  const isDraft = vintedItem.is_draft === true;
  const isHidden = vintedItem.is_hidden === true;
  const isClosed = vintedItem.is_closed === true;
  const isReserved = vintedItem.is_reserved === true;
  // Spec-compliant sold detection: prefer item_closing_action field,
  // fall back to the legacy heuristic for older API payloads.
  const closingAction = typeof vintedItem.item_closing_action === 'string'
    ? vintedItem.item_closing_action
    : '';
  const isSold = isClosed && (closingAction === 'sold' || !isDraft);

  let status = 'live';
  if (isDraft) status = 'local_only';
  else if (isSold) status = 'sold';
  else if (isHidden) status = 'hidden';
  else if (isReserved) status = 'reserved';

  // Check if we already have this Vinted item locally
  const existing = inventoryDb.getInventoryItemByVintedId(vintedId);

  // Extract condition — wardrobe list gives status as a string (e.g. "Good"),
  // item detail gives status_id as a number
  const conditionMap: Record<string, number> = {
    'New with tags': 6, 'New without tags': 1, 'Very good': 2, 'Good': 3, 'Satisfactory': 4, 'Not fully functional': 5,
  };
  const statusIdToCondition: Record<number, string> = {
    6: 'New with tags', 1: 'New without tags', 2: 'Very good', 3: 'Good', 4: 'Satisfactory', 5: 'Not fully functional',
  };
  let statusIdNum = vintedItem.status_id ? Number(vintedItem.status_id) : null;
  let conditionText: string | null = null;
  if (statusIdNum) {
    conditionText = statusIdToCondition[statusIdNum] ?? null;
  } else if (typeof vintedItem.status === 'string' && conditionMap[vintedItem.status as string]) {
    statusIdNum = conditionMap[vintedItem.status as string];
    conditionText = vintedItem.status as string;
  }

  // Extract item_attributes if available (materials, etc.)
  const itemAttributes = vintedItem.item_attributes
    ? JSON.stringify(vintedItem.item_attributes)
    : (vintedItem.attributes ? JSON.stringify(vintedItem.attributes) : null);

  // Extract package_size_id — flat field, or nested package_size object (SSR)
  let packageSizeId: number | null = vintedItem.package_size_id ? Number(vintedItem.package_size_id) : null;
  if (!packageSizeId && vintedItem.package_size && typeof vintedItem.package_size === 'object') {
    const pkgObj = vintedItem.package_size as Record<string, unknown>;
    if (pkgObj.id) packageSizeId = Number(pkgObj.id);
  }
  if (!packageSizeId && vintedItem.package_size_dto && typeof vintedItem.package_size_dto === 'object') {
    const pkgObj = vintedItem.package_size_dto as Record<string, unknown>;
    if (pkgObj.id) packageSizeId = Number(pkgObj.id);
  }

  // Extract size — wardrobe list gives size as a string, SSR gives size as object
  let sizeId: number | null = vintedItem.size_id ? Number(vintedItem.size_id) : null;
  let sizeLabel: string | null = vintedItem.size_title ? String(vintedItem.size_title) : null;
  if (vintedItem.size && typeof vintedItem.size === 'object') {
    const sizeObj = vintedItem.size as Record<string, unknown>;
    if (!sizeId && sizeObj.id) sizeId = Number(sizeObj.id);
    if (!sizeLabel && (sizeObj.title || sizeObj.name)) sizeLabel = String(sizeObj.title || sizeObj.name);
  } else if (typeof vintedItem.size === 'string') {
    sizeLabel = vintedItem.size as string;
  }
  if (vintedItem.size_dto && typeof vintedItem.size_dto === 'object') {
    const sizeObj = vintedItem.size_dto as Record<string, unknown>;
    if (!sizeId && sizeObj.id) sizeId = Number(sizeObj.id);
    if (!sizeLabel && (sizeObj.title || sizeObj.name)) sizeLabel = String(sizeObj.title || sizeObj.name);
  }
  if (!sizeLabel && typeof vintedItem._dom_size === 'string') {
    const s = vintedItem._dom_size.trim();
    if (s) sizeLabel = s;
  }

  // Extract catalog_id — flat field, or nested category/catalog object (SSR)
  let catalogId: number | null = vintedItem.catalog_id ? Number(vintedItem.catalog_id) : null;
  if (!catalogId) {
    const catField = vintedItem.category ?? vintedItem.catalog;
    if (catField && typeof catField === 'object') {
      const catObj = catField as Record<string, unknown>;
      if (catObj.id) catalogId = Number(catObj.id);
    }
  }

  // Extract color_ids — flat array, or nested colors array of objects (SSR), or color1_id/color2_id
  let colorIds: number[] | null = null;
  if (vintedItem.color_ids && Array.isArray(vintedItem.color_ids)) {
    colorIds = vintedItem.color_ids as number[];
  } else if (vintedItem.colors && Array.isArray(vintedItem.colors)) {
    colorIds = (vintedItem.colors as Record<string, unknown>[])
      .map((c) => Number(c.id))
      .filter((id) => id > 0);
  } else {
    const c1 = vintedItem.color1_id ? Number(vintedItem.color1_id) : 0;
    const c2 = vintedItem.color2_id ? Number(vintedItem.color2_id) : 0;
    if (c1 || c2) {
      colorIds = [];
      if (c1) colorIds.push(c1);
      if (c2) colorIds.push(c2);
    }
  }

  // Extract status_id from nested status object (SSR)
  if (!statusIdNum && vintedItem.status && typeof vintedItem.status === 'object') {
    const statusObj = vintedItem.status as Record<string, unknown>;
    if (statusObj.id) {
      statusIdNum = Number(statusObj.id);
      conditionText = statusIdToCondition[statusIdNum] ?? null;
    }
  }

  // Only overwrite fields with non-null values from sync, preserving existing local data
  const upsertData: Record<string, unknown> = {
    id: existing?.id,
    title: String(vintedItem.title || ''),
    price,
    currency,
    photo_urls: JSON.stringify(photoUrls),
    status,
    extra_metadata: JSON.stringify({
      is_hidden: isHidden,
      is_draft: isDraft,
      is_closed: isClosed,
      favourite_count: vintedItem.favourite_count,
      view_count: vintedItem.view_count,
    }),
  };

  if (opts?.source === 'wardrobe_list' && typeof opts.list_fingerprint === 'string' && opts.list_fingerprint) {
    upsertData.list_fingerprint = opts.list_fingerprint;
  }
  if (opts?.source === 'detail') {
    if (typeof opts.detail_hydrated_at === 'number' && Number.isFinite(opts.detail_hydrated_at)) {
      upsertData.detail_hydrated_at = opts.detail_hydrated_at;
    }
    if (typeof opts.detail_source === 'string' && opts.detail_source) {
      upsertData.detail_source = opts.detail_source;
    }
  }

  // Only set fields that have actual values (avoid overwriting existing local data with nulls)
  if (vintedItem.description) upsertData.description = String(vintedItem.description);
  else if (!existing) upsertData.description = '';
  if (catalogId) upsertData.category_id = catalogId;
  if (brandId) upsertData.brand_id = brandId;
  if (brandName) upsertData.brand_name = brandName;
  if (sizeId) upsertData.size_id = sizeId;
  if (sizeLabel) upsertData.size_label = sizeLabel;
  if (conditionText) upsertData.condition = conditionText;
  if (statusIdNum) upsertData.status_id = statusIdNum;
  if (colorIds && colorIds.length > 0) upsertData.color_ids = JSON.stringify(colorIds);
  if (packageSizeId) upsertData.package_size_id = packageSizeId;
  if (itemAttributes) upsertData.item_attributes = itemAttributes;
  if (vintedItem.is_unisex !== undefined) upsertData.is_unisex = vintedItem.is_unisex ? 1 : 0;

  // Niche fields (from item detail endpoint)
  if (vintedItem.isbn) upsertData.isbn = String(vintedItem.isbn);
  if (vintedItem.measurement_length) upsertData.measurement_length = Number(vintedItem.measurement_length);
  if (vintedItem.measurement_width) upsertData.measurement_width = Number(vintedItem.measurement_width);
  if (vintedItem.manufacturer) upsertData.manufacturer = String(vintedItem.manufacturer);
  if (vintedItem.manufacturer_labelling) upsertData.manufacturer_labelling = String(vintedItem.manufacturer_labelling);
  if (vintedItem.video_game_rating_id) upsertData.video_game_rating_id = Number(vintedItem.video_game_rating_id);
  if (vintedItem.shipment_prices) upsertData.shipment_prices = JSON.stringify(vintedItem.shipment_prices);
  // Model metadata (from item detail: model_metadata or from item_attributes)
  if (vintedItem.model_metadata) upsertData.model_metadata = JSON.stringify(vintedItem.model_metadata);

  // Capture sold/reserved status from wardrobe list
  if (vintedItem.is_reserved === true) {
    upsertData.extra_metadata = JSON.stringify({
      ...JSON.parse(upsertData.extra_metadata as string || '{}'),
      is_reserved: true,
    });
  }
  if (vintedItem.transaction_permitted === false && !isDraft && !isClosed && !isHidden) {
    // Item is sold if it can't be transacted and isn't draft/closed/hidden
    upsertData.extra_metadata = JSON.stringify({
      ...JSON.parse(upsertData.extra_metadata as string || '{}'),
      is_sold: true,
    });
  }

  const localId = inventoryDb.upsertInventoryItem(upsertData as Parameters<typeof inventoryDb.upsertInventoryItem>[0]);

  // Link sync record
  inventoryDb.upsertSyncRecord(localId, vintedId, 'pull');

  // Stamp as seen for reconciliation sweep
  if (opts?.syncBatchTime) {
    inventoryDb.touchLastSeenAt(localId, opts.syncBatchTime);
  }

  return localId;
}

// ─── Create New Listing ─────────────────────────────────────────────────────

function emitCreateProgress(
  step: string,
  current: number,
  total: number,
  message?: string,
): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('wardrobe:create-progress', { step, current, total, message });
  }
}

/**
 * Create a brand-new listing: upload photos (with EXIF strip), publish to Vinted,
 * and save locally. Emits progress events for multi-step UI overlay.
 */
export async function createNewListing(
  formData: Record<string, unknown>,
  localPhotoPaths: string[],
): Promise<{ ok: boolean; localId?: number; vintedItemId?: number; error?: string }> {
  const requestId = crypto.randomUUID();
  const startedAtMs = Date.now();
  logger.info('create-listing-start', { photoCount: localPhotoPaths.length }, requestId);

  if (!localPhotoPaths.length) {
    return { ok: false, error: 'At least one photo is required.' };
  }
  if (localPhotoPaths.length > 20) {
    return { ok: false, error: 'Maximum 20 photos allowed.' };
  }

  const uploadSessionId = crypto.randomUUID();
  const assignedPhotos: { id: number; orientation: number }[] = [];
  const photoTotal = localPhotoPaths.length;

  // ── Step 1: Upload each photo with EXIF stripping ──
  for (let i = 0; i < localPhotoPaths.length; i++) {
    emitCreateProgress('uploading', i + 1, photoTotal, `Uploading photo ${i + 1} of ${photoTotal}…`);

    let buf: Buffer;
    try {
      buf = Buffer.from(fs.readFileSync(localPhotoPaths[i]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('create-listing-read-photo-failed', { path: localPhotoPaths[i], error: msg }, requestId);
      return { ok: false, error: `Failed to read photo: ${msg}` };
    }

    const up = await bridge.uploadPhotoRaw(buf, uploadSessionId, undefined, 'DIRECT', true);
    if (!up.ok) {
      const code = (up as { code?: string }).code ?? '';
      const msg = (up as { message?: string }).message ?? 'Upload failed';
      logger.error('create-listing-upload-failed', { index: i, code, message: msg }, requestId);
      return { ok: false, error: `Photo upload failed (${i + 1}/${photoTotal}): ${msg}` };
    }

    const data = (up as { data: unknown }).data as Record<string, unknown>;
    const photoId = Number(data.id || 0);
    if (photoId <= 0) {
      logger.error('create-listing-no-photo-id', { index: i, data: JSON.stringify(data).slice(0, 300) }, requestId);
      return { ok: false, error: `Photo upload returned no ID for photo ${i + 1}.` };
    }

    assignedPhotos.push({ id: photoId, orientation: 0 });
    logger.debug('create-listing-photo-uploaded', { index: i, photoId }, requestId);

    // Small delay between uploads to mimic human behavior
    if (i < localPhotoPaths.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 300 + Math.random() * 500));
    }
  }

  // ── Step 2: Build item_data payload ──
  emitCreateProgress('publishing', 0, 1, 'Publishing listing…');

  const itemData: Record<string, unknown> = {
    currency: formData.currency || 'GBP',
    temp_uuid: uploadSessionId,
    title: formData.title || '',
    description: formData.description || '',
    brand_id: formData.brand_id || null,
    brand: formData.brand || '',
    size_id: formData.size_id || null,
    catalog_id: formData.catalog_id || null,
    isbn: formData.isbn || null,
    is_unisex: Boolean(formData.is_unisex),
    status_id: formData.status_id || 2,
    video_game_rating_id: formData.video_game_rating_id || null,
    price: formData.price || 0,
    package_size_id: formData.package_size_id || 3,
    shipment_prices: formData.shipment_prices || { domestic: null, international: null },
    color_ids: Array.isArray(formData.color_ids) ? formData.color_ids : [],
    assigned_photos: assignedPhotos,
    measurement_length: formData.measurement_length || null,
    measurement_width: formData.measurement_width || null,
    item_attributes: Array.isArray(formData.item_attributes) ? formData.item_attributes : [],
    manufacturer: formData.manufacturer || null,
    manufacturer_labelling: formData.manufacturer_labelling || null,
  };

  // Include model metadata if present (luxury brands)
  if (formData.model_metadata && typeof formData.model_metadata === 'object') {
    itemData.model_metadata = formData.model_metadata;
  }

  // ── Step 3: Create listing via bridge ──
  const result = await bridge.createListing(itemData, uploadSessionId);
  if (!result.ok) {
    const code = (result as { code?: string }).code ?? '';
    const msg = (result as { message?: string }).message ?? 'Create failed';
    logger.error('create-listing-api-failed', { code, message: msg }, requestId);
    emitCreateProgress('error', 0, 0, msg);
    return { ok: false, error: msg };
  }

  // ── Step 4: Extract new item ID & upsert locally ──
  const respData = (result as { data: unknown }).data as Record<string, unknown>;
  // Vinted wraps the created item — look for the ID in various places
  const itemObj = (respData.item ?? respData) as Record<string, unknown>;
  const newItemId = Number(itemObj.id || respData.item_id || 0);

  // Upsert local inventory record
  const localId = inventoryDb.upsertInventoryItem({
    title: String(formData.title || ''),
    price: Number(formData.price || 0),
    currency: String(formData.currency || 'GBP'),
    description: String(formData.description || ''),
    category_id: formData.catalog_id ? Number(formData.catalog_id) : null,
    brand_id: formData.brand_id ? Number(formData.brand_id) : null,
    brand_name: formData.brand ? String(formData.brand) : null,
    size_id: formData.size_id ? Number(formData.size_id) : null,
    status_id: formData.status_id ? Number(formData.status_id) : null,
    condition: formData.condition ? String(formData.condition) : null,
    color_ids: JSON.stringify(Array.isArray(formData.color_ids) ? formData.color_ids : []),
    package_size_id: formData.package_size_id ? Number(formData.package_size_id) : null,
    item_attributes: JSON.stringify(Array.isArray(formData.item_attributes) ? formData.item_attributes : []),
    is_unisex: formData.is_unisex ? 1 : 0,
    isbn: formData.isbn ? String(formData.isbn) : null,
    measurement_length: formData.measurement_length ? Number(formData.measurement_length) : null,
    measurement_width: formData.measurement_width ? Number(formData.measurement_width) : null,
    photo_urls: '[]',
    local_image_paths: JSON.stringify(localPhotoPaths),
    status: 'live',
  } as Parameters<typeof inventoryDb.upsertInventoryItem>[0]);

  // Link sync record
  if (newItemId) {
    inventoryDb.upsertSyncRecord(localId, newItemId, 'push');
  }

  emitCreateProgress('complete', 1, 1, 'Listing published successfully!');
  logger.info(
    'create-listing-complete',
    { localId, vintedItemId: newItemId, photoCount: assignedPhotos.length, durationMs: Date.now() - startedAtMs },
    requestId,
  );

  return { ok: true, localId, vintedItemId: newItemId };
}

// ─── Push to Vinted ─────────────────────────────────────────────────────────

/**
 * Push a local inventory item to Vinted (create new listing).
 */
export async function pushToVinted(localId: number, proxy?: string): Promise<{
  ok: boolean;
  vintedItemId?: number;
  error?: string;
}> {
  const requestId = crypto.randomUUID();
  const startedAtMs = Date.now();
  const item = inventoryDb.getInventoryItem(localId);
  if (!item) {
    logger.warn('wardrobe-push-missing', { localId }, requestId);
    return { ok: false, error: 'Item not found' };
  }

  let proxyHost: string | null = null;
  if (proxy) {
    try { proxyHost = new URL(proxy).hostname || null; } catch { proxyHost = null; }
  }
  logger.info(
    'wardrobe-push-start',
    { localId, hasLiveId: Boolean(item.vinted_item_id), transportMode: proxyService.getTransportMode(), proxyHost },
    requestId,
  );

  // If this local record is already linked to a live Vinted listing, "Push" should
  // reconcile by overwriting the live listing with the current local fields (edit),
  // not creating a brand new listing.
  if (item.vinted_item_id) {
    logger.info('wardrobe-push-overwrite-live', { localId, vintedItemId: item.vinted_item_id }, requestId);
    const r = await editLiveItem(
      localId,
      // Minimal upsert to satisfy DB constraints; the actual payload is built from the
      // full local record inside editLiveItem().
      { id: item.id, title: item.title, price: item.price },
      proxy
    );
    if (!r.ok) {
      logger.error(
        'wardrobe-push-overwrite-live-failed',
        { localId, vintedItemId: item.vinted_item_id, error: r.error || 'Edit failed' },
        requestId,
      );
      return { ok: false, vintedItemId: item.vinted_item_id, error: r.error || 'Edit failed' };
    }
    logger.info('wardrobe-push-complete', { localId, vintedItemId: item.vinted_item_id, durationMs: Date.now() - startedAtMs }, requestId);
    return { ok: true, vintedItemId: item.vinted_item_id };
  }

  const itemData = buildVintedItemData(item);

  const result = await bridge.createListing(itemData, undefined, proxy);
  if (!result.ok) {
    const code = (result as { code?: string }).code ?? '';
    const msg = (result as { message?: string }).message ?? 'Create failed';
    logger.error('wardrobe-push-create-failed', { localId, code, message: msg }, requestId);
    return { ok: false, error: (result as { message?: string }).message ?? 'Create failed' };
  }

  // Extract new item ID from response
  const data = (result as { data: unknown }).data as Record<string, unknown>;
  const newItemId = Number(data.item_id || data.id || 0);

  if (newItemId) {
    inventoryDb.upsertSyncRecord(localId, newItemId, 'push');
    inventoryDb.setInventoryStatus(localId, 'live');
    // If this record was previously marked discrepancy, clear the reason on success.
    inventoryDb.upsertInventoryItemExplicit({
      id: item.id,
      title: item.title,
      price: item.price,
      discrepancy_reason: null,
    } as Parameters<typeof inventoryDb.upsertInventoryItemExplicit>[0]);
  }

  logger.info('wardrobe-push-complete', { localId, vintedItemId: newItemId, durationMs: Date.now() - startedAtMs }, requestId);
  return { ok: true, vintedItemId: newItemId };
}

/**
 * Pull the current live Vinted listing details into the local vault.
 * This is used to reconcile a discrepancy when the live listing changed externally
 * and the user chooses to accept the live version as the new local source of truth.
 */
export async function pullLiveToLocal(localId: number): Promise<{ ok: boolean; error?: string }> {
  const requestId = crypto.randomUUID();
  const startedAtMs = Date.now();
  const existing = inventoryDb.getInventoryItem(localId);
  if (!existing) {
    logger.warn('wardrobe-pull-live-to-local-missing', { localId }, requestId);
    return { ok: false, error: 'Item not found' };
  }
  const vintedItemId = Number(existing.vinted_item_id || 0);
  if (!vintedItemId) {
    logger.warn('wardrobe-pull-live-to-local-missing-vinted-id', { localId }, requestId);
    return { ok: false, error: 'No Vinted item ID linked — cannot pull live details' };
  }

  logger.info('wardrobe-pull-live-to-local-start', { localId, vintedItemId }, requestId);

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // ─── Extension-Mediated Pull ─────────────────────────────────────────────
  // Open the Vinted edit page with ?hq_sync=true so the Chrome Extension's
  // Deep Sync extracts the live itemEditModel and POSTs it to /ingest/item.
  // We poll the local DB for a freshness update to detect completion.

  const beforeHydratedAt = existing.detail_hydrated_at ?? 0;
  const syncUrl = `https://www.vinted.co.uk/items/${vintedItemId}/edit?hq_sync=true`;
  logger.info('wardrobe-pull-extension-sync', { localId, vintedItemId, syncUrl, beforeHydratedAt }, requestId);

  try {
    const { execFile } = await import('child_process');
    execFile('open', ['-a', 'Google Chrome', syncUrl]);
  } catch (err) {
    logger.error('wardrobe-pull-open-browser-failed', { localId, error: String(err) }, requestId);
    return { ok: false, error: 'Failed to open browser for extension sync.' };
  }

  // Poll for the extension's /ingest/item to update the DB row.
  // The extension typically completes within 3-8 seconds.
  const POLL_INTERVAL_MS = 1000;
  const POLL_TIMEOUT_MS = 20000;
  const pollStartMs = Date.now();
  let synced = false;

  while (Date.now() - pollStartMs < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const fresh = inventoryDb.getInventoryItem(localId);
    if (fresh && (fresh.detail_hydrated_at ?? 0) > beforeHydratedAt) {
      synced = true;
      logger.info(
        'wardrobe-pull-extension-sync-detected',
        { localId, vintedItemId, newHydratedAt: fresh.detail_hydrated_at, waitMs: Date.now() - pollStartMs },
        requestId,
      );
      break;
    }
  }

  if (!synced) {
    logger.warn('wardrobe-pull-extension-sync-timeout', { localId, vintedItemId, waitMs: POLL_TIMEOUT_MS }, requestId);
    return {
      ok: false,
      error: 'Extension sync timed out. Make sure the Chrome Extension is installed and active, then try again.',
    };
  }

  // ─── Post-Sync Reconciliation ────────────────────────────────────────────
  // The extension's /ingest/item has already updated most fields in the DB.
  // We just need to: set status to 'live', clear discrepancy, refresh photos.

  const updated = inventoryDb.getInventoryItem(localId);
  if (!updated) {
    return { ok: false, error: 'Item disappeared after sync.' };
  }

  // Set status back to 'live' and clear discrepancy reason.
  inventoryDb.upsertInventoryItemExplicit({
    id: updated.id,
    title: updated.title,
    price: updated.price,
    status: 'live',
    discrepancy_reason: null,
  } as Parameters<typeof inventoryDb.upsertInventoryItemExplicit>[0]);

  inventoryDb.upsertSyncRecord(localId, vintedItemId, 'pull');

  // Update live snapshot hash so future wardrobe syncs don't re-flag as discrepancy.
  try {
    const snapshotFetchedAt = Math.floor(Date.now() / 1000);
    // Build a snapshot from the refreshed local record (which now mirrors live).
    const snapshotData: Record<string, unknown> = {
      title: updated.title,
      description: updated.description,
      price: { amount: String(updated.price), currency_code: updated.currency ?? 'GBP' },
      photos: [],
      catalog_id: updated.category_id,
      brand_id: updated.brand_id,
      size_id: updated.size_id,
      status_id: updated.status_id,
      package_size_id: updated.package_size_id,
      color_ids: Array.isArray(updated.color_ids) ? updated.color_ids : [],
      item_attributes: Array.isArray(updated.item_attributes) ? updated.item_attributes : [],
    };
    const liveHash = hashLiveSnapshot(buildLiveSnapshotFromVintedDetail(snapshotData));
    inventoryDb.updateLiveSnapshot(localId, liveHash, snapshotFetchedAt);
  } catch {
    /* ignore snapshot hash issues */
  }

  // Re-cache photos from the updated photo_urls.
  const photoUrls = Array.isArray(updated.photo_urls)
    ? (updated.photo_urls as string[]).filter(Boolean)
    : [];
  if (photoUrls.length > 0) {
    const localPaths: string[] = [];
    for (let i = 0; i < photoUrls.length; i++) {
      const cached = await downloadAndCacheImage(photoUrls[i], localId, i);
      if (cached) localPaths.push(cached);
    }
    inventoryDb.updateLocalImagePaths(localId, JSON.stringify(localPaths));
  }

  logger.info(
    'wardrobe-pull-live-to-local-complete',
    {
      localId,
      vintedItemId,
      detailSource: 'extension',
      cachedPhotos: photoUrls.length,
      durationMs: Date.now() - startedAtMs,
    },
    requestId,
  );
  return { ok: true };
}

/**
 * Edit a live Vinted listing — pushes local changes to the live listing.
 * Saves locally first, then calls PUT /api/v2/item_upload/items/{id}.
 */
export async function editLiveItem(
  localId: number,
  updates: Record<string, unknown>,
  proxy?: string
): Promise<{ ok: boolean; error?: string }> {
  const requestId = crypto.randomUUID();
  const startedAtMs = Date.now();
  const updateKeys = Object.keys(updates ?? {}).filter((k) => k !== '__photo_plan').slice(0, 50);
  const hasPhotoPlan = Object.prototype.hasOwnProperty.call(updates ?? {}, '__photo_plan');

  logger.info(
    'wardrobe-edit-start',
    {
      localId,
      updateKeys,
      hasPhotoPlan,
      transportMode: proxyService.getTransportMode(),
      browser_proxy_mode: settings.getSetting('browser_proxy_mode'),
      hasProxy: Boolean(proxy),
    },
    requestId,
  );

  // Capture pre-edit photos so we can avoid local/live divergence when the
  // renderer doesn't have real Vinted photo IDs (e.g. detail fetch failed).
  const before = inventoryDb.getInventoryItem(localId);
  const beforePhotoUrls = Array.isArray(before?.photo_urls) ? (before.photo_urls as string[]) : [];
  const beforeLocalPaths = Array.isArray(before?.local_image_paths) ? (before.local_image_paths as string[]) : [];

  // 1. Save locally
  inventoryDb.upsertInventoryItemExplicit(updates as Parameters<typeof inventoryDb.upsertInventoryItemExplicit>[0]);

  // 2. Get the full item from DB (with sync data)
  const item = inventoryDb.getInventoryItem(localId);
  if (!item) {
    logger.error('wardrobe-edit-missing-after-save', { localId }, requestId);
    return { ok: false, error: 'Item not found after save' };
  }

  // 3. If not linked to a Vinted listing, just save locally
  if (!item.vinted_item_id) {
    logger.info('edit-saved-locally', { localId, durationMs: Date.now() - startedAtMs }, requestId);
    return { ok: true };
  }

  // 4. Ensure required edit fields exist before pushing (category-aware).
  // If something critical is missing locally, hydrate from the authenticated browser context.
  const completeness = await getDetailCompleteness(localId);
  logger.info(
    'wardrobe-edit-completeness-check',
    {
      localId,
      vintedItemId: item.vinted_item_id,
      ok: completeness.ok,
      complete: completeness.complete,
      missing: completeness.missing,
      requires_size: completeness.requires_size,
      requires_size_known: completeness.requires_size_known,
      detail_hydrated_at: completeness.detail_hydrated_at,
      detail_source: completeness.detail_source,
    },
    requestId,
  );
  // Browser hydration removed: Chrome Ext will handle missing data hydration.

  if (!completeness.ok || !completeness.complete) {
    const missing = completeness.ok ? completeness.missing : ['unknown'];
    logger.warn(
      'wardrobe-edit-missing-required-fields',
      { localId, vintedItemId: item.vinted_item_id, missing, requires_size: completeness.ok ? completeness.requires_size : null },
      requestId,
    );
    return {
      ok: false,
      error: `Missing required listing fields (${missing.join(', ')}). Open the item and let details load, then try Push again.`,
    };
  }

  // 5. Build Vinted API payload from the updated local record
  const itemData = buildVintedItemData(item, { requiresSize: completeness.requires_size });

  // 6. Photo handling (add/remove/reorder)
  // The renderer can send a transient `__photo_plan` payload (not persisted in DB)
  // so we can construct `assigned_photos` for the edit call.
  const photoPlan = (updates as unknown as { __photo_plan?: unknown }).__photo_plan as
    | { original_existing_ids?: number[]; items?: { type: string; id?: number; url?: string; path?: string }[] }
    | undefined;

  const uploadSessionId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());
  itemData.temp_uuid = uploadSessionId;

  // If we apply photos successfully, we update local DB ONLY after the PUT succeeds.
  let postPushPhotoUpdate: { photo_urls: string[]; local_image_paths: string[] } | null = null;



  if (photoPlan?.items && Array.isArray(photoPlan.items) && photoPlan.items.length > 0) {
    const planItems = photoPlan.items;
    const arraysEqual = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

    const hasUnknownExistingIds = planItems.some((p) => p?.type === 'existing' && Number(p.id || 0) <= 0);
    const plannedExistingUrls = planItems
      .filter((p) => p?.type === 'existing')
      .map((p) => (p?.url ? String(p.url) : ''))
      .filter(Boolean);
    const plannedNewPaths = planItems
      .filter((p) => p?.type === 'new')
      .map((p) => (p?.path ? String(p.path) : ''))
      .filter(Boolean);

    logger.info(
      'wardrobe-edit-photo-plan-summary',
      {
        localId,
        vintedItemId: item.vinted_item_id,
        planItemCount: planItems.length,
        existingCount: plannedExistingUrls.length,
        newCount: plannedNewPaths.length,
        hasUnknownExistingIds,
      },
      requestId,
    );

    const photoPlanNoop = plannedNewPaths.length === 0 && arraysEqual(plannedExistingUrls, beforePhotoUrls);
    if (photoPlanNoop) {
      // Renderer always sends a photo plan; skip all processing when there are
      // no new photos and the existing remote photo order is unchanged.
      logger.debug(
        'wardrobe-edit-photo-plan-noop',
        { localId, vintedItemId: item.vinted_item_id, existingCount: plannedExistingUrls.length },
        requestId,
      );
      delete itemData.assigned_photos;
    } else if (hasUnknownExistingIds) {
      // We can't safely alter photos without IDs. Vinted will preserve existing photos
      // if we omit assigned_photos, so ensure local doesn't claim a change either.
      const photoStateChanged =
        plannedNewPaths.length > 0 ||
        !arraysEqual(plannedExistingUrls, beforePhotoUrls) ||
        !arraysEqual(Array.isArray(item.local_image_paths) ? (item.local_image_paths as string[]) : [], beforeLocalPaths);

      if (photoStateChanged) {
        logger.warn(
          'edit-photos-skipped-missing-ids',
          { localId, vintedItemId: item.vinted_item_id, plannedNewCount: plannedNewPaths.length, plannedExistingCount: plannedExistingUrls.length },
          requestId,
        );
        inventoryDb.upsertInventoryItem({
          id: item.id,
          title: item.title,
          price: item.price,
          photo_urls: JSON.stringify(beforePhotoUrls),
          local_image_paths: JSON.stringify(beforeLocalPaths),
        } as Parameters<typeof inventoryDb.upsertInventoryItem>[0]);
      }

      delete itemData.assigned_photos;
    } else {
      const assigned: { id: number; orientation: number }[] = [];
      const finalRemoteUrls: string[] = [];

      for (const p of planItems) {
        if (p?.type === 'existing') {
          const id = Number(p.id || 0);
          const url = p.url ? String(p.url) : '';
          if (id > 0) assigned.push({ id, orientation: 0 });
          if (url) finalRemoteUrls.push(url);
        } else if (p?.type === 'new') {
          const path = p.path ? String(p.path) : '';
          if (!path) continue;
          try {
            // Upload the raw bytes (no mutation) and capture the Vinted photo ID.
            const fs = await import('fs');
            const buf = Buffer.from(fs.readFileSync(path));

            const ext = path.toLowerCase().split('.').pop() ?? '';
            const mimeType =
              ext === 'png' ? 'image/png' :
                ext === 'webp' ? 'image/webp' :
                  'image/jpeg';
            const filename = path.split('/').pop() || 'photo.jpg';

            // Attempt 1: bridge upload (fast). If blocked, fall back to browser upload.
            let photoId = 0;
            let photoUrl = '';

            const up = await bridge.uploadPhotoRaw(buf, uploadSessionId, undefined, 'DIRECT');
            if (up.ok) {
              const data = (up as { data: unknown }).data as Record<string, unknown>;
              photoId = Number(data.id || 0);
              photoUrl = data.url ? String(data.url) : '';
              logger.debug(
                'wardrobe-edit-photo-upload',
                { localId, vintedItemId: item.vinted_item_id, source: 'bridge', photoId, hasUrl: Boolean(photoUrl) },
                requestId,
              );
            } else {
              const code = (up as { code?: string }).code ?? '';
              const msg = (up as { message?: string }).message ?? '';
              const looksBlocked =
                code === 'FORBIDDEN' ||
                code === 'DATADOME_CHALLENGE' ||
                msg.toLowerCase().includes('access forbidden') ||
                msg.toLowerCase().includes('bot') ||
                msg.toLowerCase().includes('datadome');

              if (!looksBlocked) {
                throw new Error(msg || 'Photo upload failed');
              }

              logger.warn(
                'wardrobe-edit-photo-upload-blocked',
                { localId, vintedItemId: item.vinted_item_id, source: 'bridge', code, message: msg.slice(0, 200) },
                requestId,
              );

              throw new Error(`Photo upload blocked or failed: ${msg}`);
            }

            if (photoId <= 0) {
              throw new Error('Photo upload returned no ID');
            }

            assigned.push({ id: photoId, orientation: 0 });
            if (photoUrl) finalRemoteUrls.push(photoUrl);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('edit-photo-upload-failed', { localId, error: msg }, requestId);
            return { ok: false, error: `Photo upload failed: ${msg}` };
          }
        }
      }

      // At this point, we have real IDs for all existing photos (validated above),
      // and any new photos included must have uploaded an ID.
      if (assigned.length > 0) {
        itemData.assigned_photos = assigned;
        postPushPhotoUpdate = { photo_urls: finalRemoteUrls, local_image_paths: [] };
      } else {
        delete itemData.assigned_photos;
      }
    }
  } else {
    // No explicit photo plan; do not touch photos.
    delete itemData.assigned_photos;
  }

  // 7. Push edit to Vinted via the Python bridge.
  const editResult = await bridge.editListing(
    item.vinted_item_id,
    itemData,
    uploadSessionId,
    proxy,
  );

  if (!editResult.ok) {
    const code = (editResult as { code?: string }).code ?? '';
    const msg = (editResult as { message?: string }).message ?? 'Edit failed';
    logger.error(
      'wardrobe-edit-vinted-failed',
      { localId, vintedItemId: item.vinted_item_id, code, message: msg },
      requestId,
    );
    // Mark as discrepancy with failed_push reason so UI can show retry hint.
    inventoryDb.upsertInventoryItemExplicit({
      id: item.id,
      title: item.title,
      price: item.price,
      status: 'discrepancy',
      discrepancy_reason: 'failed_push',
    } as Parameters<typeof inventoryDb.upsertInventoryItemExplicit>[0]);
    return { ok: false, error: `Vinted API error: ${msg}` };
  }

  // Update local photo state after a successful push (if photos changed).
  if (postPushPhotoUpdate) {
    inventoryDb.upsertInventoryItem({
      id: item.id,
      title: item.title,
      price: item.price,
      photo_urls: JSON.stringify(postPushPhotoUpdate.photo_urls),
      local_image_paths: JSON.stringify(postPushPhotoUpdate.local_image_paths),
    } as Parameters<typeof inventoryDb.upsertInventoryItem>[0]);
  }

  // Clear discrepancy on successful push.
  inventoryDb.upsertInventoryItemExplicit({
    id: item.id,
    title: item.title,
    price: item.price,
    status: 'live',
    discrepancy_reason: null,
  } as Parameters<typeof inventoryDb.upsertInventoryItemExplicit>[0]);

  logger.info(
    'wardrobe-edit-complete',
    { localId, vintedItemId: item.vinted_item_id, durationMs: Date.now() - startedAtMs },
    requestId,
  );
  return { ok: true };
}

/**
 * Build Vinted API item_data payload from a local inventory record.
 * Includes ALL fields to ensure relist/edit preserves every detail of the listing.
 */
function buildVintedItemData(item: inventoryDb.InventoryItemJoined, opts?: { requiresSize?: boolean }): Record<string, unknown> {
  const coerceJsonArray = (value: unknown, label: string): unknown[] => {
    // Inventory DB returns these fields already parsed; accept arrays directly.
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('inventory-json-parse-failed', { label, error: msg, sample: trimmed.slice(0, 200) });
      return [];
    }
  };

  const coerceJsonObject = (value: unknown, fallback: Record<string, unknown>, label: string): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      return fallback;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('inventory-json-parse-failed', { label, error: msg, sample: trimmed.slice(0, 200) });
      return fallback;
    }
  };

  const normalizedColorIds = coerceJsonArray(item.color_ids, 'color_ids');
  const normalizedAttributes = coerceJsonArray(item.item_attributes, 'item_attributes');
  const normalizedShipmentPrices = coerceJsonObject(
    item.shipment_prices,
    { domestic: null, international: null },
    'shipment_prices'
  ) as { domestic?: unknown; international?: unknown };

  const data: Record<string, unknown> = {
    currency: item.currency || 'GBP',
    temp_uuid: '',
    title: item.title,
    description: item.description || '',
    brand_id: item.brand_id,
    brand: item.brand_name || '',
    size_id: item.size_id,
    catalog_id: item.category_id,
    isbn: item.isbn || null,
    is_unisex: Boolean(item.is_unisex),
    status_id: item.status_id || 2,
    video_game_rating_id: item.video_game_rating_id || null,
    price: item.price,
    package_size_id: item.package_size_id || 3,
    shipment_prices: {
      domestic: normalizedShipmentPrices.domestic ?? null,
      international: normalizedShipmentPrices.international ?? null,
    },
    color_ids: normalizedColorIds,
    assigned_photos: [], // Photos handled separately during relist/push
    measurement_length: item.measurement_length || null,
    measurement_width: item.measurement_width || null,
    item_attributes: normalizedAttributes,
    manufacturer: item.manufacturer || null,
    manufacturer_labelling: item.manufacturer_labelling || null,
  };

  // Include model metadata if present (for luxury brands)
  if (item.model_metadata) {
    try {
      const modelMeta =
        typeof item.model_metadata === 'string'
          ? (JSON.parse(item.model_metadata) as unknown)
          : item.model_metadata;
      if (modelMeta && typeof modelMeta === 'object' && !Array.isArray(modelMeta)) {
        const mm = modelMeta as Record<string, unknown>;
        if (mm.collection_id || mm.model_id) {
          data.model_metadata = mm;
        }
      }
    } catch { /* ignore parse errors */ }
  }

  if (opts?.requiresSize === false) {
    // Categories like bags/accessories don't have a size field; avoid sending size_id: null
    // which can be treated as a validation error by Vinted.
    delete data.size_id;
  }

  return data;
}

// ─── Relist Queue ("Waiting Room") ──────────────────────────────────────────

let queue: RelistQueueEntry[] = [];
let queueProcessing = false;
let queueAborted = false;
let nextRelistCountdown = 0;
let countdownInterval: ReturnType<typeof setInterval> | null = null;

export function getQueue(): RelistQueueEntry[] {
  return [...queue];
}

export function getQueueCountdown(): number {
  return nextRelistCountdown;
}

/**
 * Add items to the relist queue. Generates mutated thumbnail previews.
 */
export async function enqueueRelist(localIds: number[]): Promise<RelistQueueEntry[]> {
  const requestId = crypto.randomUUID();
  const startedAtMs = Date.now();
  logger.info('relist-enqueue-start', { requestedCount: localIds.length }, requestId);

  const added: RelistQueueEntry[] = [];
  let skippedAlreadyQueued = 0;
  let skippedMissingLocal = 0;
  let noCachedImages = 0;

  for (const localId of localIds) {
    // Skip if already in queue
    if (queue.some((e) => e.localId === localId)) {
      skippedAlreadyQueued++;
      continue;
    }

    const item = inventoryDb.getInventoryItem(localId);
    if (!item) {
      skippedMissingLocal++;
      logger.warn('relist-enqueue-missing-item', { localId }, requestId);
      continue;
    }

    const relistCount = inventoryDb.getRelistCount(localId);

    // Compute jittered title preview
    const stripped = item.title.trim();
    const jitteredTitle = relistCount % 2 === 0 ? stripped + ' ' : stripped;

    // Generate mutated thumbnail preview
    let mutatedThumbnailPath: string | null = null;
    const images = loadCachedImages(localId);
    if (images.length === 0) noCachedImages++;
    if (images.length > 0) {
      try {
        const mutatedBuf = await bridge.previewMutation(images[0], relistCount);
        if (mutatedBuf) {
          const previewDir = itemImageDir(localId);
          const previewPath = path.join(previewDir, '_preview_mutated.jpg');
          fs.writeFileSync(previewPath, mutatedBuf);
          mutatedThumbnailPath = previewPath;
        }
      } catch (err) {
        logger.warn(
          'relist-enqueue-preview-mutation-failed',
          { localId, error: err instanceof Error ? err.message : String(err) },
          requestId,
        );
      }
    }

    // Get first cached image path for thumbnail
    let localPaths: string[] = [];
    if (Array.isArray(item.local_image_paths)) {
      localPaths = item.local_image_paths.map(String);
    } else if (item.local_image_paths) {
      try {
        const parsed = JSON.parse(item.local_image_paths) as unknown;
        localPaths = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('inventory-json-parse-failed', {
          label: 'local_image_paths',
          error: msg,
          sample: String(item.local_image_paths).slice(0, 200),
        });
      }
    }
    const thumbnailPath = localPaths[0] ?? null;

    const entry: RelistQueueEntry = {
      localId,
      title: item.title,
      jitteredTitle,
      price: item.price,
      thumbnailPath,
      mutatedThumbnailPath,
      relistCount,
      status: 'pending',
      enqueuedAt: Date.now(),
    };

    queue.push(entry);
    added.push(entry);
  }

  emitQueueUpdate();

  // Start processing if not already running
  if (!queueProcessing && queue.some((e) => e.status === 'pending')) {
    logger.info('relist-queue-autostart', { pendingCount: queue.filter((e) => e.status === 'pending').length }, requestId);
    processQueue();
  }

  logger.info(
    'relist-enqueue-complete',
    {
      requestedCount: localIds.length,
      addedCount: added.length,
      skippedAlreadyQueued,
      skippedMissingLocal,
      noCachedImages,
      queueSize: queue.length,
      durationMs: Date.now() - startedAtMs,
    },
    requestId,
  );

  return added;
}

/**
 * Remove an item from the queue.
 */
export function dequeueRelist(localId: number): boolean {
  const requestId = crypto.randomUUID();
  const idx = queue.findIndex((e) => e.localId === localId && e.status === 'pending');
  if (idx < 0) {
    logger.debug('relist-dequeue-skip', { localId, reason: 'not_pending_or_missing' }, requestId);
    return false;
  }
  queue.splice(idx, 1);
  emitQueueUpdate();
  logger.info('relist-dequeue', { localId }, requestId);
  return true;
}

/**
 * Clear the entire queue. Aborts processing.
 */
export function clearQueue(): void {
  const requestId = crypto.randomUUID();
  const pendingBefore = queue.filter((e) => e.status === 'pending').length;
  queueAborted = true;
  queue = queue.filter((e) => e.status !== 'pending');
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  nextRelistCountdown = 0;
  emitQueueUpdate();
  logger.info('relist-queue-cleared', { pendingRemoved: pendingBefore }, requestId);
}

/**
 * Get queue timing settings.
 */
export function getQueueSettings(): { minDelay: number; maxDelay: number } {
  const minDelay = settings.getSetting('relist_min_delay');
  const maxDelay = settings.getSetting('relist_max_delay');

  return {
    minDelay: minDelay ?? 30,
    maxDelay: maxDelay ?? 90,
  };
}

/**
 * Set queue timing settings.
 */
export function setQueueSettings(minDelay: number, maxDelay: number): void {
  settings.setSetting('relist_min_delay', minDelay);
  settings.setSetting('relist_max_delay', maxDelay);
}

// ─── Queue Processing Loop ──────────────────────────────────────────────────

async function processQueue(): Promise<void> {
  if (queueProcessing) return;
  queueProcessing = true;
  queueAborted = false;

  const requestId = crypto.randomUUID();
  const startedAtMs = Date.now();
  const pendingCount = queue.filter((e) => e.status === 'pending').length;
  logger.info(
    'relist-queue-started',
    {
      itemCount: pendingCount,
      transportMode: proxyService.getTransportMode(),
      browser_proxy_mode: settings.getSetting('browser_proxy_mode'),
    },
    requestId,
  );

  while (!queueAborted) {
    const entry = queue.find((e) => e.status === 'pending');
    if (!entry) break;

    const itemRequestId = crypto.randomUUID();
    const itemStartedAtMs = Date.now();
    logger.info(
      'relist-item-start',
      { localId: entry.localId, relistCount: entry.relistCount, queueRequestId: requestId },
      itemRequestId,
    );

    try {
      // Step 1: Set status to mutating
      entry.status = 'mutating';
      emitQueueUpdate();

      const item = inventoryDb.getInventoryItem(entry.localId);
      if (!item) {
        entry.status = 'error';
        entry.error = 'Item not found in local vault';
        emitQueueUpdate();
        logger.warn('relist-item-missing', { localId: entry.localId, queueRequestId: requestId }, itemRequestId);
        continue;
      }

      if (!item.vinted_item_id) {
        entry.status = 'error';
        entry.error = 'No Vinted item ID linked — push to Vinted first';
        emitQueueUpdate();
        logger.warn('relist-item-missing-vinted-id', { localId: entry.localId, queueRequestId: requestId }, itemRequestId);
        continue;
      }

      // Step 2: Load cached images
      const imageBuffers = loadCachedImages(entry.localId);
      if (imageBuffers.length === 0) {
        entry.status = 'error';
        entry.error = 'No cached images found';
        emitQueueUpdate();
        logger.warn('relist-item-missing-images', { localId: entry.localId, queueRequestId: requestId }, itemRequestId);
        continue;
      }

      // Mutate images locally (Pillow via bridge) before upload.
      const mutatedBuffers: Buffer[] = [];
      for (const buf of imageBuffers) {
        const mutated = await bridge.previewMutation(buf, entry.relistCount);
        mutatedBuffers.push(mutated ?? buf);
      }
      logger.debug(
        'relist-item-images-mutated',
        { localId: entry.localId, imageCount: imageBuffers.length, relistCount: entry.relistCount, queueRequestId: requestId },
        itemRequestId,
      );

      // Step 3: Set status to uploading
      entry.status = 'uploading';
      emitQueueUpdate();

      // Step 4: Browser-only relist (upload, delete, wait, publish)
      const comp = await getDetailCompleteness(entry.localId);
      if (!comp.ok || !comp.complete) {
        entry.status = 'error';
        entry.error = `Missing required listing fields for relist: ${(comp.ok ? comp.missing : ['unknown']).join(', ')}`;
        emitQueueUpdate();
        logger.warn(
          'relist-item-missing-required-fields',
          { localId: entry.localId, vintedItemId: item.vinted_item_id, missing: comp.ok ? comp.missing : ['unknown'], queueRequestId: requestId },
          itemRequestId,
        );
        continue;
      }

      const itemData = buildVintedItemData(item, { requiresSize: comp.requires_size });

      // Extract photo URLs from local vault (Vinted CDN URLs)
      const photoUrls: string[] = [];
      const rawUrls = item.photo_urls;
      if (Array.isArray(rawUrls)) {
        for (const u of rawUrls) {
          if (typeof u === 'string' && u.startsWith('http')) photoUrls.push(u);
        }
      }
      if (photoUrls.length === 0) {
        entry.status = 'error';
        entry.error = 'No photo URLs found — sync the item first';
        emitQueueUpdate();
        logger.warn('relist-item-no-photo-urls', { localId: entry.localId, queueRequestId: requestId }, itemRequestId);
        continue;
      }

      // Call V2 relist orchestrator on Python bridge
      const relistResult = await bridge.relistItemV2(
        item.vinted_item_id!,
        itemData,
        photoUrls,
        entry.relistCount,
      );

      if (!relistResult.ok) {
        const errResult = relistResult as { code: string; message: string };
        // Surface Datadome errors with a user-friendly prompt
        if (errResult.code === 'DATADOME_CHALLENGE') {
          entry.status = 'error';
          entry.error = 'Bot challenge detected — open Vinted in Chrome and solve the captcha, then retry';
        } else {
          entry.status = 'error';
          entry.error = `Relist failed: [${errResult.code}] ${errResult.message}`;
        }
        emitQueueUpdate();
        logger.warn(
          'relist-item-bridge-error',
          { localId: entry.localId, code: errResult.code, message: errResult.message, queueRequestId: requestId },
          itemRequestId,
        );
        continue;
      }

      // Extract new item ID from bridge response
      // Vinted API wraps items: {item: {id, photos, ...}} — handle both shapes.
      const relistData = (relistResult as { data: { new_item?: Record<string, unknown>; photo_ids?: number[] } }).data;
      const newItemObj = relistData?.new_item;
      const innerItem = (newItemObj?.item as Record<string, unknown> | undefined) ?? newItemObj;
      const newItemId = innerItem?.id ? Number(innerItem.id) : null;
      logger.info(
        'relist-item-new-id-extracted',
        { localId: entry.localId, newItemId, hasItemWrapper: !!newItemObj?.item },
        itemRequestId,
      );

      // Update sync record with new Vinted item ID
      if (newItemId && newItemId > 0) {
        inventoryDb.upsertSyncRecord(entry.localId, newItemId, 'push');

        // ── Relist Identity Transfer ──
        // 1. Delete any duplicate inventory_master row that wardrobe sync may have
        //    already created for the new Vinted item ID (race condition cleanup).
        const duplicate = inventoryDb.getInventoryItemByVintedId(newItemId);
        if (duplicate && duplicate.id !== entry.localId) {
          inventoryDb.deleteInventoryItem(duplicate.id);
          logger.info(
            'relist-identity-transfer-dedup',
            { originalLocalId: entry.localId, duplicateLocalId: duplicate.id, newVintedId: newItemId },
            itemRequestId,
          );
        }

        // 2. Update the original item's status to 'live' so it isn't flagged stale.
        //    Also refresh last_seen_at to prevent the reconciliation sweep from
        //    marking it as 'local_only' / 'removed'.
        const nowUnix = Math.floor(Date.now() / 1000);
        inventoryDb.upsertInventoryItemExplicit({
          id: entry.localId,
          title: item.title,
          price: item.price,
          status: 'live',
          discrepancy_reason: null,
        } as Parameters<typeof inventoryDb.upsertInventoryItemExplicit>[0]);
        inventoryDb.touchLastSeenAt(entry.localId, nowUnix);

        // 3. Extract new photo URLs from the created listing and update local record.
        const newPhotos = (innerItem?.photos as Array<Record<string, unknown>> | undefined) ?? [];
        const newPhotoUrls = newPhotos
          .map((p) => String(p.url || p.full_size_url || ''))
          .filter(Boolean);
        if (newPhotoUrls.length > 0) {
          inventoryDb.updateLocalImagePaths(entry.localId, JSON.stringify([])); // clear stale cached paths
          inventoryDb.upsertInventoryItem({
            id: entry.localId,
            title: item.title,
            price: item.price,
            photo_urls: JSON.stringify(newPhotoUrls),
          } as Parameters<typeof inventoryDb.upsertInventoryItem>[0]);
        }
      }
      inventoryDb.incrementRelistCount(entry.localId);

      // Track photo lineage in inventory_photos
      const photoIds = relistData?.photo_ids ?? [];
      for (let pi = 0; pi < photoUrls.length; pi++) {
        const internalId = `${entry.localId}-photo-${pi}`;
        const vintedPhotoId = pi < photoIds.length ? String(photoIds[pi]) : null;
        inventoryDb.upsertInventoryPhoto(
          internalId,
          String(entry.localId),
          vintedPhotoId,
          entry.relistCount + 1,
          photoUrls[pi],
        );
      }

      entry.status = 'done';
      emitQueueUpdate();
      logger.info(
        'relist-item-done',
        {
          localId: entry.localId,
          oldVintedId: item.vinted_item_id,
          newVintedId: newItemId,
          photoCount: photoIds.length,
          generation: entry.relistCount + 1,
          durationMs: Date.now() - itemStartedAtMs,
          queueRequestId: requestId,
        },
        itemRequestId,
      );


    } catch (err) {
      entry.status = 'error';
      entry.error = String(err);
      emitQueueUpdate();
      logger.error(
        'relist-item-error',
        { localId: entry.localId, error: String(err), durationMs: Date.now() - itemStartedAtMs, queueRequestId: requestId },
        itemRequestId,
      );
    }

    // Wait randomized delay before next item
    if (!queueAborted && queue.some((e) => e.status === 'pending')) {
      const { minDelay, maxDelay } = getQueueSettings();
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      await startCountdown(delay);
    }
  }

  queueProcessing = false;
  logger.info(
    'relist-queue-finished',
    {
      done: queue.filter((e) => e.status === 'done').length,
      errors: queue.filter((e) => e.status === 'error').length,
      durationMs: Date.now() - startedAtMs,
    },
    requestId,
  );
}

async function startCountdown(seconds: number): Promise<void> {
  nextRelistCountdown = Math.ceil(seconds);
  emitQueueUpdate();

  return new Promise<void>((resolve) => {
    countdownInterval = setInterval(() => {
      nextRelistCountdown--;
      emitQueueUpdate();

      if (nextRelistCountdown <= 0 || queueAborted) {
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        nextRelistCountdown = 0;
        resolve();
      }
    }, 1000);
  });
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

/**
 * Abort all pending relists. Called on app quit.
 * Queue is in-memory only — nothing persists.
 */
export function abortQueue(): void {
  const requestId = crypto.randomUUID();
  const pendingBefore = queue.filter((e) => e.status === 'pending').length;
  queueAborted = true;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  queue = [];
  queueProcessing = false;
  nextRelistCountdown = 0;
  logger.info('relist-queue-aborted', { reason: 'app-shutdown', pendingRemoved: pendingBefore }, requestId);
}

// ─── Renderer Communication ─────────────────────────────────────────────────

function emitQueueUpdate(): void {
  const windows = BrowserWindow.getAllWindows();
  const payload = {
    queue: queue.map((e) => ({ ...e })),
    countdown: nextRelistCountdown,
    processing: queueProcessing,
  };
  for (const win of windows) {
    win.webContents.send('wardrobe:queue-update', payload);
  }
}

function emitSyncProgress(
  direction: 'pull' | 'push',
  stage: 'starting' | 'progress' | 'complete' | 'error',
  current: number,
  total: number,
  message?: string
): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('wardrobe:sync-progress', { direction, stage, current, total, message });
  }
}
