/**
 * Logging infrastructure — structured logs to SQLite
 */

import { getDb } from './db';
import { randomUUID } from 'node:crypto';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export function log(
  level: LogLevel,
  event: string,
  payload?: Record<string, unknown>,
  requestId?: string
): void {
  const db = getDb();
  if (!db) {
    console.log(`[${level}] ${event}`, payload ?? '');
    return;
  }
  const id = requestId ?? randomUUID();
  const payloadStr = payload ? JSON.stringify(payload) : null;
  db.prepare(
    'INSERT INTO logs (level, event, payload, request_id, created_at) VALUES (?, ?, ?, ?, unixepoch())'
  ).run(level, event, payloadStr, id);
  if (level === 'ERROR' || level === 'WARN') {
    console.warn(`[${level}] ${event}`, payload ?? '');
  }
}

export const logger = {
  debug: (event: string, payload?: Record<string, unknown>, requestId?: string) => log('DEBUG', event, payload, requestId),
  info: (event: string, payload?: Record<string, unknown>, requestId?: string) => log('INFO', event, payload, requestId),
  warn: (event: string, payload?: Record<string, unknown>, requestId?: string) => log('WARN', event, payload, requestId),
  error: (event: string, payload?: Record<string, unknown>, requestId?: string) => log('ERROR', event, payload, requestId),
};
