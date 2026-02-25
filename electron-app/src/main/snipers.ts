/**
 * Snipers CRUD — manage autobuy rules
 */

import { getDb } from './db';

export interface Sniper {
  id: number;
  name: string;
  price_max: number | null;
  keywords: string | null;
  condition: string | null;
  budget_limit: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

function rowToSniper(r: Sniper & { enabled: number }): Sniper {
  return { ...r, enabled: r.enabled === 1 };
}

export function getAllSnipers(): Sniper[] {
  const db = getDb();
  if (!db) return [];
  const rows = db.prepare(
    'SELECT id, name, price_max, keywords, condition, budget_limit, enabled, created_at, updated_at FROM snipers ORDER BY name'
  ).all() as (Sniper & { enabled: number })[];
  return rows.map(rowToSniper);
}

export function getEnabledSnipers(): Sniper[] {
  return getAllSnipers().filter((s) => s.enabled);
}

export function getSniperSpent(sniperId: number): number {
  const db = getDb();
  if (!db) return 0;
  const row = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as total FROM purchases WHERE sniper_id = ? AND status = ?'
  ).get(sniperId, 'completed') as { total: number } | undefined;
  return row?.total ?? 0;
}

export function addSniper(data: {
  name: string;
  price_max?: number | null;
  keywords?: string | null;
  condition?: string | null;
  budget_limit?: number;
}): Sniper | null {
  const db = getDb();
  if (!db) return null;
  const name = data.name.trim();
  if (!name) return null;
  const result = db.prepare(
    'INSERT INTO snipers (name, price_max, keywords, condition, budget_limit, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, unixepoch(), unixepoch())'
  ).run(
    name,
    data.price_max ?? null,
    data.keywords?.trim() || null,
    data.condition?.trim() || null,
    data.budget_limit ?? 0
  );
  const id = result.lastInsertRowid as number;
  const row = db.prepare('SELECT * FROM snipers WHERE id = ?').get(id) as Sniper & { enabled: number } | undefined;
  return row ? rowToSniper(row) : null;
}

export function updateSniper(id: number, updates: Partial<Pick<Sniper, 'name' | 'price_max' | 'keywords' | 'condition' | 'budget_limit' | 'enabled'>>): Sniper | null {
  const db = getDb();
  if (!db) return null;
  const existing = db.prepare('SELECT * FROM snipers WHERE id = ?').get(id);
  if (!existing) return null;

  if (updates.name !== undefined) {
    db.prepare('UPDATE snipers SET name = ?, updated_at = unixepoch() WHERE id = ?').run(updates.name.trim(), id);
  }
  if (updates.price_max !== undefined) {
    db.prepare('UPDATE snipers SET price_max = ?, updated_at = unixepoch() WHERE id = ?').run(updates.price_max, id);
  }
  if (updates.keywords !== undefined) {
    db.prepare('UPDATE snipers SET keywords = ?, updated_at = unixepoch() WHERE id = ?').run(updates.keywords?.trim() || null, id);
  }
  if (updates.condition !== undefined) {
    db.prepare('UPDATE snipers SET condition = ?, updated_at = unixepoch() WHERE id = ?').run(updates.condition?.trim() || null, id);
  }
  if (updates.budget_limit !== undefined) {
    db.prepare('UPDATE snipers SET budget_limit = ?, updated_at = unixepoch() WHERE id = ?').run(updates.budget_limit, id);
  }
  if (updates.enabled !== undefined) {
    db.prepare('UPDATE snipers SET enabled = ?, updated_at = unixepoch() WHERE id = ?').run(updates.enabled ? 1 : 0, id);
  }

  const row = db.prepare('SELECT * FROM snipers WHERE id = ?').get(id) as Sniper & { enabled: number } | undefined;
  return row ? rowToSniper(row) : null;
}

export function deleteSniper(id: number): boolean {
  const db = getDb();
  if (!db) return false;
  const result = db.prepare('DELETE FROM snipers WHERE id = ?').run(id);
  return result.changes > 0;
}
