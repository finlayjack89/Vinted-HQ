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
import * as bridge from './bridge';
import * as inventoryDb from './inventoryDb';
import * as proxyService from './proxyService';
import { logger } from './logger';
import * as settings from './settings';
import { buildLiveSnapshotFromItemData, buildLiveSnapshotFromVintedDetail, hashLiveSnapshot } from './liveSnapshot';

import type { RelistQueueEntry } from '../types/global';

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

/**
 * Pull all listings from Vinted wardrobe into the local Vault.
 * Downloads and caches images. Creates/updates inventory_master + inventory_sync.
 */
export async function pullFromVinted(userId: number): Promise<{
  pulled: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let pulled = 0;
  let page = 1;
  let totalPages = 1;

  // Use any scraping proxy, ignoring cooldown (one-off operation, not polling)
  const proxy = proxyService.getAnyScrapingProxy();

  emitSyncProgress('pull', 'starting', 0, 0);

  while (page <= totalPages) {
    const result = await bridge.fetchWardrobe(userId, page, 20, proxy);
    if (!result.ok) {
      errors.push(`Page ${page}: ${(result as { message?: string }).message}`);
      break;
    }

    const data = (result as { data: unknown }).data as {
      items: Record<string, unknown>[];
      pagination: { total_pages: number; total_entries: number };
    };

    totalPages = data.pagination?.total_pages ?? 1;
    const totalEntries = data.pagination?.total_entries ?? 0;

    for (const vintedItem of data.items) {
      try {
        const vintedId = Number(vintedItem.id);
        const existing = inventoryDb.getInventoryItemByVintedId(vintedId);
        const snapshotFetchedAt = Math.floor(Date.now() / 1000);

        // Ensure the item exists locally so we have a stable localId for caching, etc.
        // For existing items with a stored snapshot, we avoid overwriting local fields
        // until we've compared the live snapshot hash.
        const localId = existing ? existing.id : upsertFromVintedItem(vintedItem);

        // If the item is already marked discrepancy, do not overwrite local fields during sync.
        // We still update snapshot metadata when possible so the user can see if live changed.
        const isDiscrepancy = existing?.status === 'discrepancy';

        // Second pass: fetch full item detail to compute a stable live snapshot hash
        // and (when safe) fill missing fields.
        // NOTE: No proxy — this endpoint is geo-sensitive (non-UK proxies → wrong domain)
        let itemDetail: Record<string, unknown> | null = null;
        let liveHash: string | null = null;
        try {
          const detailResult = await bridge.fetchItemDetail(vintedId);
          if (detailResult.ok) {
            const detailData = (detailResult as { data: unknown }).data as Record<string, unknown>;
            itemDetail = (detailData.item ?? detailData) as Record<string, unknown>;
            liveHash = hashLiveSnapshot(buildLiveSnapshotFromVintedDetail(itemDetail));
          }
        } catch {
          // Item detail fetch failed — we'll fall back to list data where safe.
        }

        if (liveHash) {
          // Always persist the newest snapshot metadata we observed.
          inventoryDb.updateLiveSnapshot(localId, liveHash, snapshotFetchedAt);
        }

        if (isDiscrepancy) {
          // Never overwrite local fields while discrepancy is active.
          pulled++;
          emitSyncProgress('pull', 'progress', pulled, totalEntries);
          continue;
        }

        const prevHash = existing?.live_snapshot_hash ?? null;
        if (prevHash && !liveHash) {
          // We have a baseline snapshot but couldn't fetch a new one to compare.
          // Avoid overwriting local fields without confirming live state.
          pulled++;
          emitSyncProgress('pull', 'progress', pulled, totalEntries);
          continue;
        }
        if (prevHash && liveHash && prevHash !== liveHash) {
          // Live listing changed externally; mark discrepancy and do not overwrite local fields.
          inventoryDb.setInventoryStatus(localId, 'discrepancy');
          pulled++;
          emitSyncProgress('pull', 'progress', pulled, totalEntries);
          continue;
        }

        // Safe to update local from live now.
        // For existing items, upsert list data after snapshot comparison to avoid silent overwrites.
        if (existing) {
          upsertFromVintedItem(vintedItem);
        }
        if (itemDetail) {
          // Re-upsert with full detail data — fills in all the missing fields.
          upsertFromVintedItem(itemDetail);
        }

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

        pulled++;
        emitSyncProgress('pull', 'progress', pulled, totalEntries);
      } catch (err) {
        errors.push(`Item ${vintedItem.id}: ${String(err)}`);
      }
    }

    page++;
  }

  emitSyncProgress('pull', 'complete', pulled, pulled);
  logger.info('wardrobe-pull-complete', { pulled, errors: errors.length });
  return { pulled, errors };
}

