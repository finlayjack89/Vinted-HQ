/**
 * Preload script — exposes safe APIs to renderer via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron';

export type SniperCountdownParams = {
  countdownId: string;
  item: { id: number; title: string; price: string; [k: string]: unknown };
  sniper: { id: number; name: string };
  secondsLeft: number;
};

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
  simulationMode: boolean;
  autobuyEnabled: boolean;
  sessionAutofillEnabled: boolean;
  sessionAutoSubmitEnabled: boolean;
};

contextBridge.exposeInMainWorld('vinted', {
  // Session
  storeCookie: (cookie: string) => ipcRenderer.invoke('session:storeCookie', cookie),
  hasCookie: () => ipcRenderer.invoke('session:hasCookie'),
  clearCookie: () => ipcRenderer.invoke('session:clearCookie'),
  isEncryptionAvailable: () => ipcRenderer.invoke('session:isEncryptionAvailable'),
  getVintedUserId: () => ipcRenderer.invoke('session:getVintedUserId') as Promise<number | null>,
  startCookieRefresh: () => ipcRenderer.invoke('session:startCookieRefresh'),
  saveLoginCredentials: (username: string, password: string) =>
    ipcRenderer.invoke('session:saveLoginCredentials', username, password),
  hasLoginCredentials: () => ipcRenderer.invoke('session:hasLoginCredentials'),
  clearLoginCredentials: () => ipcRenderer.invoke('session:clearLoginCredentials'),

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
  checkoutBuy: (item: { id: number; order_id?: number; price: string; [k: string]: unknown }, proxy?: string) =>
    ipcRenderer.invoke('checkout:buy', item, proxy),
  onCheckoutProgress: (callback: (step: string) => void) => {
    const handler = (_: unknown, step: string) => callback(step);
    ipcRenderer.on('checkout:progress', handler);
    return () => ipcRenderer.removeListener('checkout:progress', handler);
  },
  onCheckout3dsRequired: (callback: (params: { redirectUrl: string; purchaseId: string }) => void) => {
    const handler = (_: unknown, params: { redirectUrl: string; purchaseId: string }) => callback(params);
    ipcRenderer.on('checkout:3ds-required', handler);
    return () => ipcRenderer.removeListener('checkout:3ds-required', handler);
  },
  getSnipers: () => ipcRenderer.invoke('snipers:getAll'),
  addSniper: (data: { name: string; price_max?: number; keywords?: string; condition?: string; budget_limit?: number }) =>
    ipcRenderer.invoke('snipers:add', data),
  updateSniper: (id: number, updates: { name?: string; price_max?: number; keywords?: string; condition?: string; budget_limit?: number; enabled?: boolean }) =>
    ipcRenderer.invoke('snipers:update', id, updates),
  deleteSniper: (id: number) => ipcRenderer.invoke('snipers:delete', id),
  getSniperSpent: (id: number) => ipcRenderer.invoke('snipers:getSpent', id),
  cancelSniperCountdown: (countdownId: string) => ipcRenderer.invoke('sniper:cancelCountdown', countdownId),
  onSniperCountdown: (callback: (params: SniperCountdownParams) => void) => {
    const handler = (_: unknown, params: SniperCountdownParams) => callback(params);
    ipcRenderer.on('sniper:countdown', handler);
    return () => ipcRenderer.removeListener('sniper:countdown', handler);
  },
  onSniperCountdownDone: (callback: (params: { countdownId: string; simulated?: boolean; ok?: boolean; message: string }) => void) => {
    const handler = (_: unknown, params: { countdownId: string; simulated?: boolean; ok?: boolean; message: string }) => callback(params);
    ipcRenderer.on('sniper:countdown-done', handler);
    return () => ipcRenderer.removeListener('sniper:countdown-done', handler);
  },
  onSessionExpired: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('session:expired', handler);
    return () => ipcRenderer.removeListener('session:expired', handler);
  },
  getLogs: (opts?: { level?: string; event?: string; since?: number; before?: number; limit?: number; offset?: number }) =>
    ipcRenderer.invoke('logs:getAll', opts),
  getPurchases: (limit?: number) => ipcRenderer.invoke('purchases:getAll', limit),
  onSessionReconnected: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('session:reconnected', handler);
    return () => ipcRenderer.removeListener('session:reconnected', handler);
  },
  onFeedItems: (callback: (items: unknown[]) => void) => {
    const handler = (_: unknown, items: unknown[]) => callback(items);
    ipcRenderer.on('feed:items', handler);
    return () => ipcRenderer.removeListener('feed:items', handler);
  },

  // ─── Wardrobe / Inventory Vault ─────────────────────────────────────────

  getWardrobe: (filter?: { status?: string }) =>
    ipcRenderer.invoke('wardrobe:getAll', filter),
  getWardrobeItem: (localId: number) =>
    ipcRenderer.invoke('wardrobe:getItem', localId),
  upsertWardrobeItem: (data: { title: string; price: number; id?: number; [k: string]: unknown }) =>
    ipcRenderer.invoke('wardrobe:upsertItem', data),
  deleteWardrobeItem: (localId: number) =>
    ipcRenderer.invoke('wardrobe:deleteItem', localId),
  pullFromVinted: (userId: number) =>
    ipcRenderer.invoke('wardrobe:pullFromVinted', userId),
  pushToVinted: (localId: number, proxy?: string) =>
    ipcRenderer.invoke('wardrobe:pushToVinted', localId, proxy),

  // ─── Relist Queue (Waiting Room) ────────────────────────────────────────

  getRelistQueue: () =>
    ipcRenderer.invoke('wardrobe:getQueue'),
  enqueueRelist: (localIds: number[]) =>
    ipcRenderer.invoke('wardrobe:enqueueRelist', localIds),
  dequeueRelist: (localId: number) =>
    ipcRenderer.invoke('wardrobe:dequeueRelist', localId),
  clearRelistQueue: () =>
    ipcRenderer.invoke('wardrobe:clearQueue'),
  getQueueSettings: () =>
    ipcRenderer.invoke('wardrobe:getQueueSettings'),
  setQueueSettings: (minDelay: number, maxDelay: number) =>
    ipcRenderer.invoke('wardrobe:setQueueSettings', minDelay, maxDelay),
  onQueueUpdate: (callback: (data: { queue: unknown[]; countdown: number; processing: boolean }) => void) => {
    const handler = (_: unknown, data: { queue: unknown[]; countdown: number; processing: boolean }) => callback(data);
    ipcRenderer.on('wardrobe:queue-update', handler);
    return () => ipcRenderer.removeListener('wardrobe:queue-update', handler);
  },

  // ─── Ontology ───────────────────────────────────────────────────────────

  refreshOntology: () =>
    ipcRenderer.invoke('wardrobe:refreshOntology'),
  getOntology: (entityType: string) =>
    ipcRenderer.invoke('wardrobe:getOntology', entityType),
  onOntologyAlert: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('wardrobe:ontology-alert', handler);
    return () => ipcRenderer.removeListener('wardrobe:ontology-alert', handler);
  },

  // ─── Sync Progress ─────────────────────────────────────────────────────

  onSyncProgress: (callback: (data: { direction: string; stage: string; current: number; total: number }) => void) => {
    const handler = (_: unknown, data: { direction: string; stage: string; current: number; total: number }) => callback(data);
    ipcRenderer.on('wardrobe:sync-progress', handler);
    return () => ipcRenderer.removeListener('wardrobe:sync-progress', handler);
  },
});
