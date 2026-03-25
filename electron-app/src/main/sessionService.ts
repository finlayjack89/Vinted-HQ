/**
 * Session Service — detect and broadcast session expiry to renderer.
 * Deduplicates expired events so the user is only alerted once per expiry window.
 *
 * Extension Session Sync: polls the Python bridge HTTP API for session data
 * written by the Chrome Extension harvester. When detected, stores the cookie
 * directly via secureStorage and emits session:reconnected.
 */

import { BrowserWindow } from 'electron';
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
const FAST_POLL_INTERVAL_MS = 1_000;     // 1 second (during active sync)

/** Pending reconnect waiters — resolved when emitSessionReconnected() fires. */
let reconnectWaiters: Array<() => void> = [];

/** Whether we're in fast-polling mode (during active extension sync). */
let fastPolling = false;

/** Whether a sync operation is in progress — suppresses emitSessionExpired() */
let syncInProgress = false;

export function emitSessionExpired(): void {
  // Suppress expired events while sync is actively running —
  // the feed poller will fire SESSION_EXPIRED on every cycle when the cookie
  // is cleared, which fights the sync by re-showing the modal.
  if (syncInProgress) return;
  if (expiredEmitted) return;
  expiredEmitted = true;

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.isDestroyed()) {
      win.webContents.send(CHANNEL_EXPIRED);
    }
  }
}

export function emitSessionReconnected(): void {
  expiredEmitted = false;

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.isDestroyed()) {
      win.webContents.send(CHANNEL_RECONNECTED);
    }
  }

  // Resolve any pending waitForReconnect() promises
  const waiters = reconnectWaiters;
  reconnectWaiters = [];
  for (const resolve of waiters) resolve();
}

export function isSessionExpiredError(result: { ok: boolean; code?: string }): boolean {
  return !result.ok && (result.code === 'SESSION_EXPIRED' || result.code === 'MISSING_COOKIE');
}

// ─── Extension Session Polling ──────────────────────────────────────────────

/** Bridge response shape for /session/latest */
interface BridgeSessionStatus {
  ok: boolean;
  has_cookie: boolean;
  cookie_header: string | null;
  synced_at: number;
}

/** The core poll tick — polls the Python bridge HTTP API for session status.
 *  The bridge opens a FRESH sqlite3 connection each request, so it always
 *  sees the latest writes (no better-sqlite3 stale cache issues).
 *  When a new session is detected, the cookie is stored directly via
 *  secureStorage.storeCookie() — no local SQLite reads needed. */
async function doPollOnce(): Promise<void> {
  try {
    const resp = await fetch('http://localhost:37421/session/latest');
    if (!resp.ok) return;
    const data = await resp.json() as BridgeSessionStatus;
    if (!data.ok || !data.has_cookie || !data.cookie_header) return;

    const syncedAt = data.synced_at || 0;
    if (syncedAt <= lastKnownSyncedAt) return;

    lastKnownSyncedAt = syncedAt;
    console.log('[SessionService] New extension session detected via bridge', { synced_at: syncedAt });

    // Store the cookie directly from the bridge response — bypasses local SQLite entirely.
    // This is the key fix: we never read vinted_cookie_plain via better-sqlite3.
    secureStorage.storeCookie(data.cookie_header);
    console.log('[SessionService] Extension session stored to secure storage');
    emitSessionReconnected();

    // Notify renderer about session source
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents && !win.isDestroyed()) {
        win.webContents.send(CHANNEL_SESSION_SOURCE, 'extension');
      }
    }
  } catch (err) {
    // Bridge may not be running yet — this is expected during startup
    if (fastPolling) {
      console.warn('[SessionService] Session poll error (fast mode)', { error: String(err) });
    }
  }
}

/** Restart the polling interval at the current rate. */
function restartPolling(): void {
  if (pollIntervalId) clearInterval(pollIntervalId);
  const interval = fastPolling ? FAST_POLL_INTERVAL_MS : SESSION_POLL_INTERVAL_MS;
  pollIntervalId = setInterval(doPollOnce, interval);
}

/**
 * Start polling for extension-synced session data.
 * Call once during app initialization.
 */
export function startSessionPolling(): void {
  if (pollIntervalId) return;

  // Seed the initial baseline from the bridge so we don't trigger on existing data
  fetch('http://localhost:37421/session/latest')
    .then(r => r.json())
    .then((data: BridgeSessionStatus) => {
      if (data.ok && data.synced_at) {
        lastKnownSyncedAt = data.synced_at;
      }
    })
    .catch(() => { /* bridge not ready — will seed on first successful poll */ });

  console.log('[SessionService] Starting extension session polling', { interval: SESSION_POLL_INTERVAL_MS });
  pollIntervalId = setInterval(doPollOnce, SESSION_POLL_INTERVAL_MS);
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

/**
 * Reset the sync baseline so sessionService treats the next
 * session_synced_at value as new. Called when clearing a stale cookie
 * to ensure the next extension harvest is detected fresh.
 */
export function resetSyncBaseline(): void {
  lastKnownSyncedAt = 0;
}

/**
 * Enable or disable fast polling (1s instead of 10s).
 * Used during active extension sync operations to reduce detection latency.
 */
export function setFastPolling(enabled: boolean): void {
  if (fastPolling === enabled) return;
  fastPolling = enabled;
  console.log('[SessionService] Fast polling', enabled ? 'enabled (1s)' : 'disabled (10s)');
  if (pollIntervalId) restartPolling();
}

/**
 * Mark that a sync operation is in progress.
 * While true, emitSessionExpired() is suppressed to prevent
 * the feed poller from re-showing the modal during sync.
 */
export function setSyncInProgress(active: boolean): void {
  syncInProgress = active;
  if (active) {
    // Also reset the expired flag so we can re-emit after sync completes if needed
    expiredEmitted = false;
  }
}

/**
 * Wait for a session reconnection event, with timeout.
 * Returns true if reconnected within the timeout, false if timed out.
 * Used by the sync-from-extension IPC handler.
 */
export function waitForReconnect(timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reconnectWaiters = reconnectWaiters.filter(r => r !== onReconnect);
      resolve(false);
    }, timeoutMs);

    const onReconnect = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(true);
    };

    reconnectWaiters.push(onReconnect);
  });
}
