/**
 * Feed Service — polls search URLs, aggregates items, deduplicates.
 * Runs in main process. Emits feed:items via IPC.
 */

import { BrowserWindow } from 'electron';
import * as bridge from './bridge';
import * as searchUrls from './searchUrls';
import * as settings from './settings';
import * as proxyService from './proxyService';
import * as sniperService from './sniperService';
import * as sessionService from './sessionService';
import { logger } from './logger';

const PAGES_PER_URL = 1;

export interface FeedItem {
  id: number;
  title: string;
  price: string;
  currency: string;
  photo_url: string;
  url: string;
  condition?: string;
  size?: string;
  brand?: string;
  seller_login?: string;
  seller_id?: number;
  order_id?: number;
  source_urls: string[];
  fetched_at: number;
}

let pollTimeout: ReturnType<typeof setTimeout> | null = null;
let isPolling = false;

/** Extract items from Vinted API response. Handles items/catalog/products structures. */
function extractItems(data: unknown, sourceUrl: string): FeedItem[] {
  const items: FeedItem[] = [];
  let rawItems: unknown[] = [];

  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.items)) rawItems = d.items;
    else if (d.catalog && typeof d.catalog === 'object' && Array.isArray((d.catalog as Record<string, unknown>).items)) {
      rawItems = (d.catalog as Record<string, unknown>).items as unknown[];
    } else if (Array.isArray(d.products)) rawItems = d.products;
  }

  for (const it of rawItems) {
    const r = it as Record<string, unknown>;
    const id = typeof r.id === 'number' ? r.id : parseInt(String(r.id || 0), 10);
    if (!id) continue;

    const title = String(r.title ?? r.name ?? '');
    const priceObj = r.price as { amount?: string; value?: string } | undefined;
    const price = priceObj ? String(priceObj.amount ?? priceObj.value ?? '0') : String(r.price ?? '0');
    const currency = (priceObj as { currency_code?: string })?.currency_code ?? (r.currency as string) ?? 'GBP';

    const photo = r.photo as { url?: string } | undefined;
    const photo_url = photo?.url ?? (r.photo_url as string) ?? (Array.isArray(r.photos) && (r.photos[0] as { url?: string })?.url) ?? '';

    const path = r.path as string | undefined;
    const url = path ? `https://www.vinted.co.uk${path}` : (r.url as string) ?? '';

    const user = r.user as { login?: string; id?: number } | undefined;
    const order_id = r.order_id as number | undefined;

    items.push({
      id,
      title,
      price,
      currency,
      photo_url,
      url: url || `https://www.vinted.co.uk/items/${id}`,
      condition: r.status as string | undefined,
      size: r.size_title as string | undefined,
      brand: r.brand_title as string | undefined,
      seller_login: user?.login,
      seller_id: user?.id,
      order_id,
      source_urls: [sourceUrl],
      fetched_at: Math.floor(Date.now() / 1000),
    });
  }
  return items;
}

/** Deduplicate by id, merge source_urls. */
function deduplicate(items: FeedItem[]): FeedItem[] {
  const byId = new Map<number, FeedItem>();
  for (const it of items) {
    const existing = byId.get(it.id);
    if (existing) {
      const urls = new Set([...existing.source_urls, ...it.source_urls]);
      existing.source_urls = [...urls];
    } else {
      byId.set(it.id, { ...it });
    }
  }
  return [...byId.values()];
}

/** Sort by fetched_at descending (newest first). */
function sortByNewest(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => b.fetched_at - a.fetched_at);
}

/** Result from pollOneUrl — includes items and whether proxy was FORBIDDEN. */
interface PollResult {
  items: FeedItem[];
  forbidden: boolean;
  proxyUsed?: string;
}

async function pollOneUrl(url: string, proxy?: string): Promise<PollResult> {
  const all: FeedItem[] = [];
  for (let page = 1; page <= PAGES_PER_URL; page++) {
    const result = await bridge.search(url, page, proxy);
    if (!result.ok) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'feedService.ts:pollOneUrl',message:'Poll error details',data:{url,page,code:(result as any).code,msg:(result as any).message,proxy:proxy||'none'},timestamp:Date.now(),hypothesisId:'H1,H2,H5'})}).catch(()=>{});
      // #endregion
      const isForbidden = result.code === 'FORBIDDEN';
      if (sessionService.isSessionExpiredError(result)) {
        sessionService.emitSessionExpired();
      }
      logger.warn('feed:poll-error', { url, page, code: result.code, message: result.message });
      return { items: all, forbidden: isForbidden, proxyUsed: proxy };
    }
    // #region agent log
    if (page === 1) { fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'feedService.ts:pollOneUrl:success',message:'Poll page 1 success',data:{url,itemCount:extractItems(result.data,url).length,proxyUsed:proxy||'none'},timestamp:Date.now(),hypothesisId:'H5,H9'})}).catch(()=>{}); }
    // #endregion
    const items = extractItems(result.data, url);
    all.push(...items);
  }
  return { items: all, forbidden: false, proxyUsed: proxy };
}

