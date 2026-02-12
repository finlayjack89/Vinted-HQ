/**
 * Session Service — detect and broadcast session expiry to renderer.
 */

import { BrowserWindow } from 'electron';

const CHANNEL_EXPIRED = 'session:expired';
const CHANNEL_RECONNECTED = 'session:reconnected';

export function emitSessionExpired(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.isDestroyed()) {
      win.webContents.send(CHANNEL_EXPIRED);
    }
  }
}

export function emitSessionReconnected(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.isDestroyed()) {
      win.webContents.send(CHANNEL_RECONNECTED);
    }
  }
}

export function isSessionExpiredError(result: { ok: boolean; code?: string }): boolean {
  return !result.ok && (result.code === 'SESSION_EXPIRED' || result.code === 'MISSING_COOKIE');
}