/**
 * Convert a Vinted API item object into a local inventory_master record.
 */
function upsertFromVintedItem(vintedItem: Record<string, unknown>): number {
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
  if (vintedItem.brand_id) brandId = Number(vintedItem.brand_id);

  const isDraft = vintedItem.is_draft === true;
  const isHidden = vintedItem.is_hidden === true;
  const isClosed = vintedItem.is_closed === true;
  const isReserved = vintedItem.is_reserved === true;
  // Item is sold when it's closed but NOT a draft (drafts are also "closed" conceptually)
  const isSold = isClosed && !isDraft;

  let status = 'live';
  if (isDraft) status = 'local_only';
  else if (isSold) status = 'sold';
  else if (isReserved) status = 'reserved';
  else if (isHidden) status = 'hidden';

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

  return localId;
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
  const item = inventoryDb.getInventoryItem(localId);
  if (!item) return { ok: false, error: 'Item not found' };

  // If this local record is already linked to a live Vinted listing, "Push" should
  // reconcile by overwriting the live listing with the current local fields (edit),
  // not creating a brand new listing.
  if (item.vinted_item_id) {
    const r = await editLiveItem(
      localId,
      // Minimal upsert to satisfy DB constraints; the actual payload is built from the
      // full local record inside editLiveItem().
      { id: item.id, title: item.title, price: item.price },
      proxy
    );
    if (!r.ok) {
      return { ok: false, vintedItemId: item.vinted_item_id, error: r.error || 'Edit failed' };
    }
    return { ok: true, vintedItemId: item.vinted_item_id };
  }

  const itemData = buildVintedItemData(item);

  const result = await bridge.createListing(itemData, undefined, proxy);
  if (!result.ok) {
    return { ok: false, error: (result as { message?: string }).message ?? 'Create failed' };
  }

  // Extract new item ID from response
  const data = (result as { data: unknown }).data as Record<string, unknown>;
  const newItemId = Number(data.item_id || data.id || 0);

  if (newItemId) {
    inventoryDb.upsertSyncRecord(localId, newItemId, 'push');
    inventoryDb.setInventoryStatus(localId, 'live');
  }

  logger.info('wardrobe-push-complete', { localId, vintedItemId: newItemId });
  return { ok: true, vintedItemId: newItemId };
}

/**
 * Pull the current live Vinted listing details into the local vault.
 * This is used to reconcile a discrepancy when the live listing changed externally
 * and the user chooses to accept the live version as the new local source of truth.
 */