async function runPoll(): Promise<void> {
  const urls = searchUrls.getEnabledSearchUrls();
  if (urls.length === 0) return;

  // Advance round-robin so each cycle uses the next proxy in the pool
  proxyService.advanceScrapingCycle();

  // #region agent log
  const _proxyStatus = proxyService.getScrapingProxyStatus();
  fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'feedService.ts:runPoll',message:'Poll cycle starting',data:{urlCount:urls.length,proxyTotal:_proxyStatus.total,proxyCooledDown:_proxyStatus.cooledDown.length,proxyActive:_proxyStatus.active.length,activeProxies:_proxyStatus.active,cooledDownProxies:_proxyStatus.cooledDown},timestamp:Date.now(),hypothesisId:'H10'})}).catch(()=>{});
  // #endregion

  const allItems: FeedItem[] = [];

  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    const proxy = proxyService.getProxyForScraping(i);

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'feedService.ts:runPoll:proxySelected',message:'Proxy selected for URL',data:{urlIndex:i,url:u.url.substring(0,80),proxy:proxy||'none'},timestamp:Date.now(),hypothesisId:'H10'})}).catch(()=>{});
    // #endregion

    try {
      const result = await pollOneUrl(u.url, proxy);

      if (result.forbidden && proxy) {
        // Mark this proxy as FORBIDDEN — skip retry, next cycle will use a different proxy
        proxyService.markProxyForbidden(proxy);
        logger.warn('feed:proxy-forbidden', { proxy, url: u.url });

        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'feedService.ts:runPoll:forbidden',message:'Proxy FORBIDDEN, marked cooldown, skipping retry',data:{forbiddenProxy:proxy,urlIndex:i},timestamp:Date.now(),hypothesisId:'H10'})}).catch(()=>{});
        // #endregion
      } else if (!result.forbidden && proxy) {
        // Successful poll — reset strike counter for this proxy
        proxyService.markProxySuccess(proxy);
      }

      allItems.push(...result.items);
    } catch (err) {
      logger.error('feed:poll-exception', { url: u.url, error: String(err) });
    }
    // Inter-URL jitter: 1-2s random sleep between different search URLs
    // to break up burst patterns. Pages within a URL fire without delay.
    if (i < urls.length - 1) {
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    }
  }

  const deduped = deduplicate(allItems);
  const sorted = sortByNewest(deduped);

  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (win.webContents && !win.isDestroyed()) {
      win.webContents.send('feed:items', sorted);
    }
  }

  sniperService.processItems(sorted);

  logger.info('feed:poll-complete', { urlCount: urls.length, itemCount: sorted.length });
}

/** Get a randomized poll delay with jitter to avoid fixed-interval bot fingerprinting. */
function getJitteredDelay(): number {
  const baseSeconds = settings.getSetting('pollingIntervalSeconds') ?? 5;
  const baseMs = Math.max(3000, baseSeconds * 1000);
  // Add ±30% jitter: e.g. 5s base → 3.5s–6.5s range
  const jitter = baseMs * 0.3;
  return baseMs - jitter + Math.random() * jitter * 2;
}

function scheduleNextPoll(): void {
  if (!isPolling) return;
  const delay = getJitteredDelay();
  pollTimeout = setTimeout(async () => {
    await runPoll();
    scheduleNextPoll();
  }, delay);
}

export function startPolling(): void {
  if (isPolling) return;
  isPolling = true;
  const intervalSeconds = settings.getSetting('pollingIntervalSeconds') ?? 5;

  runPoll();
  scheduleNextPoll();

  logger.info('feed:polling-started', { intervalSeconds, jitter: '±30%' });
}

export function stopPolling(): void {
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
  isPolling = false;
  logger.info('feed:polling-stopped');
}

export function isPollingActive(): boolean {
  return isPolling;
}
