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

  // Primary: encrypted cookie from Electron's own login flow
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(COOKIE_SETTING_KEY) as { value: string } | undefined;
  if (row) {
    try {
      const buffer = Buffer.from(row.value, 'base64');
      return safeStorage.decryptString(buffer);
    } catch {
      // Decrypt failed — fall through to plaintext fallback
    }
  }

  // Fallback: plaintext cookie written by Python bridge (from Chrome Extension session harvest)
  return retrievePlaintextCookie();
}

/**
 * Read the plaintext cookie written by the Python bridge (from extension session harvest).
 * If found and safeStorage is available, promotes it to encrypted storage and cleans up plaintext.
 */
function retrievePlaintextCookie(): string | null {
  const database = getDb();
  if (!database) return null;

  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get('vinted_cookie_plain') as { value: string } | undefined;
  if (!row || !row.value) return null;

  const cookie = row.value;

  // Promote to encrypted storage if possible, then clean up plaintext
  if (safeStorage.isEncryptionAvailable()) {
    try {
      storeCookie(cookie);
      database.prepare('DELETE FROM settings WHERE key = ?').run('vinted_cookie_plain');
    } catch {
      // Non-fatal — the plaintext cookie still works
    }
  }

  return cookie;
}

export function clearCookie(): void {
  const database = getDb();
  if (database) {
    database.prepare('DELETE FROM settings WHERE key = ?').run(COOKIE_SETTING_KEY);
    // Also clear plaintext cookie and sync timestamp written by the Python bridge,
    // otherwise retrieveCookie() will re-promote the stale plaintext as a "new" session.
    database.prepare('DELETE FROM settings WHERE key = ?').run('vinted_cookie_plain');
    database.prepare('DELETE FROM settings WHERE key = ?').run('session_synced_at');
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

// ─── Item Intelligence: API Key Storage ──────────────────────────────────────

const VALID_API_KEY_NAMES = ['gemini', 'anthropic', 'perplexity', 'serpapi'] as const;
export type ApiKeyName = typeof VALID_API_KEY_NAMES[number];

/**
 * Store an API key encrypted in the intelligence_api_keys table.
 */
export function storeApiKey(name: ApiKeyName, value: string): void {
  if (!VALID_API_KEY_NAMES.includes(name)) {
    throw new Error(`Invalid API key name: ${name}. Must be one of: ${VALID_API_KEY_NAMES.join(', ')}`);
  }
  const encrypted = safeStorage.encryptString(value);
  const encoded = encrypted.toString('base64');
  const database = getDb();
  if (database) {
    database.prepare(
      'INSERT OR REPLACE INTO intelligence_api_keys (key_name, encrypted_value, updated_at) VALUES (?, ?, unixepoch())'
    ).run(name, encoded);
  }
}

/**
 * Retrieve a decrypted API key by name.
 */
export function retrieveApiKey(name: ApiKeyName): string | null {
  const database = getDb();
  if (!database) return null;

  const row = database.prepare(
    'SELECT encrypted_value FROM intelligence_api_keys WHERE key_name = ?'
  ).get(name) as { encrypted_value: string } | undefined;
  if (!row) return null;

  try {
    const buffer = Buffer.from(row.encrypted_value, 'base64');
    return safeStorage.decryptString(buffer);
  } catch {
    return null;
  }
}

/**
 * Remove a stored API key.
 */
export function clearApiKey(name: ApiKeyName): void {
  const database = getDb();
  if (database) {
    database.prepare('DELETE FROM intelligence_api_keys WHERE key_name = ?').run(name);
  }
}

/**
 * List which API keys are stored (returns names only, never values).
 */
export function listApiKeys(): { name: string; hasKey: boolean }[] {
  const database = getDb();
  const stored: Set<string> = new Set();
  if (database) {
    const rows = database.prepare('SELECT key_name FROM intelligence_api_keys').all() as { key_name: string }[];
    for (const row of rows) {
      stored.add(row.key_name);
    }
  }
  return VALID_API_KEY_NAMES.map((name) => ({
    name,
    hasKey: stored.has(name),
  }));
}

/**
 * Retrieve all configured API keys as a record.
 * Used internally to pass keys to the Python bridge.
 */
export function getAllApiKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const name of VALID_API_KEY_NAMES) {
    const value = retrieveApiKey(name);
    if (value) keys[name] = value;
  }
  return keys;
}
