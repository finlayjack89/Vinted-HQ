/**
 * Session Service — detect and broadcast session expiry to renderer.
 * Deduplicates expired events so the user is only alerted once per expiry window.
 */

import { BrowserWindow } from 'electron';

const CHANNEL_EXPIRED = 'session:expired';
const CHANNEL_RECONNECTED = 'session:reconnected';

/** Track whether we've already emitted an expiry event that hasn't been resolved. */
let expiredEmitted = false;

export function emitSessionExpired(): void {
  // Only emit once — subsequent poll failures should not re-show the modal
  if (expiredEmitted) {
    return;
  }
  expiredEmitted = true;

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.isDestroyed()) {
      win.webContents.send(CHANNEL_EXPIRED);
    }
  }
}

export function emitSessionReconnected(): void {
  // Reset the dedup flag so future expiries will alert again
  expiredEmitted = false;

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.isDestroyed()) {
      win.webContents.send(CHANNEL_RECONNECTED);
    }
  }
}

export function isSessionExpiredError(result: { ok: boolean; code?: string }): boolean {
  return !result.ok && (result.code === 'SESSION_EXPIRED' || result.code === 'MISSING_COOKIE');
}
