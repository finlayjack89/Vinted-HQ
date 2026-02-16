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

/**
 * Extract the Vinted user ID from the stored cookie string.
 * Tries multiple extraction strategies:
 *   1. 'v_uid' cookie (legacy — may not be set)
 *   2. 'access_token_web' JWT payload — contains user ID in 'sub' field
 */
export function getVintedUserId(): number | null {
  const cookie = retrieveCookie();
  if (!cookie) return null;

  // Cookie string is "name1=value1; name2=value2; ..."
  const cookieParts = cookie.split(';').map((p) => p.trim());

  // Strategy 1: Direct v_uid cookie
  for (const part of cookieParts) {
    const [name, ...rest] = part.split('=');
    if (name.trim() === 'v_uid') {
      const value = rest.join('=').trim();
      const num = parseInt(value, 10);
      if (!isNaN(num) && num > 0) return num;
    }
  }

  // Strategy 2: Decode access_token_web JWT
  for (const part of cookieParts) {
    const [name, ...rest] = part.split('=');
    if (name.trim() === 'access_token_web') {
      const token = rest.join('=').trim();
      try {
        // JWT format: header.payload.signature — payload is base64url encoded JSON
        const segments = token.split('.');
        if (segments.length >= 2) {
          // Base64url → base64 → decode
          const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
          const json = Buffer.from(base64, 'base64').toString('utf-8');
          const payload = JSON.parse(json);
          // Vinted JWT uses 'sub' for user ID
          const sub = payload.sub ?? payload.user_id ?? payload.id;
          if (sub) {
            const num = typeof sub === 'number' ? sub : parseInt(String(sub), 10);
            if (!isNaN(num) && num > 0) return num;
          }
        }
      } catch {
        // JWT decode failed, continue
      }
    }
  }

  return null;
}
