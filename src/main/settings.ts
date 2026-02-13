/**
 * Settings CRUD — key-value store in SQLite
 */

import { getDb } from './db';
import { logger } from './logger';

export interface AppSettings {
  pollingIntervalSeconds: number;
  defaultCourier: string;
  deliveryType: 'home' | 'dropoff';
  latitude: number;
  longitude: number;
  verificationEnabled: boolean;
  verificationThresholdPounds: number;
  authRequiredForPurchase: boolean;
  proxyUrls: string[]; // Legacy - kept for backward compatibility
  scrapingProxies: string[]; // ISP proxies for feed polling/searching
  checkoutProxies: string[]; // Residential proxies for checkout/payments
  simulationMode: boolean;
  autobuyEnabled: boolean;
  sessionAutofillEnabled: boolean;
  sessionAutoSubmitEnabled: boolean;
}

const DEFAULTS: AppSettings = {
  pollingIntervalSeconds: 5,
  defaultCourier: 'yodel',
  deliveryType: 'dropoff',
  latitude: 51.5074,
  longitude: -0.1278,
  verificationEnabled: false,
  verificationThresholdPounds: 100,
  authRequiredForPurchase: true,
  proxyUrls: [],
  scrapingProxies: [],
  checkoutProxies: [],
  simulationMode: true,
  autobuyEnabled: false,
  sessionAutofillEnabled: true,
  sessionAutoSubmitEnabled: false,
};

const SETTINGS_KEYS: (keyof AppSettings)[] = [
  'pollingIntervalSeconds',
  'defaultCourier',
  'deliveryType',
  'latitude',
  'longitude',
  'verificationEnabled',
  'verificationThresholdPounds',
  'authRequiredForPurchase',
  'proxyUrls',
  'scrapingProxies',
  'checkoutProxies',
  'simulationMode',
  'autobuyEnabled',
  'sessionAutofillEnabled',
  'sessionAutoSubmitEnabled',
];

function serialize(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function deserialize(key: keyof AppSettings, value: string): unknown {
  if (key === 'pollingIntervalSeconds' || key === 'latitude' || key === 'longitude' || key === 'verificationThresholdPounds') {
    return parseFloat(value) || DEFAULTS[key];
  }
  if (
    key === 'verificationEnabled' ||
    key === 'authRequiredForPurchase' ||
    key === 'simulationMode' ||
    key === 'autobuyEnabled' ||
    key === 'sessionAutofillEnabled' ||
    key === 'sessionAutoSubmitEnabled'
  ) {
    return value === '1';
  }
  if (key === 'proxyUrls' || key === 'scrapingProxies' || key === 'checkoutProxies') {
    try {
      const arr = JSON.parse(value) as string[];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  return value;
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  const db = getDb();
  if (!db) return DEFAULTS[key];
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return DEFAULTS[key];
  return deserialize(key, row.value) as AppSettings[K];
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())'
  ).run(key, serialize(value));
}

export function getAllSettings(): AppSettings {
  const settings = { ...DEFAULTS };
  for (const key of SETTINGS_KEYS) {
    settings[key] = getSetting(key);
  }
  return settings;
}

export function setAllSettings(settings: Partial<AppSettings>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined && key in DEFAULTS) {
      setSetting(key as keyof AppSettings, value as AppSettings[keyof AppSettings]);
    }
  }
}

/**
 * Check if legacy proxy settings need migration to new proxy pools.
 * Logs a warning if legacy proxyUrls exist but new pools are empty.
 */
export function migrateProxySettings(): void {
  const legacy = getSetting('proxyUrls');
  const scraping = getSetting('scrapingProxies');
  const checkout = getSetting('checkoutProxies');
  
  if (legacy.length > 0 && scraping.length === 0 && checkout.length === 0) {
    logger.info('proxy-migration-needed', { 
      message: 'Legacy proxy URLs detected. Configure separate ISP/residential proxies in settings.',
      legacyCount: legacy.length
    });
  }
}
