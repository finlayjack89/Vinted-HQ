/**
 * Preload script — exposes safe APIs to renderer via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron';

export type SniperCountdownParams = {
  countdownId: string;
  item: { id: number; title: string; price: string;[k: string]: unknown };
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
  scrapingProxies: string[];
  checkoutProxies: string[];
  simulationMode: boolean;
  autobuyEnabled: boolean;
  sessionAutofillEnabled: boolean;
  sessionAutoSubmitEnabled: boolean;
  transportMode: 'PROXY' | 'DIRECT';
  browser_proxy_mode: 'DIRECT' | 'ISP_DEDICATED';
};

contextBridge.exposeInMainWorld('vinted', {
  // Session
  storeCookie: (cookie: string) => ipcRenderer.invoke('session:storeCookie', cookie),
  hasCookie: () => ipcRenderer.invoke('session:hasCookie'),
  clearCookie: () => ipcRenderer.invoke('session:clearCookie'),
  isEncryptionAvailable: () => ipcRenderer.invoke('session:isEncryptionAvailable'),
  getVintedUserId: () => ipcRenderer.invoke('session:getVintedUserId') as Promise<number | null>,
  startCookieRefresh: () => ipcRenderer.invoke('session:startCookieRefresh'),
  syncFromExtension: () => ipcRenderer.invoke('session:syncFromExtension'),
  saveLoginCredentials: (username: string, password: string) =>
    ipcRenderer.invoke('session:saveLoginCredentials', username, password),
  hasLoginCredentials: () => ipcRenderer.invoke('session:hasLoginCredentials'),
  clearLoginCredentials: () => ipcRenderer.invoke('session:clearLoginCredentials'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    ipcRenderer.invoke('settings:set', key, value),
  setSettings: (partial: Partial<AppSettings>) => ipcRenderer.invoke('settings:setAll', partial),

  // System
  openExternal: (url: string, options?: { background?: boolean }) =>
    ipcRenderer.invoke('openExternal', url, options),

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
  checkoutBuy: (item: { id: number; order_id?: number; price: string;[k: string]: unknown }, proxy?: string) =>
    ipcRenderer.invoke('checkout:buy', item, proxy),
  checkOfferPrice: (itemId: number, sellerId: number): Promise<{ offerPrice: string | null }> =>
    ipcRenderer.invoke('feed:checkOfferPrice', itemId, sellerId),
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
  getSniperHits: (opts?: { limit?: number; simulated?: boolean }) =>
    ipcRenderer.invoke('sniperHits:getAll', opts),
  clearSniperHits: () => ipcRenderer.invoke('sniperHits:clear'),
  onSniperHit: (callback: (hit: unknown) => void) => {
    const handler = (_: unknown, hit: unknown) => callback(hit);
    ipcRenderer.on('sniper:hit', handler);
    return () => ipcRenderer.removeListener('sniper:hit', handler);
  },
  onSessionExpired: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('session:expired', handler);
    return () => ipcRenderer.removeListener('session:expired', handler);
  },
  getLogs: (opts?: { level?: string; event?: string; since?: number; before?: number; limit?: number; offset?: number }) =>
    ipcRenderer.invoke('logs:getAll', opts),
  getPurchases: (limit?: number) => ipcRenderer.invoke('purchases:getAll', limit),
  getSales: (status?: string, page?: number, perPage?: number) =>
    ipcRenderer.invoke('sales:getAll', status ?? 'all', page ?? 1, perPage ?? 20),
  getSaleConversation: (conversationId: number) =>
    ipcRenderer.invoke('sales:getConversation', conversationId),
  upsertSoldOrder: (order: Record<string, unknown>) =>
    ipcRenderer.invoke('sales:upsertSoldOrder', order),
  getSavedOrders: (statusFilter?: string) =>
    ipcRenderer.invoke('sales:getSavedOrders', statusFilter),
  getInventoryByVintedId: (vintedItemId: number) =>
    ipcRenderer.invoke('sales:getInventoryByVintedId', vintedItemId),

  // Purchases (bought orders)
  getPurchasesApi: (status?: string, page?: number, perPage?: number) =>
    ipcRenderer.invoke('purchases:getApi', status ?? 'all', page ?? 1, perPage ?? 20),
  upsertBoughtOrder: (order: Record<string, unknown>) =>
    ipcRenderer.invoke('purchases:upsertBoughtOrder', order),
  getSavedBoughtOrders: (statusFilter?: string) =>
    ipcRenderer.invoke('purchases:getSavedOrders', statusFilter),
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

  // ─── Transport Mode (Hybrid Transport) ──────────────────────────────────

  getTransportMode: () => ipcRenderer.invoke('transport:getMode') as Promise<'PROXY' | 'DIRECT'>,
  setTransportMode: (mode: 'PROXY' | 'DIRECT') =>
    ipcRenderer.invoke('transport:setMode', mode) as Promise<{ ok: boolean; error?: string }>,
  isCheckoutActive: () => ipcRenderer.invoke('transport:isCheckoutActive') as Promise<boolean>,

  // ─── Proxy Status ──────────────────────────────────────────────────────

  getProxyStatus: () => ipcRenderer.invoke('proxy:getStatus'),
  unblockProxy: (proxy: string) => ipcRenderer.invoke('proxy:unblock', proxy),

  // ─── Wardrobe / Inventory Vault ─────────────────────────────────────────

  getWardrobe: (filter?: { status?: string }) =>
    ipcRenderer.invoke('wardrobe:getAll', filter),
  getWardrobeItem: (localId: number) =>
    ipcRenderer.invoke('wardrobe:getItem', localId),
  getDetailCompleteness: (localId: number) =>
    ipcRenderer.invoke('wardrobe:getDetailCompleteness', localId),
  upsertWardrobeItem: (data: { title: string; price: number; id?: number;[k: string]: unknown }) =>
    ipcRenderer.invoke('wardrobe:upsertItem', data),
  deleteWardrobeItem: (localId: number) =>
    ipcRenderer.invoke('wardrobe:deleteItem', localId),
  pullFromVinted: (userId: number) =>
    ipcRenderer.invoke('wardrobe:pullFromVinted', userId),
  pushToVinted: (localId: number, proxy?: string) =>
    ipcRenderer.invoke('wardrobe:pushToVinted', localId, proxy),
  pullLiveToLocal: (localId: number) =>
    ipcRenderer.invoke('wardrobe:pullLiveToLocal', localId),
  editLiveItem: (localId: number, updates: Record<string, unknown>, proxy?: string) =>
    ipcRenderer.invoke('wardrobe:editLiveItem', localId, updates, proxy),

  // ─── Create Listing ─────────────────────────────────────────────────────

  createListing: (formData: Record<string, unknown>, photoPaths: string[]) =>
    ipcRenderer.invoke('wardrobe:createListing', formData, photoPaths) as Promise<{
      ok: boolean; localId?: number; vintedItemId?: number; error?: string;
    }>,
  onCreateProgress: (callback: (data: { step: string; current: number; total: number; message?: string }) => void) => {
    const handler = (_event: unknown, data: { step: string; current: number; total: number; message?: string }) => callback(data);
    ipcRenderer.on('wardrobe:create-progress', handler);
    return () => { ipcRenderer.removeListener('wardrobe:create-progress', handler); };
  },

  // ─── Relist Queue (Waiting Room) ────────────────────────────────────────

  getRelistQueue: () =>
    ipcRenderer.invoke('wardrobe:getQueue'),
  enqueueRelist: (localIds: number[]) =>
    ipcRenderer.invoke('wardrobe:enqueueRelist', localIds),
  dequeueRelist: (localId: number) =>
    ipcRenderer.invoke('wardrobe:dequeueRelist', localId),
  retryRelistSkipDelete: (localId: number) =>
    ipcRenderer.invoke('wardrobe:retryRelistSkipDelete', localId),
  clearRelistQueue: () =>
    ipcRenderer.invoke('wardrobe:clearQueue'),
  getQueueSettings: () =>
    ipcRenderer.invoke('wardrobe:getQueueSettings'),
  setQueueSettings: (minDelay: number, maxDelay: number) =>
    ipcRenderer.invoke('wardrobe:setQueueSettings', minDelay, maxDelay),
  pauseRelistQueue: () =>
    ipcRenderer.invoke('wardrobe:pauseRelistQueue'),
  resumeRelistQueue: () =>
    ipcRenderer.invoke('wardrobe:resumeRelistQueue'),
  loadPersistedQueue: () =>
    ipcRenderer.invoke('wardrobe:loadPersistedQueue') as Promise<{ pending: number[]; interrupted: { localId: number; status: string }[] }>,
  onQueueUpdate: (callback: (data: { queue: unknown[]; countdown: number; processing: boolean; paused: boolean }) => void) => {
    const handler = (_: unknown, data: { queue: unknown[]; countdown: number; processing: boolean; paused: boolean }) => callback(data);
    ipcRenderer.on('wardrobe:queue-update', handler);
    return () => ipcRenderer.removeListener('wardrobe:queue-update', handler);
  },
  onDeleteBlocked: (callback: (data: { localId: number; title: string; reason: string }) => void) => {
    const handler = (_: unknown, data: { localId: number; title: string; reason: string }) => callback(data);
    ipcRenderer.on('wardrobe:delete-blocked', handler);
    return () => ipcRenderer.removeListener('wardrobe:delete-blocked', handler);
  },

  // ─── Ontology ───────────────────────────────────────────────────────────

  refreshOntology: () =>
    ipcRenderer.invoke('wardrobe:refreshOntology'),
  getOntology: (entityType: string) =>
    ipcRenderer.invoke('wardrobe:getOntology', entityType),
  getSizes: (catalogId: number) =>
    ipcRenderer.invoke('wardrobe:getSizes', catalogId),
  openEditDebugWindow: (itemId: number) =>
    ipcRenderer.invoke('wardrobe:openEditDebugWindow', itemId),
  getMaterials: (catalogId: number, itemId?: number, brandId?: number, statusId?: number) =>
    ipcRenderer.invoke('wardrobe:getMaterials', catalogId, itemId, brandId, statusId),
  getPackageSizes: (catalogId: number, itemId?: number) =>
    ipcRenderer.invoke('wardrobe:getPackageSizes', catalogId, itemId),
  getConditions: (catalogId: number) =>
    ipcRenderer.invoke('wardrobe:getConditions', catalogId),
  searchBrands: (keyword: string, categoryId?: number) =>
    ipcRenderer.invoke('wardrobe:searchBrands', keyword, categoryId),
  getModels: (catalogId: number, brandId: number) =>
    ipcRenderer.invoke('wardrobe:getModels', catalogId, brandId),
  deepSync: (vintedItemId: number) =>
    ipcRenderer.invoke('wardrobe:deepSync', vintedItemId),
  getItemDetail: (itemId: number) =>
    ipcRenderer.invoke('wardrobe:getItemDetail', itemId),
  onOntologyAlert: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('wardrobe:ontology-alert', handler);
    return () => ipcRenderer.removeListener('wardrobe:ontology-alert', handler);
  },

  // ─── Sync Progress ─────────────────────────────────────────────────────

  onSyncProgress: (callback: (data: { direction: string; stage: string; current: number; total: number; message?: string }) => void) => {
    const handler = (_: unknown, data: { direction: string; stage: string; current: number; total: number; message?: string }) => callback(data);
    ipcRenderer.on('wardrobe:sync-progress', handler);
    return () => ipcRenderer.removeListener('wardrobe:sync-progress', handler);
  },

  // ─── CRM: Auto-Message & Offer Suite ──────────────────────────────────────

  getCrmConfigs: () =>
    ipcRenderer.invoke('crm:getConfigs'),
  getCrmConfig: (itemId: string) =>
    ipcRenderer.invoke('crm:getConfig', itemId),
  upsertCrmConfig: (config: {
    item_id: string;
    message_text: string | null;
    offer_price: number | null;
    delay_min_minutes: number;
    delay_max_minutes: number;
    send_offer_first: boolean;
    is_active: boolean;
  }) => ipcRenderer.invoke('crm:upsertConfig', config),
  deleteCrmConfig: (itemId: string) =>
    ipcRenderer.invoke('crm:deleteConfig', itemId),
  getCrmLogs: (opts?: { item_id?: string; status?: string; limit?: number }) =>
    ipcRenderer.invoke('crm:getLogs', opts),
  clearCrmLogs: () =>
    ipcRenderer.invoke('crm:clearLogs'),
  startCrm: () =>
    ipcRenderer.invoke('crm:start'),
  stopCrm: () =>
    ipcRenderer.invoke('crm:stop'),
  isCrmRunning: () =>
    ipcRenderer.invoke('crm:isRunning') as Promise<boolean>,
  onCrmActionLog: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('crm:action-log', handler);
    return () => ipcRenderer.removeListener('crm:action-log', handler);
  },

  // Preset messages
  getCrmPresets: () =>
    ipcRenderer.invoke('crm:getPresets'),
  upsertCrmPreset: (preset: { id?: number; name: string; body: string }) =>
    ipcRenderer.invoke('crm:upsertPreset', preset),
  deleteCrmPreset: (id: number) =>
    ipcRenderer.invoke('crm:deletePreset', id),

  // Ignored users
  getCrmIgnoredUsers: () =>
    ipcRenderer.invoke('crm:getIgnoredUsers'),
  addCrmIgnoredUser: (username: string) =>
    ipcRenderer.invoke('crm:addIgnoredUser', username),
  removeCrmIgnoredUser: (username: string) =>
    ipcRenderer.invoke('crm:removeIgnoredUser', username),

  // Backfill past likes
  backfillCrmItem: (itemId: string, backfillHours: number) =>
    ipcRenderer.invoke('crm:backfill', itemId, backfillHours),

  // ─── Vinted User Settings ──────────────────────────────────────────────────

  fetchCurrentUser: (proxy?: string) =>
    ipcRenderer.invoke('bridge:fetchCurrentUser', proxy),
  fetchUserCards: (proxy?: string) =>
    ipcRenderer.invoke('bridge:fetchUserCards', proxy),
  fetchUserAddresses: (proxy?: string) =>
    ipcRenderer.invoke('bridge:fetchUserAddresses', proxy),

  // ─── Item Intelligence ──────────────────────────────────────────────────────

  analyzeItem: (params: {
    mode: 'auth_only' | 'market_only' | 'full';
    tier?: 'essential' | 'pro' | 'ultra';
    deep_research?: boolean;
    listing_title: string;
    listing_description?: string;
    listing_price_gbp: number;
    listing_url?: string;
    photo_urls: string[];
    brand_hint?: string;
    category_hint?: string;
    condition_hint?: string;
    local_id?: number;
    vinted_item_id?: number;
  }) => ipcRenderer.invoke('intelligence:analyze', params) as Promise<{
    ok: boolean; report?: unknown; error?: string;
  }>,
  getIntelligenceReport: (localId: number) =>
    ipcRenderer.invoke('intelligence:getReport', localId),
  getIntelligenceReportByVintedId: (vintedItemId: number) =>
    ipcRenderer.invoke('intelligence:getReportByVintedId', vintedItemId),
  getIntelligenceReports: (limit?: number) =>
    ipcRenderer.invoke('intelligence:getReports', limit ?? 50),
  onIntelligenceProgress: (callback: (data: {
    step: string; status: string; message: string;
    progress_pct?: number; data?: Record<string, unknown>;
  }) => void) => {
    const handler = (_: unknown, data: {
      step: string; status: string; message: string;
      progress_pct?: number; data?: Record<string, unknown>;
    }) => callback(data);
    ipcRenderer.on('intelligence:progress', handler);
    return () => ipcRenderer.removeListener('intelligence:progress', handler);
  },
  getApiKeys: () =>
    ipcRenderer.invoke('intelligence:getApiKeys') as Promise<{ name: string; hasKey: boolean }[]>,
  setApiKey: (name: 'gemini' | 'anthropic' | 'perplexity' | 'serpapi', value: string) =>
    ipcRenderer.invoke('intelligence:setApiKey', name, value),
  clearApiKey: (name: 'gemini' | 'anthropic' | 'perplexity' | 'serpapi') =>
    ipcRenderer.invoke('intelligence:clearApiKey', name),
});
