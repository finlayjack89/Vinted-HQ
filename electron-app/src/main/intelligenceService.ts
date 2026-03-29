/**
 * Intelligence Service — SSE consumer and report manager.
 *
 * Consumes Server-Sent Events from the Python bridge's /intelligence/analyze
 * endpoint and relays progress events to the renderer. Stores completed
 * reports in SQLite.
 */

import { BrowserWindow } from 'electron';
import { getDb } from './db';
import { getAllApiKeys } from './secureStorage';

const BRIDGE_BASE = 'http://127.0.0.1:37421';

type ProgressEvent = {
  step: string;
  status: string;
  message: string;
  progress_pct?: number;
  data?: Record<string, unknown>;
};

type AnalyzeParams = {
  mode: 'auth_only' | 'market_only' | 'full';
  listing_title: string;
  listing_description?: string;
  listing_price_gbp: number;
  listing_url?: string;
  photo_urls: string[];
  brand_hint?: string;
  category_hint?: string;
  condition_hint?: string;
  local_id?: number;
  vinted_item_id?: number;
};

/**
 * Run the Item Intelligence analysis pipeline.
 * Returns the final report or throws on fatal error.
 */
export async function runAnalysis(
  params: AnalyzeParams,
  win?: BrowserWindow | null,
): Promise<Record<string, unknown>> {
  const apiKeys = getAllApiKeys();

  // Build headers with API keys
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKeys.gemini) headers['X-Gemini-Key'] = apiKeys.gemini;
  if (apiKeys.anthropic) headers['X-Anthropic-Key'] = apiKeys.anthropic;
  if (apiKeys.perplexity) headers['X-Perplexity-Key'] = apiKeys.perplexity;
  if (apiKeys.serpapi) headers['X-Serpapi-Key'] = apiKeys.serpapi;

  // Build request body
  const body = {
    mode: params.mode,
    listing_title: params.listing_title,
    listing_description: params.listing_description,
    listing_price_gbp: params.listing_price_gbp,
    listing_url: params.listing_url,
    photo_urls: params.photo_urls,
    brand_hint: params.brand_hint,
    category_hint: params.category_hint,
    condition_hint: params.condition_hint,
  };

  // Make the SSE request
  const response = await fetch(`${BRIDGE_BASE}/intelligence/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Intelligence bridge returned ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error('No response body from intelligence endpoint');
  }

  // Consume the SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalReport: Record<string, unknown> | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || ''; // Keep incomplete event in buffer

      for (const line of lines) {
        const dataLine = line.trim();
        if (!dataLine.startsWith('data: ')) continue;

        try {
          const eventData = JSON.parse(dataLine.slice(6)) as ProgressEvent;

          // Send progress to renderer
          if (win && !win.isDestroyed()) {
            win.webContents.send('intelligence:progress', eventData);
          }

          // Check for final report
          if (eventData.step === 'complete' && eventData.data?.report) {
            finalReport = eventData.data.report as Record<string, unknown>;
          }
        } catch {
          // Skip malformed events
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finalReport) {
    throw new Error('No final report received from intelligence pipeline');
  }

  // Store report in SQLite
  _storeReport(finalReport, params);

  return finalReport;
}

/**
 * Get a stored intelligence report by local item ID.
 */
export function getReport(localId: number): Record<string, unknown> | null {
  const db = getDb();
  if (!db) return null;

  const row = db.prepare(
    'SELECT report_json FROM intelligence_reports WHERE local_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(localId) as { report_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.report_json);
  } catch {
    return null;
  }
}

/**
 * Get a stored report by Vinted item ID (for feed items without local_id).
 */
export function getReportByVintedId(vintedItemId: number): Record<string, unknown> | null {
  const db = getDb();
  if (!db) return null;

  const row = db.prepare(
    'SELECT report_json FROM intelligence_reports WHERE vinted_item_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(vintedItemId) as { report_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.report_json);
  } catch {
    return null;
  }
}

/**
 * Get all stored reports (most recent first).
 */
export function getReports(limit: number = 50): Record<string, unknown>[] {
  const db = getDb();
  if (!db) return [];

  const rows = db.prepare(
    `SELECT id, local_id, vinted_item_id, mode, verdict, confidence,
            listing_title, listing_price, duration_seconds, cost_usd, created_at
     FROM intelligence_reports ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as Record<string, unknown>[];

  return rows;
}

// ── Private helpers ──────────────────────────────────────────────────────────

function _storeReport(
  report: Record<string, unknown>,
  params: AnalyzeParams,
): void {
  const db = getDb();
  if (!db) return;

  const verdict = (report.authenticity_verdict as Record<string, unknown>)?.verdict as string | undefined;
  const confidence = (report.authenticity_verdict as Record<string, unknown>)?.confidence as number | undefined;

  db.prepare(`
    INSERT INTO intelligence_reports 
    (local_id, vinted_item_id, mode, report_json, verdict, confidence,
     listing_title, listing_price, duration_seconds, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.local_id || null,
    params.vinted_item_id || null,
    params.mode,
    JSON.stringify(report),
    verdict || null,
    confidence || null,
    params.listing_title,
    params.listing_price_gbp,
    (report.duration_seconds as number) || null,
    (report.total_cost_usd as number) || null,
  );
}
