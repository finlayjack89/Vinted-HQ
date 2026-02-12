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
});
