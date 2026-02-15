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
  ipcMain.handle('session:getVintedUserId', () => {
    const userId = secureStorage.getVintedUserId();
    // #region agent log
    const cookie = secureStorage.retrieveCookie();
    const cookieKeys = cookie ? cookie.split(';').map((p: string) => p.trim().split('=')[0]) : [];
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ipc.ts:getVintedUserId',message:'getVintedUserId called',data:{userId,hasCookie:!!cookie,cookieKeyCount:cookieKeys.length,cookieKeys:cookieKeys,hasVuid:cookieKeys.includes('v_uid')},timestamp:Date.now(),hypothesisId:'H11'})}).catch(()=>{});
    // #endregion
    return userId;
  });
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

  ipcMain.handle('wardrobe:getAll', (_event, filter?: { status?: string }) => {
    const rows = inventoryDb.getAllInventoryItems(filter);
    // #region agent log
    if (rows.length > 0) {
      const sample = rows[0];
      fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ipc.ts:wardrobe:getAll',message:'Raw DB rows sample',data:{totalRows:rows.length,firstItem_photoUrls_type:typeof sample.photo_urls,firstItem_photoUrls_value:String(sample.photo_urls).substring(0,200),firstItem_localImagePaths_type:typeof sample.local_image_paths,firstItem_localImagePaths_value:String(sample.local_image_paths).substring(0,200),firstItem_colorIds_type:typeof sample.color_ids,firstItem_colorIds_value:String(sample.color_ids).substring(0,100)},timestamp:Date.now(),hypothesisId:'H17'})}).catch(()=>{});
    }
    // #endregion
    return rows;
  });

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

  ipcMain.handle('wardrobe:getOntology', (_event, entityType: string) =>
    inventoryDb.getOntologyEntities(entityType)
  );
}
