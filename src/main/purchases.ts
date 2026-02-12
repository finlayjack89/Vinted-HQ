/**
 * Purchases — query purchase history
 */

import { getDb } from './db';

export interface Purchase {
  id: number;
  item_id: number | null;
  order_id: number | null;
  amount: number | null;
  status: string | null;
  sniper_id: number | null;
  created_at: number;
}

export function getAllPurchases(limit = 100): Purchase[] {
  const db = getDb();
  if (!db) return [];
  const rows = db.prepare(
    'SELECT id, item_id, order_id, amount, status, sniper_id, created_at FROM purchases ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as Purchase[];
  return rows;
}
