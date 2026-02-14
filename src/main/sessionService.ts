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
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sessionService.ts:emitSessionExpired',message:'Session expired dedup - suppressed',data:{},timestamp:Date.now(),hypothesisId:'H7'})}).catch(()=>{});
    // #endregion
    return;
  }
  expiredEmitted = true;
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sessionService.ts:emitSessionExpired',message:'Session expired - first emit',data:{},timestamp:Date.now(),hypothesisId:'H7'})}).catch(()=>{});
  // #endregion

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
