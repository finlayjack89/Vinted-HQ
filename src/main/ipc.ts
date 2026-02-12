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
import type { AppSettings } from './settings';
import { logger } from './logger';

export function registerIpcHandlers(): void {
  // Session / Cookie
  ipcMain.handle('session:storeCookie', (_event, cookie: string) => {
    secureStorage.storeCookie(cookie);
    logger.info('session:stored', { hasCookie: true });
  });

  ipcMain.handle('session:hasCookie', () => secureStorage.hasStoredCookie());

  ipcMain.handle('session:clearCookie', () => {
    secureStorage.clearCookie();
    logger.info('session:cleared');
  });

  ipcMain.handle('session:isEncryptionAvailable', () => secureStorage.isEncryptionAvailable());

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

  // Checkout (Phase 4)
  ipcMain.handle(
    'checkout:buy',
    async (
      _event,
      item: { id: number; order_id?: number; price: string; title: string; [k: string]: unknown },
      proxy?: string
    ) => {
      const result = await checkoutService.runCheckout(item as import('./feedService').FeedItem, proxy);
      return result;
    }
  );
}
