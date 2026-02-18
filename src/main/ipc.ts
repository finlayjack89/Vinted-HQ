/**
 * IPC handlers — bridge between renderer and main process
 */

import { ipcMain } from 'electron';
import * as secureStorage from './secureStorage';
import * as settings from './settings';
import * as bridge from './bridge';
import * as searchUrls from './searchUrls';
import * as feedService from './feedService';
import * as checkoutService from './checkoutService';
import * as proxyService from './proxyService';
import * as snipers from './snipers';
import * as sniperService from './sniperService';
import * as sessionService from './sessionService';
import * as authCapture from './authCapture';
import * as credentialStore from './credentialStore';
import * as logs from './logs';
import * as purchases from './purchases';
import * as inventoryDb from './inventoryDb';
import * as inventoryService from './inventoryService';
import * as ontologyService from './ontologyService';
import type { AppSettings } from './settings';
import { logger } from './logger';

export function registerIpcHandlers(): void {
  // Session / Cookie
  ipcMain.handle('session:storeCookie', (_event, cookie: string) => {
    secureStorage.storeCookie(cookie);
    sessionService.emitSessionReconnected();
    logger.info('session:stored', { hasCookie: true });
  });

  ipcMain.handle('session:hasCookie', () => secureStorage.hasStoredCookie());

  ipcMain.handle('session:clearCookie', () => {
    secureStorage.clearCookie();
    logger.info('session:cleared');
  });

  ipcMain.handle('session:isEncryptionAvailable', () => secureStorage.isEncryptionAvailable());
  ipcMain.handle('session:getVintedUserId', () => secureStorage.getVintedUserId());
  ipcMain.handle('session:startCookieRefresh', () => authCapture.startCookieRefresh());
  ipcMain.handle('session:saveLoginCredentials', (_event, username: string, password: string) =>
    credentialStore.saveLoginCredentials({ username, password })
  );
  ipcMain.handle('session:hasLoginCredentials', () => credentialStore.hasLoginCredentials());
  ipcMain.handle('session:clearLoginCredentials', () => credentialStore.clearLoginCredentials());

  // Settings
  ipcMain.handle('settings:getAll', () => settings.getAllSettings());

  ipcMain.handle('settings:set', (_event, key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
    settings.setSetting(key, value);
    // Keep in-memory transport mode in sync when persisted via settings
    if (key === 'transportMode' && (value === 'PROXY' || value === 'DIRECT')) {
      proxyService.setTransportMode(value as proxyService.TransportMode);
    }
    logger.info('settings:updated', { key });
  });

  ipcMain.handle('settings:setAll', (_event, partial: Partial<AppSettings>) => {
    settings.setAllSettings(partial);
    logger.info('settings:updated', { keys: Object.keys(partial) });
  });

  // Python bridge (Phase 2)
  ipcMain.handle('bridge:health', () => bridge.healthCheck());

  ipcMain.handle(
    'bridge:search',
    (_event, url: string, page: number = 1, proxy?: string) => bridge.search(url, page, proxy)
  );

  ipcMain.handle(
    'bridge:checkoutBuild',
    (_event, orderId: number, proxy?: string) => bridge.checkoutBuild(orderId, proxy)
  );

  ipcMain.handle(
    'bridge:checkoutPut',
    (_event, purchaseId: string, components: Record<string, unknown>, proxy?: string) =>
      bridge.checkoutPut(purchaseId, components, proxy)
  );

  ipcMain.handle(
    'bridge:nearbyPickupPoints',
    (
      _event,
      shippingOrderId: number,
      lat: number,
      lon: number,
      countryCode?: string,
      proxy?: string
    ) => bridge.nearbyPickupPoints(shippingOrderId, lat, lon, countryCode ?? 'GB', proxy)
  );

  // Search URLs (Phase 3)
  ipcMain.handle('searchUrls:getAll', () => searchUrls.getAllSearchUrls());
  ipcMain.handle('searchUrls:add', (_event, url: string) => searchUrls.addSearchUrl(url));
  ipcMain.handle('searchUrls:update', (_event, id: number, updates: { url?: string; enabled?: boolean }) =>
    searchUrls.updateSearchUrl(id, updates)
  );
  ipcMain.handle('searchUrls:delete', (_event, id: number) => searchUrls.deleteSearchUrl(id));

  // Feed (Phase 3)
  ipcMain.handle('feed:startPolling', () => feedService.startPolling());
  ipcMain.handle('feed:stopPolling', () => feedService.stopPolling());
  ipcMain.handle('feed:isPolling', () => feedService.isPollingActive());

  // Snipers (Phase 5)
  ipcMain.handle('snipers:getAll', () => snipers.getAllSnipers());
  ipcMain.handle('snipers:add', (_event, data: Parameters<typeof snipers.addSniper>[0]) => snipers.addSniper(data));
  ipcMain.handle('snipers:update', (_event, id: number, updates: Parameters<typeof snipers.updateSniper>[1]) =>
    snipers.updateSniper(id, updates)
  );
  ipcMain.handle('snipers:delete', (_event, id: number) => snipers.deleteSniper(id));
  ipcMain.handle('snipers:getSpent', (_event, id: number) => snipers.getSniperSpent(id));
  ipcMain.handle('sniper:cancelCountdown', (_event, countdownId: string) => sniperService.cancelCountdown(countdownId));

  // Logs (Phase 6)
  ipcMain.handle('logs:getAll', (_event, opts?: Parameters<typeof logs.getLogs>[0]) => logs.getLogs(opts ?? {}));

  // Purchases (Phase 6)
  ipcMain.handle('purchases:getAll', (_event, limit?: number) => purchases.getAllPurchases(limit));

  // Checkout (Phase 4)
  ipcMain.handle(
    'checkout:buy',
    async (
      _event,
      item: { id: number; order_id?: number; price: string; title: string; source_urls?: string[]; [k: string]: unknown },
      proxy?: string
    ) => {
      const feedItem = item as import('./feedService').FeedItem;
      const resolvedProxy = proxy ?? proxyService.getProxyForCheckout(feedItem);
      const result = await checkoutService.runCheckout(feedItem, resolvedProxy);
      return result;
    }
  );

  // ─── Transport Mode (Hybrid Transport) ──────────────────────────────────

  ipcMain.handle('transport:getMode', () => proxyService.getTransportMode());

  ipcMain.handle('transport:setMode', (_event, mode: string) => {
    const transportMode = mode === 'DIRECT' ? proxyService.TransportMode.DIRECT : proxyService.TransportMode.PROXY;
    const result = proxyService.setTransportMode(transportMode);
    if (result.ok) {
      // Persist to settings DB
      settings.setSetting('transportMode', mode === 'DIRECT' ? 'DIRECT' : 'PROXY');
      logger.info('transport:modeChanged', { mode: transportMode });
    }
    return result;
  });

  ipcMain.handle('transport:isCheckoutActive', () => proxyService.isCheckoutActive());

  // ─── Proxy Status ──────────────────────────────────────────────────────

  ipcMain.handle('proxy:getStatus', () => proxyService.getDetailedProxyStatus());
  ipcMain.handle('proxy:unblock', (_event, proxy: string) => {
    proxyService.unblockProxy(proxy);
    logger.info('proxy:unblocked', { proxy });
    return true;
  });

  // ─── Wardrobe / Inventory Vault ─────────────────────────────────────────

  ipcMain.handle('wardrobe:getAll', (_event, filter?: { status?: string }) =>
    inventoryDb.getAllInventoryItems(filter)
  );

  ipcMain.handle('wardrobe:getItem', (_event, localId: number) =>
    inventoryDb.getInventoryItem(localId)
  );

  ipcMain.handle('wardrobe:upsertItem', (_event, data: Parameters<typeof inventoryDb.upsertInventoryItem>[0]) =>
    inventoryDb.upsertInventoryItem(data)
  );

  ipcMain.handle('wardrobe:deleteItem', (_event, localId: number) =>
    inventoryDb.deleteInventoryItem(localId)
  );

  ipcMain.handle('wardrobe:pullFromVinted', (_event, userId: number) =>
    inventoryService.pullFromVinted(userId)
  );

  ipcMain.handle('wardrobe:pushToVinted', (_event, localId: number, proxy?: string) =>
    inventoryService.pushToVinted(localId, proxy)
  );

  ipcMain.handle('wardrobe:editLiveItem', (_event, localId: number, updates: Record<string, unknown>, proxy?: string) =>
    inventoryService.editLiveItem(localId, updates, proxy)
  );

  // ─── Relist Queue (Waiting Room) ────────────────────────────────────────

  ipcMain.handle('wardrobe:getQueue', () => ({
    queue: inventoryService.getQueue(),
    countdown: inventoryService.getQueueCountdown(),
  }));

  ipcMain.handle('wardrobe:enqueueRelist', (_event, localIds: number[]) =>
    inventoryService.enqueueRelist(localIds)
  );

  ipcMain.handle('wardrobe:dequeueRelist', (_event, localId: number) =>
    inventoryService.dequeueRelist(localId)
  );

  ipcMain.handle('wardrobe:clearQueue', () =>
    inventoryService.clearQueue()
  );

  ipcMain.handle('wardrobe:getQueueSettings', () =>
    inventoryService.getQueueSettings()
  );

  ipcMain.handle('wardrobe:setQueueSettings', (_event, minDelay: number, maxDelay: number) =>
    inventoryService.setQueueSettings(minDelay, maxDelay)
  );

  // ─── Ontology ───────────────────────────────────────────────────────────

  ipcMain.handle('wardrobe:refreshOntology', () =>
    ontologyService.refreshAll()
  );

  ipcMain.handle('wardrobe:getOntology', (_event, entityType: string) => {
    const rows = inventoryDb.getOntologyEntities(entityType);
    // Parse JSON `extra` field before sending to renderer
    return rows.map((r) => ({
      ...r,
      extra: typeof r.extra === 'string' ? (() => { try { return JSON.parse(r.extra as string); } catch { return null; } })() : r.extra,
    }));
  });

  // Category-specific ontology lookups (live API calls)
  // These use the user's session cookie directly (no proxy) since:
  // 1. They're lightweight read-only calls that match normal browser behavior
  // 2. Non-UK proxies cause geo-redirects to wrong Vinted domains (e.g., vinted.fr)
  ipcMain.handle('wardrobe:getSizes', (_event, catalogId: number) =>
    bridge.fetchOntologySizes(catalogId)
  );
  ipcMain.handle('wardrobe:getMaterials', async (_event, catalogId: number, itemId?: number) => {
    // Phase 1: Try Python bridge (historically flaky for this endpoint due to CSRF/fingerprint)
    // const bridgeRes = await bridge.fetchOntologyMaterials(catalogId, itemId);
    // if (bridgeRes.ok && (bridgeRes.data as any)?.attributes?.length > 0) return bridgeRes;

    // Phase 2: Browser Fetch (Robust)
    // Directly execute fetch() inside the authenticated Electron window context
    const { fetchViaBrowser } = await import('./itemDetailBrowser');

    // Ensure we are in the correct context (edit page) to match Vinted's expectations
    const referer = itemId ? `https://www.vinted.co.uk/items/${itemId}/edit` : undefined;

    // We now use the standard catalog items endpoint to fetch attributes implicitly via filters
    // This is safer than the blocked POST /attributes endpoint
    const result = await fetchViaBrowser(`/api/v2/catalog/items?catalog_ids=${catalogId}&per_page=1`, {
      method: 'GET',
      referer
    });

    if (result.ok && result.data) {
      // The catalog endpoint doesn't return attributes directly.
      // We must fetch the ontology for this category from the public ontology endpoint.
      // GET /api/v2/catalogs/{id}/attributes is the correct endpoint for retrieving available fields/materials.
      const ontologyResult = await fetchViaBrowser(`/api/v2/catalogs/${catalogId}/attributes`, {
        method: 'GET',
        referer
      });
      
      if (ontologyResult.ok && ontologyResult.data) {
          return { ok: true, data: ontologyResult.data };
      }
      
      // If that fails, fallback to just returning empty success so the UI doesn't crash,
      // but log the error.
      return { ok: true, data: result.data }; 
    }
    
    // Return detailed error info for debugging (status code, response body snippet)
    return { 
      ok: false, 
      code: 'BROWSER_FETCH_FAILED', 
      message: result.error || `HTTP ${result.status}`,
      details: {
        status: result.status,
        text: result.text ? result.text.slice(0, 500) : null
      }
    };
  });
  ipcMain.handle('wardrobe:getPackageSizes', (_event, catalogId: number, itemId?: number) =>
    bridge.fetchOntologyPackageSizes(catalogId, itemId)
  );
  ipcMain.handle('wardrobe:getConditions', (_event, catalogId: number) =>
    bridge.fetchOntologyConditions(catalogId)
  );
  ipcMain.handle('wardrobe:searchBrands', (_event, keyword: string, categoryId?: number) =>
    bridge.searchBrands(keyword, categoryId)
  );
  ipcMain.handle('wardrobe:getModels', (_event, catalogId: number, brandId: number) =>
    bridge.fetchOntologyModels(catalogId, brandId)
  );
  ipcMain.handle('wardrobe:getItemDetail', async (_event, itemId: number) => {
    // Use a hidden BrowserWindow to load the Vinted item page and extract
    // data via JS injection.  Vinted is a full SPA — the HTML contains only
    // 6 SEO fields; all real data is loaded by JavaScript after hydration.
    // This approach mirrors what dotb.io (Chrome extension) does.
    const { fetchItemDetailViaBrowser } = await import('./itemDetailBrowser');
    return fetchItemDetailViaBrowser(itemId);
  });
}
