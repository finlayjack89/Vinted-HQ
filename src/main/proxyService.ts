/**
 * Proxy Service — resolves proxy for items based on source URL.
 * Implements "one proxy per search URL" rotation and sticky proxy for checkout.
 * Per initial consultation: residential proxies are supported via http:// or socks5:// URLs.
 */

import * as searchUrls from './searchUrls';
import * as settings from './settings';
import type { FeedItem } from './feedService';

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
  return proxyList[idx % proxyList.length];
}
