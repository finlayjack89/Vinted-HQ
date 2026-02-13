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
      const resolvedProxy = proxy ?? proxyService.getProxyForItem(feedItem);
      const result = await checkoutService.runCheckout(feedItem, resolvedProxy);
      return result;
    }
  );
}
