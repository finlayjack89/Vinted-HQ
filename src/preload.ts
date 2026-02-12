/**
 * Preload script — exposes safe APIs to renderer via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron';

export type AppSettings = {
  pollingIntervalSeconds: number;
  defaultCourier: string;
  deliveryType: 'home' | 'dropoff';
  latitude: number;
  longitude: number;
  verificationEnabled: boolean;
  verificationThresholdPounds: number;
  authRequiredForPurchase: boolean;
  proxyUrls: string[];
};

contextBridge.exposeInMainWorld('vinted', {
  // Session
  storeCookie: (cookie: string) => ipcRenderer.invoke('session:storeCookie', cookie),
  hasCookie: () => ipcRenderer.invoke('session:hasCookie'),
  clearCookie: () => ipcRenderer.invoke('session:clearCookie'),
  isEncryptionAvailable: () => ipcRenderer.invoke('session:isEncryptionAvailable'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    ipcRenderer.invoke('settings:set', key, value),
  setSettings: (partial: Partial<AppSettings>) => ipcRenderer.invoke('settings:setAll', partial),

  // Python bridge (Phase 2)
  bridgeHealth: () => ipcRenderer.invoke('bridge:health'),
  bridgeSearch: (url: string, page?: number, proxy?: string) =>
    ipcRenderer.invoke('bridge:search', url, page ?? 1, proxy),
  bridgeCheckoutBuild: (orderId: number, proxy?: string) =>
    ipcRenderer.invoke('bridge:checkoutBuild', orderId, proxy),
  bridgeCheckoutPut: (purchaseId: string, components: Record<string, unknown>, proxy?: string) =>
    ipcRenderer.invoke('bridge:checkoutPut', purchaseId, components, proxy),
  bridgeNearbyPickupPoints: (
    shippingOrderId: number,
    lat: number,
    lon: number,
    countryCode?: string,
    proxy?: string
  ) =>
    ipcRenderer.invoke(
      'bridge:nearbyPickupPoints',
      shippingOrderId,
      lat,
      lon,
      countryCode ?? 'GB',
      proxy
    ),

  // Search URLs (Phase 3)
  getSearchUrls: () => ipcRenderer.invoke('searchUrls:getAll'),
  addSearchUrl: (url: string) => ipcRenderer.invoke('searchUrls:add', url),
  updateSearchUrl: (id: number, updates: { url?: string; enabled?: boolean }) =>
    ipcRenderer.invoke('searchUrls:update', id, updates),
  deleteSearchUrl: (id: number) => ipcRenderer.invoke('searchUrls:delete', id),

  // Feed (Phase 3)
  startFeedPolling: () => ipcRenderer.invoke('feed:startPolling'),
  stopFeedPolling: () => ipcRenderer.invoke('feed:stopPolling'),
  isFeedPolling: () => ipcRenderer.invoke('feed:isPolling'),
  onFeedItems: (callback: (items: unknown[]) => void) => {
    const handler = (_: unknown, items: unknown[]) => callback(items);
    ipcRenderer.on('feed:items', handler);
    return () => ipcRenderer.removeListener('feed:items', handler);
  },
});
