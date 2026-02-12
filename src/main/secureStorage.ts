/**
 * Secure storage — OS Keychain via Electron safeStorage
 * Persists encrypted cookie to SQLite settings table.
 */

import { safeStorage } from 'electron';
import { getDb } from './db';

const COOKIE_SETTING_KEY = 'vinted_cookie_enc';

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function storeCookie(cookie: string): void {
  const encrypted = safeStorage.encryptString(cookie);
  const encoded = encrypted.toString('base64');
  const database = getDb();
  if (database) {
    database.prepare(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())'
    ).run(COOKIE_SETTING_KEY, encoded);
  }
}

export function retrieveCookie(): string | null {
  const database = getDb();
  if (!database) return null;
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(COOKIE_SETTING_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    const buffer = Buffer.from(row.value, 'base64');
    return safeStorage.decryptString(buffer);
  } catch {
    return null;
  }
}

export function clearCookie(): void {
  const database = getDb();
  if (database) {
    database.prepare('DELETE FROM settings WHERE key = ?').run(COOKIE_SETTING_KEY);
  }
}

export function hasStoredCookie(): boolean {
  return retrieveCookie() !== null;
}
