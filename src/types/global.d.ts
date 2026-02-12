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
    };
  }
}

export {};
