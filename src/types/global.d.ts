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

declare global {
  interface Window {
    vinted: {
      storeCookie: (cookie: string) => Promise<void>;
      hasCookie: () => Promise<boolean>;
      clearCookie: () => Promise<void>;
      isEncryptionAvailable: () => Promise<boolean>;
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
    };
  }
}

export {};
