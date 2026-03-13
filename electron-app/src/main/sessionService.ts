/**
 * Session Service — detect and broadcast session expiry to renderer.
 * Deduplicates expired events so the user is only alerted once per expiry window.
 *
 * Extension Session Sync: polls for session data written to SQLite by the
 * Python bridge (from the Chrome Extension session harvester) and promotes
 * it to encrypted secure storage.
 */

import { BrowserWindow } from 'electron';
import { getDb } from './db';
import * as secureStorage from './secureStorage';

const CHANNEL_EXPIRED = 'session:expired';
const CHANNEL_RECONNECTED = 'session:reconnected';
const CHANNEL_SESSION_SOURCE = 'session:source-updated';

/** Track whether we've already emitted an expiry event that hasn't been resolved. */
let expiredEmitted = false;

/** Last known sync timestamp from extension → bridge pipeline. */
let lastKnownSyncedAt = 0;

/** Polling interval ID. */
let pollIntervalId: NodeJS.Timeout | null = null;

const SESSION_POLL_INTERVAL_MS = 10_000; // 10 seconds

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

// ─── Extension Session Polling ──────────────────────────────────────────────
// Polls SQLite for session_synced_at written by the Python bridge.
// When a new sync is detected, reads the plaintext cookie, promotes it
// to encrypted storage, and emits session:reconnected for instant UI update.

/**
 * Start polling for extension-synced session data.
 * Call once during app initialization.
 */
export function startSessionPolling(): void {
  if (pollIntervalId) return; // Already polling

  // Seed the initial value so we don't trigger on the first poll
  const db = getDb();
  if (db) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('session_synced_at') as { value: string } | undefined;
    if (row?.value) {
      lastKnownSyncedAt = parseInt(row.value, 10) || 0;
    }
  }

  console.log('[SessionService] Starting extension session polling', { interval: SESSION_POLL_INTERVAL_MS });

  pollIntervalId = setInterval(() => {
    try {
      const database = getDb();
      if (!database) return;

      const row = database.prepare('SELECT value FROM settings WHERE key = ?').get('session_synced_at') as { value: string } | undefined;
      if (!row?.value) return;

      const syncedAt = parseInt(row.value, 10) || 0;
      if (syncedAt <= lastKnownSyncedAt) return;

      // New session detected from extension
      lastKnownSyncedAt = syncedAt;
      console.log('[SessionService] New extension session detected', { synced_at: syncedAt });

      // The plaintext cookie should have been written by the bridge.
      // retrieveCookie() already handles the plaintext → encrypted promotion.
      const cookie = secureStorage.retrieveCookie();
      if (cookie) {
        console.log('[SessionService] Extension session promoted to secure storage');
        emitSessionReconnected();

        // Notify renderer about session source for UI display
        const sourceRow = database.prepare('SELECT value FROM settings WHERE key = ?').get('session_source') as { value: string } | undefined;
        const source = sourceRow?.value || 'extension';

        for (const win of BrowserWindow.getAllWindows()) {
          if (win.webContents && !win.isDestroyed()) {
            win.webContents.send(CHANNEL_SESSION_SOURCE, source);
          }
        }
      }
    } catch (err) {
      console.warn('[SessionService] Session poll error', { error: String(err) });
    }
  }, SESSION_POLL_INTERVAL_MS);
}

/**
 * Stop session polling (e.g., on app quit).
 */
export function stopSessionPolling(): void {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

