/**
 * Search URLs CRUD — manage catalog URLs for polling
 */

import { getDb } from './db';

export interface SearchUrl {
  id: number;
  url: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export function getAllSearchUrls(): SearchUrl[] {
  const db = getDb();
  if (!db) return [];
  const rows = db.prepare('SELECT id, url, enabled, created_at, updated_at FROM search_urls ORDER BY created_at').all() as (SearchUrl & { enabled: number })[];
  return rows.map((r) => ({ ...r, enabled: r.enabled === 1 }));
}

export function getEnabledSearchUrls(): SearchUrl[] {
  return getAllSearchUrls().filter((u) => u.enabled);
}

export function addSearchUrl(url: string): SearchUrl | null {
  const db = getDb();
  if (!db) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    db.prepare('INSERT INTO search_urls (url, enabled, created_at, updated_at) VALUES (?, 1, unixepoch(), unixepoch())').run(trimmed);
    const result = db.prepare('SELECT id, url, enabled, created_at, updated_at FROM search_urls WHERE url = ?').get(trimmed) as SearchUrl & { enabled: number } | undefined;
    if (!result) return null;
    return { ...result, enabled: result.enabled === 1 };
  } catch {
    // UNIQUE constraint — url already exists
    return null;
  }
}

export function updateSearchUrl(id: number, updates: { url?: string; enabled?: boolean }): SearchUrl | null {
  const db = getDb();
  if (!db) return null;
  const existing = db.prepare('SELECT * FROM search_urls WHERE id = ?').get(id) as (SearchUrl & { enabled: number }) | undefined;
  if (!existing) return null;

  if (updates.url !== undefined) {
    db.prepare('UPDATE search_urls SET url = ?, updated_at = unixepoch() WHERE id = ?').run(updates.url.trim(), id);
  }
  if (updates.enabled !== undefined) {
    db.prepare('UPDATE search_urls SET enabled = ?, updated_at = unixepoch() WHERE id = ?').run(updates.enabled ? 1 : 0, id);
  }

  const row = db.prepare('SELECT id, url, enabled, created_at, updated_at FROM search_urls WHERE id = ?').get(id) as SearchUrl & { enabled: number };
  return { ...row, enabled: row.enabled === 1 };
}

export function deleteSearchUrl(id: number): boolean {
  const db = getDb();
  if (!db) return false;
  const result = db.prepare('DELETE FROM search_urls WHERE id = ?').run(id);
  return result.changes > 0;
}
