/**
 * IPC handlers — bridge between renderer and main process
 */

import { ipcMain } from 'electron';
import * as secureStorage from './secureStorage';
import * as settings from './settings';
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
}
