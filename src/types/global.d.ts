/**
 * Global type declarations for renderer
 */

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
    };
  }
}

export {};
