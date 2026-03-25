/**
 * Sniper Hits — persistence layer for matched items (simulation + real purchases)
 */

import { getDb } from './db';

export interface SniperHit {
  id: number;
  sniper_id: number;
  sniper_name: string;
  item_id: number;
  title: string | null;
  price: string | null;
  photo_url: string | null;
  url: string | null;
  simulated: boolean;
  created_at: number;
}

interface SniperHitRow extends Omit<SniperHit, 'simulated'> {
  simulated: number;
}

function rowToHit(r: SniperHitRow): SniperHit {
  return { ...r, simulated: r.simulated === 1 };
}

export function insertHit(data: {
  sniper_id: number;
  sniper_name: string;
  item_id: number;
  title?: string | null;
  price?: string | null;
  photo_url?: string | null;
  url?: string | null;
  simulated: boolean;
}): SniperHit | null {
  const db = getDb();
  if (!db) return null;
  const result = db.prepare(
    `INSERT INTO sniper_hits (sniper_id, sniper_name, item_id, title, price, photo_url, url, simulated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
  ).run(
    data.sniper_id,
    data.sniper_name,
    data.item_id,
    data.title ?? null,
    data.price ?? null,
    data.photo_url ?? null,
    data.url ?? null,
    data.simulated ? 1 : 0
  );
  const id = result.lastInsertRowid as number;
  const row = db.prepare('SELECT * FROM sniper_hits WHERE id = ?').get(id) as SniperHitRow | undefined;
  return row ? rowToHit(row) : null;
}

export function getAllHits(opts?: {
  limit?: number;
  simulated?: boolean;
}): SniperHit[] {
  const db = getDb();
  if (!db) return [];

  let sql = 'SELECT * FROM sniper_hits';
  const params: unknown[] = [];

  if (opts?.simulated !== undefined) {
    sql += ' WHERE simulated = ?';
    params.push(opts.simulated ? 1 : 0);
  }

  sql += ' ORDER BY created_at DESC';

  if (opts?.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }

  const rows = db.prepare(sql).all(...params) as SniperHitRow[];
  return rows.map(rowToHit);
}

export function clearHits(): void {
  const db = getDb();
  if (!db) return;
  db.prepare('DELETE FROM sniper_hits').run();
}
