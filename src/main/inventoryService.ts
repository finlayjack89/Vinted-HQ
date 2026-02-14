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
import { logger } from './logger';
import * as settings from './settings';

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

  emitSyncProgress('pull', 'starting', 0, 0);

  while (page <= totalPages) {
    const result = await bridge.fetchWardrobe(userId, page, 20);
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
        const localId = upsertFromVintedItem(vintedItem);

        // Download and cache photos
        const photos = (vintedItem.photos as Record<string, unknown>[] | undefined) ?? [];
        const photoUrls = photos.map((p) => String(p.url || p.full_size_url || ''));
        const localPaths: string[] = [];

        for (let i = 0; i < photoUrls.length; i++) {
          if (photoUrls[i]) {
            const cached = await downloadAndCacheImage(photoUrls[i], localId, i);
            if (cached) localPaths.push(cached);
          }
        }

        // Update local image paths
        if (localPaths.length > 0) {
          inventoryDb.upsertInventoryItem({
            id: localId,
            title: String(vintedItem.title),
            price: parseFloat(String((vintedItem.price as Record<string, unknown>)?.amount ?? vintedItem.price ?? 0)),
            local_image_paths: JSON.stringify(localPaths),
          });
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

  const brandObj = vintedItem.brand as Record<string, unknown> | undefined;

  const isDraft = vintedItem.is_draft === true;
  const isHidden = vintedItem.is_hidden === true;
  const isClosed = vintedItem.is_closed === true;

  let status: string = 'live';
  if (isDraft || isClosed) status = 'local_only';
  if (isHidden) status = 'live'; // hidden items are still "live" on Vinted

  // Check if we already have this Vinted item locally
  const existing = inventoryDb.getInventoryItemByVintedId(vintedId);

  const localId = inventoryDb.upsertInventoryItem({
    id: existing?.id,
    title: String(vintedItem.title || ''),
    description: String(vintedItem.description || ''),
    price,
    currency,
    category_id: vintedItem.catalog_id ? Number(vintedItem.catalog_id) : null,
    brand_id: brandObj?.id ? Number(brandObj.id) : null,
    brand_name: brandObj ? String(brandObj.title || brandObj.name || '') : null,
    size_id: vintedItem.size_id ? Number(vintedItem.size_id) : null,
    size_label: vintedItem.size_title ? String(vintedItem.size_title) : null,
    color_ids: vintedItem.color_ids ? JSON.stringify(vintedItem.color_ids) : null,
    photo_urls: JSON.stringify(photoUrls),
    status,
    extra_metadata: JSON.stringify({
      is_hidden: isHidden,
      is_draft: isDraft,
      is_closed: isClosed,
      favourite_count: vintedItem.favourite_count,
      view_count: vintedItem.view_count,
    }),
  });

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
 * Build Vinted API item_data payload from a local inventory record.
 */
function buildVintedItemData(item: inventoryDb.InventoryItemJoined): Record<string, unknown> {
  const colorIds = item.color_ids ? JSON.parse(item.color_ids) : [];
  const attributes = item.item_attributes ? JSON.parse(item.item_attributes) : [];

  return {
    currency: item.currency || 'GBP',
    temp_uuid: '',
    title: item.title,
    description: item.description || '',
    brand_id: item.brand_id,
    brand: item.brand_name || '',
    size_id: item.size_id,
    catalog_id: item.category_id,
    isbn: null,
    is_unisex: item.is_unisex === 1,
    status_id: item.status_id || 2,
    video_game_rating_id: null,
    price: item.price,
    package_size_id: item.package_size_id || 3,
    shipment_prices: { domestic: null, international: null },
    color_ids: colorIds,
    assigned_photos: [], // Photos handled separately
    measurement_length: null,
    measurement_width: null,
    item_attributes: attributes,
    manufacturer: null,
    manufacturer_labelling: null,
  };
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
    const localPaths = item.local_image_paths ? JSON.parse(item.local_image_paths) as string[] : [];
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
  const db = require('./db').getDb();
  if (!db) return { minDelay: 30, maxDelay: 90 };

  const minRow = db.prepare("SELECT value FROM settings WHERE key = 'relist_min_delay'").get() as { value: string } | undefined;
  const maxRow = db.prepare("SELECT value FROM settings WHERE key = 'relist_max_delay'").get() as { value: string } | undefined;

  return {
    minDelay: minRow ? parseFloat(minRow.value) : 30,
    maxDelay: maxRow ? parseFloat(maxRow.value) : 90,
  };
}

/**
 * Set queue timing settings.
 */
export function setQueueSettings(minDelay: number, maxDelay: number): void {
  const db = require('./db').getDb();
  if (!db) return;
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('relist_min_delay', ?, unixepoch())").run(String(minDelay));
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('relist_max_delay', ?, unixepoch())").run(String(maxDelay));
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
