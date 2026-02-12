/**
 * Python Bridge Client — calls the curl_cffi HTTP server from Electron main process.
 * Handles cookie injection, proxy rotation, and structured error responses.
 */

import * as secureStorage from './secureStorage';

const BRIDGE_BASE = 'http://127.0.0.1:37421';

export interface BridgeSearchResult {
  ok: true;
  data: unknown;
}

export interface BridgeErrorResult {
  ok: false;
  code: string;
  message: string;
}

export type BridgeResult<T = unknown> = BridgeSearchResult | BridgeErrorResult;

/**
 * Search catalog by URL. Returns items from Vinted API.
 */
export async function search(url: string, page: number = 1, proxy?: string): Promise<BridgeResult> {
  const params: Record<string, string> = {
    url,
    page: String(page),
    base_interval: '0',
    jitter: '1',
  };
  if (proxy) params.proxy = proxy;

  const qs = new URLSearchParams(params).toString();
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie. Connect Vinted in settings.' };
  }

  try {
    const res = await fetch(`${BRIDGE_BASE}/search?${qs}`, {
      method: 'GET',
      headers: { 'X-Vinted-Cookie': cookie },
    });
    const json = (await res.json()) as BridgeResult;
    return json;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return { ok: false, code: 'BRIDGE_UNREACHABLE', message: 'Python bridge not running. Restart the app.' };
    }
    return { ok: false, code: 'REQUEST_FAILED', message: msg };
  }
}

/**
 * Initiate checkout build.
 */
export async function checkoutBuild(orderId: number, proxy?: string): Promise<BridgeResult> {
  const params: Record<string, string> = { base_interval: '0', jitter: '1' };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie. Connect Vinted in settings.' };
  }

  try {
    const res = await fetch(`${BRIDGE_BASE}/checkout/build?${qs}`, {
      method: 'POST',
      headers: { 'X-Vinted-Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });
    const json = (await res.json()) as BridgeResult;
    return json;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return { ok: false, code: 'BRIDGE_UNREACHABLE', message: 'Python bridge not running. Restart the app.' };
    }
    return { ok: false, code: 'REQUEST_FAILED', message: msg };
  }
}

/**
 * PUT checkout step with components.
 */
export async function checkoutPut(
  purchaseId: string,
  components: Record<string, unknown>,
  proxy?: string
): Promise<BridgeResult> {
  const params: Record<string, string> = { base_interval: '0', jitter: '1' };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie. Connect Vinted in settings.' };
  }

  try {
    const res = await fetch(`${BRIDGE_BASE}/checkout/${purchaseId}?${qs}`, {
      method: 'PUT',
      headers: { 'X-Vinted-Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ components }),
    });
    const json = (await res.json()) as BridgeResult;
    return json;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return { ok: false, code: 'BRIDGE_UNREACHABLE', message: 'Python bridge not running. Restart the app.' };
    }
    return { ok: false, code: 'REQUEST_FAILED', message: msg };
  }
}

/**
 * Get nearby pickup points for drop-off.
 */
export async function nearbyPickupPoints(
  shippingOrderId: number,
  lat: number,
  lon: number,
  countryCode: string = 'GB',
  proxy?: string
): Promise<BridgeResult> {
  const params: Record<string, string> = {
    shipping_order_id: String(shippingOrderId),
    latitude: String(lat),
    longitude: String(lon),
    country_code: countryCode,
    base_interval: '0',
    jitter: '1',
  };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie. Connect Vinted in settings.' };
  }

  try {
    const res = await fetch(`${BRIDGE_BASE}/checkout/nearby_pickup_points?${qs}`, {
      method: 'GET',
      headers: { 'X-Vinted-Cookie': cookie },
    });
    const json = (await res.json()) as BridgeResult;
    return json;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return { ok: false, code: 'BRIDGE_UNREACHABLE', message: 'Python bridge not running. Restart the app.' };
    }
    return { ok: false, code: 'REQUEST_FAILED', message: msg };
  }
}

/**
 * Health check — verify Python bridge is running.
 */
export async function healthCheck(): Promise<{ ok: boolean; service?: string }> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/health`);
    const json = (await res.json()) as { ok?: boolean; service?: string };
    return { ok: json.ok === true, service: json.service };
  } catch {
    return { ok: false };
  }
}
