/**
 * Logs CRUD — query logs for viewer
 */

import { getDb } from './db';

export interface LogEntry {
  id: number;
  level: string;
  event: string;
  payload: string | null;
  request_id: string | null;
  created_at: number;
}

export function getLogs(opts: {
  level?: string;
  event?: string;
  since?: number;
  before?: number;
  limit?: number;
  offset?: number;
}): LogEntry[] {
  const db = getDb();
  if (!db) return [];

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.level) {
    conditions.push('level = ?');
    params.push(opts.level);
  }
  if (opts.event) {
    conditions.push('event LIKE ?');
    params.push(`%${opts.event}%`);
  }
  if (opts.since) {
    conditions.push('created_at >= ?');
    params.push(opts.since);
  }
  if (opts.before) {
    conditions.push('created_at <= ?');
    params.push(opts.before);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;

  const rows = db.prepare(
    `SELECT id, level, event, payload, request_id, created_at FROM logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as LogEntry[];

  return rows;
}
