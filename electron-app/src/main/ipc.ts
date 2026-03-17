/**
 * IPC handlers — bridge between renderer and main process
 */

import { ipcMain, shell } from 'electron';
import { execFile } from 'child_process';
import { getDb } from './db';
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
import * as crmService from './crmService';
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
    // Emit session expired so the login modal appears immediately
    sessionService.emitSessionExpired();
    logger.info('session:cleared');
  });

  ipcMain.handle('session:isEncryptionAvailable', () => secureStorage.isEncryptionAvailable());
  ipcMain.handle('session:getVintedUserId', () => secureStorage.getVintedUserId());
  ipcMain.handle('session:startCookieRefresh', () => authCapture.startCookieRefresh());

  // 1-Click Extension Sync: pull session data harvested by the Chrome Extension
  ipcMain.handle('session:syncFromExtension', async () => {
    try {
      const db = getDb();
      if (!db) return { ok: false, reason: 'NO_DB' };

      // Helper: check DB for a plaintext cookie written by the extension → bridge pipeline
      const checkForCookie = () => {
        return db.prepare('SELECT value FROM settings WHERE key = ?').get('vinted_cookie_plain') as { value: string } | undefined;
      };

      const promoteCookie = (cookie: string, meta: Record<string, unknown>) => {
        secureStorage.storeCookie(cookie);
        db.prepare('DELETE FROM settings WHERE key = ?').run('vinted_cookie_plain');
        sessionService.emitSessionReconnected();
        logger.info('session:synced-from-extension', meta);
      };

      // 1. Instant check — cookie may already be cached from a recent extension harvest
      const cached = checkForCookie();
      if (cached?.value) {
        promoteCookie(cached.value, { immediate: true });
        return { ok: true, source: 'cached' };
      }

      // 2. Brief poll (3s) — if Vinted is already open in Chrome, the extension
      //    may just need a moment to harvest and POST to the bridge
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const row = checkForCookie();
        if (row?.value) {
          promoteCookie(row.value, { waited_seconds: i + 1, phase: 'pre-open' });
          return { ok: true, source: 'polled', waited: i + 1 };
        }
      }

      // 3. Fallback — Vinted probably isn't open in Chrome; open it specifically in Chrome
      //    (not default browser, which could be Safari — the extension is Chrome-only)
      execFile('open', ['-a', 'Google Chrome', 'https://www.vinted.co.uk/']);
      logger.info('session:sync-opened-chrome', { url: 'https://www.vinted.co.uk/' });

      // 4. Continue polling (45s more) for the extension to harvest after the page loads.
      //    Cold-starting Chrome, loading the page, and bypassing Datadome can easily take 10-20s.
      for (let i = 0; i < 45; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const row = checkForCookie();
        if (row?.value) {
          promoteCookie(row.value, { waited_seconds: i + 4, phase: 'post-open' });
          return { ok: true, source: 'polled', waited: i + 4 };
        }
      }

      return { ok: false, reason: 'EXTENSION_NOT_SYNCED', message: 'Chrome Extension did not sync within 45s. Make sure Vinted HQ extension is installed and Vinted is signed in on Chrome.' };
    } catch (err) {
      logger.error('session:syncFromExtension:error', { error: String(err), stack: err instanceof Error ? err.stack : undefined });
      return { ok: false, reason: 'INTERNAL_ERROR', message: String(err) };
    }
  });
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

  // System — force Chrome so the Vinted HQ extension is available
  ipcMain.handle('openExternal', (_event, url: string, options?: { background?: boolean }) => {
    const args: string[] = [];
    if (options?.background) args.push('-g');
    args.push('-a', 'Google Chrome', url);
    execFile('open', args);
  });

  // Python bridge (Phase 2)
  ipcMain.handle('bridge:health', () => bridge.healthCheck());

  ipcMain.handle(
    'bridge:search',
    (_event, url: string, page = 1, proxy?: string) => bridge.search(url, page, proxy)
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

  // Sales
  ipcMain.handle(
    'sales:getAll',
    (_event, status?: string, page?: number, perPage?: number) =>
      bridge.fetchSales(status ?? 'all', page ?? 1, perPage ?? 20)
  );

  ipcMain.handle(
    'sales:getConversation',
    (_event, conversationId: number) => bridge.fetchConversation(conversationId)
  );

  ipcMain.handle(
    'sales:upsertSoldOrder',
    (_event, order: Parameters<typeof inventoryDb.upsertSoldOrder>[0]) => {
      inventoryDb.upsertSoldOrder(order);
      return { ok: true };
    }
  );

  ipcMain.handle(
    'sales:getSavedOrders',
    (_event, statusFilter?: string) => inventoryDb.getAllSoldOrders(statusFilter)
  );

  ipcMain.handle(
    'sales:getInventoryByVintedId',
    (_event, vintedItemId: number) => inventoryDb.getInventoryItemByVintedId(vintedItemId) ?? null
  );

  // Purchases (bought orders)
  ipcMain.handle(
    'purchases:getApi',
    async (_event, status: string, page: number, perPage: number) =>
      bridge.fetchPurchasesApi(status, page, perPage)
  );
  ipcMain.handle(
    'purchases:upsertBoughtOrder',
    (_event, order: Parameters<typeof inventoryDb.upsertBoughtOrder>[0]) => {
      inventoryDb.upsertBoughtOrder(order);
      return { ok: true };
    }
  );
  ipcMain.handle(
    'purchases:getSavedOrders',
    (_event, statusFilter?: string) => inventoryDb.getAllBoughtOrders(statusFilter)
  );

  // Checkout (Phase 4)
  ipcMain.handle(
    'checkout:buy',
    async (
      _event,
      item: { id: number; order_id?: number; price: string; title: string; source_urls?: string[];[k: string]: unknown },
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

  ipcMain.handle('wardrobe:getDetailCompleteness', (_event, localId: number) =>
    inventoryService.getDetailCompleteness(localId)
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

  ipcMain.handle('wardrobe:pullLiveToLocal', (_event, localId: number) =>
    inventoryService.pullLiveToLocal(localId)
  );

  ipcMain.handle('wardrobe:editLiveItem', (_event, localId: number, updates: Record<string, unknown>, proxy?: string) =>
    inventoryService.editLiveItem(localId, updates, proxy)
  );

  ipcMain.handle('wardrobe:createListing', (_event, formData: Record<string, unknown>, localPhotoPaths: string[]) =>
    inventoryService.createNewListing(formData, localPhotoPaths)
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
  ipcMain.handle('wardrobe:getMaterials', async (_event, catalogId: number, itemId?: number, brandId?: number, statusId?: number) => {
    // Reverted to Python bridge for materials, as browser logic is moving to Chrome Ext
    return bridge.fetchOntologyMaterials(catalogId, itemId, brandId, statusId);
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

  // Fetch full item detail from Vinted (scrapes the item/edit page via Python bridge)
  ipcMain.handle('wardrobe:getItemDetail', (_event, itemId: number) =>
    bridge.fetchItemDetail(itemId)
  );

  // ─── CRM: Auto-Message & Offer Suite ──────────────────────────────────────

  ipcMain.handle('crm:getConfigs', () =>
    inventoryDb.getAllAutoMessageConfigs()
  );
  ipcMain.handle('crm:getConfig', (_event, itemId: string) =>
    inventoryDb.getAutoMessageConfig(itemId)
  );
  ipcMain.handle('crm:upsertConfig', (_event, config: Parameters<typeof inventoryDb.upsertAutoMessageConfig>[0]) => {
    inventoryDb.upsertAutoMessageConfig(config);
    return { ok: true };
  });
  ipcMain.handle('crm:deleteConfig', (_event, itemId: string) => {
    const deleted = inventoryDb.deleteAutoMessageConfig(itemId);
    return { ok: deleted };
  });
  ipcMain.handle('crm:getLogs', (_event, opts?: { item_id?: string; status?: string; limit?: number }) =>
    inventoryDb.getAutoMessageLogs(opts)
  );
  ipcMain.handle('crm:clearLogs', () => {
    inventoryDb.clearAutoMessageLogs();
    return { ok: true };
  });
  ipcMain.handle('crm:start', () => {
    crmService.startCrm();
    return { ok: true };
  });
  ipcMain.handle('crm:stop', () => {
    crmService.stopCrm();
    return { ok: true };
  });
  ipcMain.handle('crm:isRunning', () =>
    crmService.isCrmRunning()
  );

  // Preset messages
  ipcMain.handle('crm:getPresets', () =>
    inventoryDb.getAllAutoMessagePresets()
  );
  ipcMain.handle('crm:upsertPreset', (_event, preset: { id?: number; name: string; body: string }) => {
    const id = inventoryDb.upsertAutoMessagePreset(preset);
    return { ok: true, id };
  });
  ipcMain.handle('crm:deletePreset', (_event, id: number) => {
    const deleted = inventoryDb.deleteAutoMessagePreset(id);
    return { ok: deleted };
  });

  // Ignored users
  ipcMain.handle('crm:getIgnoredUsers', () =>
    inventoryDb.getAllCrmIgnoredUsers()
  );
  ipcMain.handle('crm:addIgnoredUser', (_event, username: string) => {
    inventoryDb.addCrmIgnoredUser(username);
    return { ok: true };
  });
  ipcMain.handle('crm:removeIgnoredUser', (_event, username: string) => {
    const removed = inventoryDb.removeCrmIgnoredUser(username);
    return { ok: removed };
  });

  // Backfill: scan past likes for a specific item
  ipcMain.handle('crm:backfill', async (_event, itemId: string, backfillHours: number) => {
    const config = inventoryDb.getAutoMessageConfig(itemId);
    if (!config) return { ok: false, count: 0, error: 'No config found for item' };
    const count = await crmService.backfillItem(itemId, backfillHours, config);
    return { ok: true, count };
  });
}