export async function pullLiveToLocal(localId: number): Promise<{ ok: boolean; error?: string }> {
  const existing = inventoryDb.getInventoryItem(localId);
  if (!existing) return { ok: false, error: 'Item not found' };
  const vintedItemId = Number(existing.vinted_item_id || 0);
  if (!vintedItemId) return { ok: false, error: 'No Vinted item ID linked — cannot pull live details' };

  const snapshotFetchedAt = Math.floor(Date.now() / 1000);

  let raw: Record<string, unknown> | null = null;
  let bridgeErr = '';

  // Fast path: Python bridge HTML scrape (can be blocked by bot detection).
  try {
    const r = await bridge.fetchItemDetail(vintedItemId);
    if (r.ok) {
      raw = (r as { ok: true; data: unknown }).data as Record<string, unknown>;
    } else {
      bridgeErr = (r as { ok: false; message: string }).message || (r as { ok: false; code: string }).code;
    }
  } catch (err) {
    bridgeErr = err instanceof Error ? err.message : String(err);
  }

  // Robust fallback: browser extraction in authenticated Chromium context.
  if (!raw) {
    try {
      const { fetchItemDetailViaBrowser, VINTED_EDIT_PARTITION } = await import('./itemDetailBrowser');
      const browserRes = await fetchItemDetailViaBrowser(vintedItemId, { partition: VINTED_EDIT_PARTITION, forceDirect: true });
      if (browserRes.ok) {
        raw = browserRes.data as Record<string, unknown>;
      } else {
        const msg = browserRes.message || 'Failed to fetch live item details';
        return { ok: false, error: bridgeErr ? `${msg} (bridge: ${bridgeErr})` : msg };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: bridgeErr ? `${msg} (bridge: ${bridgeErr})` : msg };
    }
  }

  const live = (raw.item ?? raw) as Record<string, unknown>;
  if (!live.id) live.id = vintedItemId;

  // Overwrite local fields from live and clear discrepancy by applying live status.
  const updatedLocalId = upsertFromVintedItem(live);

  // Record newest snapshot metadata so future syncs don't immediately re-flag discrepancy.
  try {
    const liveHash = hashLiveSnapshot(buildLiveSnapshotFromVintedDetail(live));
    inventoryDb.updateLiveSnapshot(updatedLocalId, liveHash, snapshotFetchedAt);
  } catch {
    /* ignore snapshot issues */
  }

  // Refresh cached photos and clear stale local_image_paths so UI reflects live photos.
  const photos = (live.photos as Record<string, unknown>[] | undefined) ?? [];
  const photoUrls = photos
    .map((p) => String((p as Record<string, unknown>).url || (p as Record<string, unknown>).full_size_url || ''))
    .filter(Boolean);

  const localPaths: string[] = [];
  for (let i = 0; i < photoUrls.length; i++) {
    const cached = await downloadAndCacheImage(photoUrls[i], updatedLocalId, i);
    if (cached) localPaths.push(cached);
  }
  inventoryDb.updateLocalImagePaths(updatedLocalId, JSON.stringify(localPaths));

  logger.info('wardrobe-pull-live-to-local', { localId: updatedLocalId, vintedItemId, cached: localPaths.length });
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
  // 1. Save locally
  inventoryDb.upsertInventoryItem(updates as Parameters<typeof inventoryDb.upsertInventoryItem>[0]);

  // 2. Get the full item from DB (with sync data)
  const item = inventoryDb.getInventoryItem(localId);
  if (!item) return { ok: false, error: 'Item not found after save' };

  // 3. If not linked to a Vinted listing, just save locally
  if (!item.vinted_item_id) {
    logger.info('edit-saved-locally', { localId });
    return { ok: true };
  }

  // 4. Build Vinted API payload from the updated local record
  const itemData = buildVintedItemData(item);

  // 5. Photo handling (add/remove/reorder)
  // The renderer can send a transient `__photo_plan` payload (not persisted in DB)
  // so we can construct `assigned_photos` for the edit call.
  const photoPlan = (updates as unknown as { __photo_plan?: unknown }).__photo_plan as
    | { original_existing_ids?: number[]; items?: { type: string; id?: number; url?: string; path?: string }[] }
    | undefined;

  const uploadSessionId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());
  itemData.temp_uuid = uploadSessionId;

  // Ensure CSRF + anon_id exist before any write call.
  // If they're missing, warm them by loading the edit page in a real browser context.
  const hasCsrf = Boolean(settings.getSetting('csrf_token'));
  const hasAnon = Boolean(settings.getSetting('anon_id'));
  if (!hasCsrf || !hasAnon) {
    try {
      const { fetchViaBrowser, VINTED_EDIT_PARTITION } = await import('./itemDetailBrowser');
      const referer = `https://www.vinted.co.uk/items/${item.vinted_item_id}/edit`;
      await fetchViaBrowser('/api/v2/conversations/stats', {
        method: 'GET',
        referer,
        partition: VINTED_EDIT_PARTITION,
        forceDirect: true,
      });
    } catch (err) {
      logger.warn('edit-token-warm-failed', { localId, error: String(err) });
    }
  }

  if (photoPlan?.items && Array.isArray(photoPlan.items) && photoPlan.items.length > 0) {
    const assigned: { id: number; orientation: number }[] = [];
    const finalRemoteUrls: string[] = [];

    for (const p of photoPlan.items) {
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

            const { uploadPhotoRawViaBrowser, VINTED_EDIT_PARTITION } = await import('./itemDetailBrowser');
            const referer = `https://www.vinted.co.uk/items/${item.vinted_item_id}/edit`;
            const browserUp = await uploadPhotoRawViaBrowser(buf, uploadSessionId, {
              referer,
              filename,
              mimeType,
              partition: VINTED_EDIT_PARTITION,
              forceDirect: true,
            });

            if (!browserUp?.ok || !browserUp.data) {
              const status = browserUp?.status ? Number(browserUp.status) : 0;
              const text = browserUp?.text ? String(browserUp.text) : '';
              throw new Error(browserUp?.error || (status ? `HTTP ${status}: ${text.slice(0, 200)}` : `Photo upload blocked: ${text.slice(0, 200)}`));
            }

            const data = browserUp.data as Record<string, unknown>;
            photoId = Number(data.id || 0);
            photoUrl = data.url ? String(data.url) : '';
          }

          if (photoId > 0) assigned.push({ id: photoId, orientation: 0 });
          if (photoUrl) finalRemoteUrls.push(photoUrl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('edit-photo-upload-failed', { localId, error: msg });
          return { ok: false, error: `Photo upload failed: ${msg}` };
        }
      }
    }

    // Only include assigned_photos if we have real IDs; otherwise let Vinted preserve existing ones.
    if (assigned.length > 0) {
      itemData.assigned_photos = assigned;
    } else {
      delete itemData.assigned_photos;
    }

    // Update local stored URLs with the final set (helps UI reflect the latest).
    if (finalRemoteUrls.length > 0) {
      inventoryDb.upsertInventoryItem({
        id: item.id,
        title: item.title,
        price: item.price,
        photo_urls: JSON.stringify(finalRemoteUrls),
        local_image_paths: JSON.stringify([]),
      } as Parameters<typeof inventoryDb.upsertInventoryItem>[0]);
    }
  } else {
    // No explicit photo plan; do not touch photos.
    delete itemData.assigned_photos;
  }

  // 6. Push to Vinted (browser-only, stable DIRECT identity)
  // We intentionally avoid the Python bridge PUT here because curl_cffi gets
  // scored/blocked more aggressively on write endpoints (403 bot detection),
  // while Chromium-context requests match the user's real session.
  try {
    const { fetchViaBrowser, VINTED_EDIT_PARTITION } = await import('./itemDetailBrowser');
    const referer = `https://www.vinted.co.uk/items/${item.vinted_item_id}/edit`;
    const payload = {
      item: { id: item.vinted_item_id, ...itemData },
      feedback_id: null,
      push_up: false,
      parcel: null,
      upload_session_id: uploadSessionId,
    };

    const browserRes = await fetchViaBrowser(`/api/v2/item_upload/items/${item.vinted_item_id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      referer,
      partition: VINTED_EDIT_PARTITION,
      forceDirect: true,
    });

    if (browserRes?.ok) {
      inventoryDb.setInventoryStatus(localId, 'live');
      inventoryDb.upsertSyncRecord(localId, item.vinted_item_id, 'push');
      // We just authored the live state; record a snapshot so future syncs don't
      // incorrectly mark this item as externally changed.
      try {
        const pushedHash = hashLiveSnapshot(buildLiveSnapshotFromItemData(itemData));
        inventoryDb.updateLiveSnapshot(localId, pushedHash, Math.floor(Date.now() / 1000));
      } catch {
        /* ignore snapshot issues */
      }
      logger.info('edit-pushed-to-vinted-browser', { localId, vintedItemId: item.vinted_item_id });
      return { ok: true };
    }

    const status = browserRes?.status ? Number(browserRes.status) : 0;
    const text = browserRes?.text ? String(browserRes.text) : '';
    const errMsg = browserRes?.error
      ? String(browserRes.error)
      : status
        ? `HTTP ${status}: ${text.slice(0, 300)}`
        : `Edit push failed: ${text.slice(0, 300) || 'Unknown error'}`;

    inventoryDb.setInventoryStatus(localId, 'discrepancy');
    logger.error('edit-push-failed-browser', { localId, vintedItemId: item.vinted_item_id, status, error: errMsg });
    return { ok: false, error: errMsg };
  } catch (err) {
    // Mark as discrepancy since local is different from live
    inventoryDb.setInventoryStatus(localId, 'discrepancy');
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('edit-push-failed-browser-exception', { localId, vintedItemId: item.vinted_item_id, error: msg });
    return { ok: false, error: msg };
  }
}

/**
 * Build Vinted API item_data payload from a local inventory record.
 * Includes ALL fields to ensure relist/edit preserves every detail of the listing.
 */
function buildVintedItemData(item: inventoryDb.InventoryItemJoined): Record<string, unknown> {
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
    is_unisex: item.is_unisex === 1,
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
      const modelMeta = JSON.parse(item.model_metadata);
      if (modelMeta.collection_id || modelMeta.model_id) {
        data.model_metadata = modelMeta;
      }
    } catch { /* ignore parse errors */ }
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
  const added: RelistQueueEntry[] = [];

  for (const localId of localIds) {
    // Skip if already in queue
    if (queue.some((e) => e.localId === localId)) continue;

    const item = inventoryDb.getInventoryItem(localId);
    if (!item) continue;

    const relistCount = inventoryDb.getRelistCount(localId);

    // Compute jittered title preview
    const stripped = item.title.trim();
    const jitteredTitle = relistCount % 2 === 0 ? stripped + ' ' : stripped;

    // Generate mutated thumbnail preview
    let mutatedThumbnailPath: string | null = null;
    const images = loadCachedImages(localId);
    if (images.length > 0) {
      const mutatedBuf = await bridge.previewMutation(images[0], relistCount);
      if (mutatedBuf) {
        const previewDir = itemImageDir(localId);
        const previewPath = path.join(previewDir, '_preview_mutated.jpg');
        fs.writeFileSync(previewPath, mutatedBuf);
        mutatedThumbnailPath = previewPath;
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
    processQueue();
  }

  return added;
}

/**
 * Remove an item from the queue.
 */
export function dequeueRelist(localId: number): boolean {
  const idx = queue.findIndex((e) => e.localId === localId && e.status === 'pending');
  if (idx < 0) return false;
  queue.splice(idx, 1);
  emitQueueUpdate();
  return true;
}

/**
 * Clear the entire queue. Aborts processing.
 */
export function clearQueue(): void {
  queueAborted = true;
  queue = queue.filter((e) => e.status !== 'pending');
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  nextRelistCountdown = 0;
  emitQueueUpdate();
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

  logger.info('relist-queue-started', { itemCount: queue.filter((e) => e.status === 'pending').length });

  while (!queueAborted) {
    const entry = queue.find((e) => e.status === 'pending');
    if (!entry) break;

    try {
      // Step 1: Set status to mutating
      entry.status = 'mutating';
      emitQueueUpdate();

      const item = inventoryDb.getInventoryItem(entry.localId);
      if (!item) {
        entry.status = 'error';
        entry.error = 'Item not found in local vault';
        emitQueueUpdate();
        continue;
      }

      if (!item.vinted_item_id) {
        entry.status = 'error';
        entry.error = 'No Vinted item ID linked — push to Vinted first';
        emitQueueUpdate();
        continue;
      }

      // Step 2: Load cached images
      const imageBuffers = loadCachedImages(entry.localId);
      if (imageBuffers.length === 0) {
        entry.status = 'error';
        entry.error = 'No cached images found';
        emitQueueUpdate();
        continue;
      }

      // Step 3: Set status to uploading
      entry.status = 'uploading';
      emitQueueUpdate();

      // Step 4: Call bridge relist (handles mutation, delete, wait, publish)
      const itemData = buildVintedItemData(item);
      const result = await bridge.relistItem(
        item.vinted_item_id,
        itemData,
        imageBuffers,
        entry.relistCount,
      );

      if (!result.ok) {
        entry.status = 'error';
        entry.error = (result as { message?: string }).message ?? 'Relist failed';
        emitQueueUpdate();
        continue;
      }

      // Step 5: Update sync record with new Vinted item ID
      const resultData = (result as { data: unknown }).data as Record<string, unknown>;
      const newItem = resultData.new_item as Record<string, unknown> | undefined;
      const newItemId = newItem ? Number(newItem.item_id || newItem.id || 0) : 0;

      if (newItemId) {
        inventoryDb.upsertSyncRecord(entry.localId, newItemId, 'push');
      }
      inventoryDb.incrementRelistCount(entry.localId);
      inventoryDb.setInventoryStatus(entry.localId, 'live');

      entry.status = 'done';
      emitQueueUpdate();

      logger.info('relist-item-complete', {
        localId: entry.localId,
        oldVintedId: item.vinted_item_id,
        newVintedId: newItemId,
        relistCount: entry.relistCount + 1,
      });
    } catch (err) {
      entry.status = 'error';
      entry.error = String(err);
      emitQueueUpdate();
      logger.error('relist-item-error', { localId: entry.localId, error: String(err) });
    }

    // Wait randomized delay before next item
    if (!queueAborted && queue.some((e) => e.status === 'pending')) {
      const { minDelay, maxDelay } = getQueueSettings();
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      await startCountdown(delay);
    }
  }

  queueProcessing = false;
  logger.info('relist-queue-finished', {
    done: queue.filter((e) => e.status === 'done').length,
    errors: queue.filter((e) => e.status === 'error').length,
  });
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
  queueAborted = true;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  queue = [];
  queueProcessing = false;
  nextRelistCountdown = 0;
  logger.info('relist-queue-aborted', { reason: 'app-shutdown' });
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
  total: number
): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('wardrobe:sync-progress', { direction, stage, current, total });
  }
}
