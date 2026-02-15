/**
 * Global type declarations for renderer
 */

export type Sniper = {
  id: number;
  name: string;
  price_max: number | null;
  keywords: string | null;
  condition: string | null;
  budget_limit: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

export type SniperCountdownParams = {
  countdownId: string;
  item: FeedItem;
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
};

export type BridgeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export type SearchUrl = {
  id: number;
  url: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

export type CheckoutResult = {
  ok: boolean;
  purchaseId?: string;
  redirectUrl?: string;
  message: string;
  code?: string;
};

export type LogEntry = {
  id: number;
  level: string;
  event: string;
  payload: string | null;
  request_id: string | null;
  created_at: number;
};

export type Purchase = {
  id: number;
  item_id: number | null;
  order_id: number | null;
  amount: number | null;
  status: string | null;
  sniper_id: number | null;
  created_at: number;
};

export type FeedItem = {
  id: number;
  title: string;
  price: string;
  currency: string;
  photo_url: string;
  url: string;
  condition?: string;
  size?: string;
  brand?: string;
  seller_login?: string;
  seller_id?: number;
  order_id?: number;
  source_urls: string[];
  fetched_at: number;
};

// ─── Inventory Vault Types ───

export type InventoryItem = {
  id: number;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  category_id: number | null;
  brand_id: number | null;
  brand_name: string | null;
  size_id: number | null;
  size_label: string | null;
  condition: string | null;
  status_id: number | null;
  color_ids: number[];           // parsed from JSON
  photo_urls: string[];          // parsed from JSON
  local_image_paths: string[];   // parsed from JSON
  package_size_id: number | null;
  item_attributes: { code: string; ids: number[] }[];  // parsed from JSON
  is_unisex: boolean;
  status: 'live' | 'local_only' | 'discrepancy' | 'action_required';
  extra_metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  // Sync fields (from inventory_sync join)
  vinted_item_id: number | null;
  relist_count: number;
  last_synced_at: number | null;
  last_relist_at: number | null;
  sync_direction: string | null;
};

export type InventorySyncRecord = {
  id: number;
  local_id: number;
  vinted_item_id: number | null;
  relist_count: number;
  last_synced_at: number | null;
  last_relist_at: number | null;
  sync_direction: string | null;
  created_at: number;
};

export type OntologyEntity = {
  id: number;
  entity_type: 'category' | 'brand' | 'color' | 'condition' | 'size_group';
  entity_id: number;
  name: string;
  slug: string | null;
  parent_id: number | null;
  extra: Record<string, unknown> | null;
  fetched_at: number;
};

export type ProxyStatusEntry = {
  proxy: string;
  provider: string;
  host: string;
  port: string;
  status: 'active' | 'cooldown' | 'blocked';
  strikes: number;
  cooldownUntil: number | null;
  cooldownRemaining: number;
  lastForbiddenAt: number | null;
  lastSuccessAt: number | null;
  pool: 'scraping' | 'checkout';
};

export type RelistQueueEntry = {
  localId: number;
  title: string;
  jitteredTitle: string;
  price: number;
  thumbnailPath: string | null;
  mutatedThumbnailPath: string | null;
  relistCount: number;
  status: 'pending' | 'mutating' | 'uploading' | 'done' | 'error';
  error?: string;
  enqueuedAt: number;
};

export type WardrobeSettings = {
  minDelay: number;   // seconds, default 30
  maxDelay: number;   // seconds, default 90
};

declare global {
  interface Window {
    vinted: {
      storeCookie: (cookie: string) => Promise<void>;
      hasCookie: () => Promise<boolean>;
      clearCookie: () => Promise<void>;
      isEncryptionAvailable: () => Promise<boolean>;
      getVintedUserId: () => Promise<number | null>;
      startCookieRefresh: () => Promise<{ ok: boolean; reason?: string }>;
      saveLoginCredentials: (username: string, password: string) => Promise<void>;
      hasLoginCredentials: () => Promise<boolean>;
      clearLoginCredentials: () => Promise<void>;
      getSettings: () => Promise<AppSettings>;
      setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
      setSettings: (partial: Partial<AppSettings>) => Promise<void>;
      // Python bridge
      bridgeHealth: () => Promise<{ ok: boolean; service?: string }>;
      bridgeSearch: (url: string, page?: number, proxy?: string) => Promise<BridgeResult>;
      bridgeCheckoutBuild: (orderId: number, proxy?: string) => Promise<BridgeResult>;
      bridgeCheckoutPut: (
        purchaseId: string,
        components: Record<string, unknown>,
        proxy?: string
      ) => Promise<BridgeResult>;
      bridgeNearbyPickupPoints: (
        shippingOrderId: number,
        lat: number,
        lon: number,
        countryCode?: string,
        proxy?: string
      ) => Promise<BridgeResult>;
      getSearchUrls: () => Promise<SearchUrl[]>;
      addSearchUrl: (url: string) => Promise<SearchUrl | null>;
      updateSearchUrl: (id: number, updates: { url?: string; enabled?: boolean }) => Promise<SearchUrl | null>;
      deleteSearchUrl: (id: number) => Promise<boolean>;
      startFeedPolling: () => Promise<void>;
      stopFeedPolling: () => Promise<void>;
      isFeedPolling: () => Promise<boolean>;
      onFeedItems: (callback: (items: FeedItem[]) => void) => () => void;
      checkoutBuy: (item: FeedItem, proxy?: string) => Promise<CheckoutResult>;
      onCheckoutProgress: (callback: (step: string) => void) => () => void;
      onCheckout3dsRequired: (callback: (params: { redirectUrl: string; purchaseId: string }) => void) => () => void;
      getSnipers: () => Promise<Sniper[]>;
      addSniper: (data: { name: string; price_max?: number; keywords?: string; condition?: string; budget_limit?: number }) => Promise<Sniper | null>;
      updateSniper: (id: number, updates: Partial<Sniper>) => Promise<Sniper | null>;
      deleteSniper: (id: number) => Promise<boolean>;
      getSniperSpent: (id: number) => Promise<number>;
      cancelSniperCountdown: (countdownId: string) => Promise<boolean>;
      onSniperCountdown: (callback: (params: SniperCountdownParams) => void) => () => void;
      onSniperCountdownDone: (callback: (params: { countdownId: string; simulated?: boolean; ok?: boolean; message: string }) => void) => () => void;
      onSessionExpired: (callback: () => void) => () => void;
      onSessionReconnected: (callback: () => void) => () => void;
      getLogs: (opts?: { level?: string; event?: string; since?: number; before?: number; limit?: number; offset?: number }) => Promise<LogEntry[]>;
      getPurchases: (limit?: number) => Promise<Purchase[]>;

      // Proxy Status
      getProxyStatus: () => Promise<ProxyStatusEntry[]>;
      unblockProxy: (proxy: string) => Promise<boolean>;

      // Wardrobe / Inventory Vault
      getWardrobe: (filter?: { status?: string }) => Promise<InventoryItem[]>;
      getWardrobeItem: (localId: number) => Promise<InventoryItem | undefined>;
      upsertWardrobeItem: (data: { title: string; price: number; id?: number; [k: string]: unknown }) => Promise<number>;
      deleteWardrobeItem: (localId: number) => Promise<boolean>;
      pullFromVinted: (userId: number) => Promise<{ pulled: number; errors: string[] }>;
      pushToVinted: (localId: number, proxy?: string) => Promise<{ ok: boolean; vintedItemId?: number; error?: string }>;

      // Relist Queue (Waiting Room)
      getRelistQueue: () => Promise<{ queue: RelistQueueEntry[]; countdown: number }>;
      enqueueRelist: (localIds: number[]) => Promise<RelistQueueEntry[]>;
      dequeueRelist: (localId: number) => Promise<boolean>;
      clearRelistQueue: () => Promise<void>;
      getQueueSettings: () => Promise<WardrobeSettings>;
      setQueueSettings: (minDelay: number, maxDelay: number) => Promise<void>;
      onQueueUpdate: (callback: (data: { queue: RelistQueueEntry[]; countdown: number; processing: boolean }) => void) => () => void;

      // Ontology
      refreshOntology: () => Promise<void>;
      getOntology: (entityType: string) => Promise<OntologyEntity[]>;
      onOntologyAlert: (callback: (data: { deletedCategories: unknown[]; affectedItems: unknown[] }) => void) => () => void;

      // Sync Progress
      onSyncProgress: (callback: (data: { direction: string; stage: string; current: number; total: number }) => void) => () => void;
    };
  }
}

export {};
