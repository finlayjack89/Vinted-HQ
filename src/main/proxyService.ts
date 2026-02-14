/**
 * Proxy Service — resolves proxy for items based on source URL.
 * Implements round-robin rotation across poll cycles with FORBIDDEN cooldown.
 * Per initial consultation: residential proxies are supported via http:// or socks5:// URLs.
 */

import * as searchUrls from './searchUrls';
import * as settings from './settings';
import type { FeedItem } from './feedService';

/* ── Cooldown tracking ── */
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown for FORBIDDEN proxies
const cooledDown = new Map<string, number>(); // normalized proxy → unblock timestamp

/* ── Round-robin counter for scraping proxies ── */
let scrapingCycle = 0;

/**
 * Normalize a proxy string to a URL that curl_cffi understands.
 * Accepts formats:
 *   - Already a URL: "http://user:pass@host:port" or "socks5://host:port" → returned as-is
 *   - host:port:user:pass → "http://user:pass@host:port"
 *   - host:port           → "http://host:port"
 */
function normalizeProxy(raw: string): string {
  if (!raw) return raw;
  // Already a URL scheme — pass through
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('socks5://') || raw.startsWith('socks4://')) {
    return raw;
  }
  const parts = raw.split(':');
  if (parts.length === 4) {
    // host:port:user:pass → http://user:pass@host:port
    const [host, port, user, pass] = parts;
    return `http://${user}:${pass}@${host}:${port}`;
  }
  if (parts.length === 2) {
    // host:port → http://host:port
    return `http://${raw}`;
  }
  // Unknown format — return as-is and let curl report the error
  return raw;
}

/** Check if a proxy is currently in cooldown (was recently FORBIDDEN). */
function isProxyCooledDown(proxy: string): boolean {
  const until = cooledDown.get(proxy);
  if (!until) return false;
  if (Date.now() >= until) {
    cooledDown.delete(proxy); // Cooldown expired, remove it
    return false;
  }
  return true;
}

/**
 * Mark a proxy as FORBIDDEN — puts it in cooldown for COOLDOWN_MS.
 * Called by feedService when a poll returns FORBIDDEN.
 */
export function markProxyForbidden(proxy: string): void {
  if (!proxy) return;
  cooledDown.set(proxy, Date.now() + COOLDOWN_MS);
}

/**
 * Advance the scraping round-robin counter.
 * Called once at the start of each poll cycle by feedService.
 */
export function advanceScrapingCycle(): void {
  scrapingCycle++;
}

/**
 * Get the count of configured scraping proxies.
 */
export function getScrapingProxyCount(): number {
  const scrapers = settings.getSetting('scrapingProxies') ?? [];
  if (scrapers.length > 0) return scrapers.length;
  const legacy = settings.getSetting('proxyUrls') ?? [];
  return legacy.length;
}

/**
 * Get the cooldown state of all scraping proxies (for logging).
 */
export function getScrapingProxyStatus(): { total: number; cooledDown: string[]; active: string[] } {
  const scrapers = settings.getSetting('scrapingProxies') ?? [];
  const pool = scrapers.length > 0 ? scrapers : (settings.getSetting('proxyUrls') ?? []);
  const cooledList: string[] = [];
  const activeList: string[] = [];
  for (const raw of pool) {
    const norm = normalizeProxy(raw);
    if (isProxyCooledDown(norm)) {
      cooledList.push(norm);
    } else {
      activeList.push(norm);
    }
  }
  return { total: pool.length, cooledDown: cooledList, active: activeList };
}

/**
 * Get the proxy to use for a feed item (sticky proxy for checkout).
 * Maps item.source_urls[0] to the proxy assigned to that search URL.
 * Uses one proxy per search URL (index-based); supports residential proxies.
 */
export function getProxyForItem(item: FeedItem): string | undefined {
  const sourceUrl = item.source_urls?.[0];
  if (!sourceUrl) return undefined;

  const urls = searchUrls.getEnabledSearchUrls();
  const idx = urls.findIndex((u) => u.url === sourceUrl);
  if (idx < 0) return undefined;

  return getProxyForUrlIndex(idx);
}

/**
 * Get proxy for a search URL by index (used by feed polling).
 * Round-robin: when more URLs than proxies, cycle through available proxies.
 * When more proxies than URLs, extra proxies are unused.
 */
export function getProxyForUrlIndex(idx: number): string | undefined {
  const proxyList = settings.getSetting('proxyUrls') ?? [];
  if (proxyList.length === 0) return undefined;
  const raw = proxyList[idx % proxyList.length];
  return raw ? normalizeProxy(raw) : undefined;
}

/**
 * Get ISP proxy for scraping/feed polling.
 * Round-robin rotation across poll cycles: each cycle advances to the next proxy.
 * Skips proxies that are in cooldown (recently FORBIDDEN).
 * Falls back to legacy proxyUrls if scrapingProxies is empty.
 * Returns undefined if ALL proxies are in cooldown.
 */
export function getProxyForScraping(urlIndex: number): string | undefined {
  const scrapers = settings.getSetting('scrapingProxies') ?? [];
  if (scrapers.length > 0) {
    // Try each proxy starting from current rotation offset, skip cooled-down ones
    for (let attempt = 0; attempt < scrapers.length; attempt++) {
      const idx = (urlIndex + scrapingCycle + attempt) % scrapers.length;
      const raw = scrapers[idx];
      if (!raw) continue;
      const norm = normalizeProxy(raw);
      if (!isProxyCooledDown(norm)) return norm;
    }
    // All scrapers are in cooldown — return undefined (no proxy)
    return undefined;
  }
  // Fallback to legacy proxyUrls
  return getProxyForUrlIndex(urlIndex);
}

/**
 * Get residential proxy for checkout/payment operations.
 * Uses dedicated checkoutProxies pool for high-trust operations.
 * Distributes items across checkout proxies using item ID hash.
 * Falls back to legacy proxy selection if checkoutProxies is empty.
 */
export function getProxyForCheckout(item: FeedItem): string | undefined {
  const residential = settings.getSetting('checkoutProxies') ?? [];
  if (residential.length > 0) {
    const hash = item.id % residential.length;
    const raw = residential[hash];
    return raw ? normalizeProxy(raw) : undefined;
  }
  // Fallback to legacy logic
  return getProxyForItem(item);
}
