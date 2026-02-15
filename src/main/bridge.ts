/**
 * Python Bridge Client — calls the curl_cffi HTTP server from Electron main process.
 * Handles cookie injection, proxy rotation, and structured error responses.
 */

import * as secureStorage from './secureStorage';
import { getTransportMode } from './proxyService';

const BRIDGE_BASE = 'http://127.0.0.1:37421';

/** Read current transport mode as a query-param-ready string. */
function _transportMode(): string {
  return getTransportMode(); // 'PROXY' or 'DIRECT'
}

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

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry on RATE_LIMITED with exponential backoff. */
async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  checkRetry: (json: BridgeResult) => boolean
): Promise<BridgeResult> {
  let lastJson: BridgeResult | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, opts);
      const json = (await res.json()) as BridgeResult;
      lastJson = json;
      if (checkRetry(json)) {
        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
      return json;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
          return { ok: false, code: 'BRIDGE_UNREACHABLE', message: 'Python bridge not running. Restart the app.' };
        }
        return { ok: false, code: 'REQUEST_FAILED', message: msg };
      }
      await sleep(1000 * (attempt + 1));
    }
  }
  return lastJson ?? { ok: false, code: 'REQUEST_FAILED', message: 'Max retries exceeded' };
}

/**
 * Search catalog by URL. Returns items from Vinted API.
 */
export async function search(url: string, page: number = 1, proxy?: string): Promise<BridgeResult> {
  const params: Record<string, string> = {
    url,
    page: String(page),
    base_interval: '0',
    jitter: '1',
    transport_mode: _transportMode(),
  };
  if (proxy) params.proxy = proxy;

  const qs = new URLSearchParams(params).toString();
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:search',message:'No cookie for search',data:{url,page},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie. Connect Vinted in settings.' };
  }

  const result = await fetchWithRetry(
    `${BRIDGE_BASE}/search?${qs}`,
    { method: 'GET', headers: { 'X-Vinted-Cookie': cookie } },
    (json) => !json.ok && json.code === 'RATE_LIMITED'
  );
  // #region agent log
  if (!result.ok) { fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:search:result',message:'Search failed',data:{url,page,code:(result as any).code,msg:(result as any).message,proxy:proxy||'none'},timestamp:Date.now(),hypothesisId:'H1,H2'})}).catch(()=>{}); }
  // #endregion
  return result;
}

/**
 * Initiate checkout build.
 */
export async function checkoutBuild(orderId: number, proxy?: string): Promise<BridgeResult> {
  const params: Record<string, string> = { base_interval: '0', jitter: '1', transport_mode: _transportMode() };
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
  const params: Record<string, string> = { base_interval: '0', jitter: '1', transport_mode: _transportMode() };
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
    transport_mode: _transportMode(),
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

// ─── Wardrobe & Inventory Bridge Methods ────────────────────────────────────

/** Build common auth headers for wardrobe/listing operations. */
function authHeaders(): Record<string, string> {
  const cookie = secureStorage.retrieveCookie();
  const headers: Record<string, string> = {};
  if (cookie) headers['X-Vinted-Cookie'] = cookie;
  // CSRF token and anon_id stored alongside cookie in settings
  const csrfToken = _getSettingRaw('csrf_token');
  const anonId = _getSettingRaw('anon_id');
  if (csrfToken) headers['X-Csrf-Token'] = csrfToken;
  if (anonId) headers['X-Anon-Id'] = anonId;
  return headers;
}

/** Read a raw string setting from the DB. */
function _getSettingRaw(key: string): string | null {
  try {
    // Dynamic import to avoid circular deps
    const { getDb } = require('./db');
    const db = getDb();
    if (!db) return null;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function bridgeError(err: unknown): BridgeResult {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
    return { ok: false, code: 'BRIDGE_UNREACHABLE', message: 'Python bridge not running. Restart the app.' };
  }
  return { ok: false, code: 'REQUEST_FAILED', message: msg };
}

/**
 * Fetch user's wardrobe listings.
 */
export async function fetchWardrobe(
  userId: number,
  page: number = 1,
  perPage: number = 20,
  proxy?: string
): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = {
    user_id: String(userId),
    page: String(page),
    per_page: String(perPage),
    transport_mode: _transportMode(),
  };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  try {
    const res = await fetch(`${BRIDGE_BASE}/wardrobe?${qs}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    return (await res.json()) as BridgeResult;
  } catch (err) {
    return bridgeError(err);
  }
}

/**
 * Fetch ontology categories.
 */
export async function fetchOntologyCategories(proxy?: string): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:fetchOntologyCategories',message:'No cookie for ontology categories',data:{},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = { transport_mode: _transportMode() };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  const hdrs = authHeaders();
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:fetchOntologyCategories',message:'Calling ontology categories',data:{hasCookie:!!cookie,hasCsrf:!!hdrs['X-Csrf-Token'],hasAnonId:!!hdrs['X-Anon-Id'],proxy:proxy||'none'},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  // #endregion

  try {
    const res = await fetch(`${BRIDGE_BASE}/ontology/categories${qs ? '?' + qs : ''}`, {
      method: 'GET',
      headers: hdrs,
    });
    const json = (await res.json()) as BridgeResult;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:fetchOntologyCategories:response',message:'Ontology categories response',data:{ok:json.ok,code:!json.ok?(json as any).code:undefined,msg:!json.ok?(json as any).message:undefined,httpStatus:res.status},timestamp:Date.now(),hypothesisId:'H2,H3,H4'})}).catch(()=>{});
    // #endregion
    return json;
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:fetchOntologyCategories:catch',message:'Ontology categories fetch error',data:{error:String(err)},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    return bridgeError(err);
  }
}

/**
 * Fetch ontology brands, optionally filtered.
 */
export async function fetchOntologyBrands(
  categoryId?: number,
  keyword?: string,
  proxy?: string
): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:fetchOntologyBrands',message:'No cookie for ontology brands',data:{},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = { transport_mode: _transportMode() };
  if (categoryId !== undefined) params.category_id = String(categoryId);
  if (keyword) params.keyword = keyword;
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  const hdrs = authHeaders();
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:fetchOntologyBrands',message:'Calling ontology brands',data:{hasCookie:!!cookie,hasCsrf:!!hdrs['X-Csrf-Token'],hasAnonId:!!hdrs['X-Anon-Id'],categoryId,proxy:proxy||'none'},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  // #endregion

  try {
    const res = await fetch(`${BRIDGE_BASE}/ontology/brands${qs ? '?' + qs : ''}`, {
      method: 'GET',
      headers: hdrs,
    });
    const json = (await res.json()) as BridgeResult;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:fetchOntologyBrands:response',message:'Ontology brands response',data:{ok:json.ok,code:!json.ok?(json as any).code:undefined,msg:!json.ok?(json as any).message:undefined,httpStatus:res.status},timestamp:Date.now(),hypothesisId:'H2,H3,H4'})}).catch(()=>{});
    // #endregion
    return json;
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/cb92deac-7f0c-4868-8f25-3eefaf2bd520',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bridge.ts:fetchOntologyBrands:catch',message:'Ontology brands fetch error',data:{error:String(err)},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    return bridgeError(err);
  }
}

/**
 * Fetch ontology colors.
 */
export async function fetchOntologyColors(proxy?: string): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = { transport_mode: _transportMode() };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  try {
    const res = await fetch(`${BRIDGE_BASE}/ontology/colors${qs ? '?' + qs : ''}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    return (await res.json()) as BridgeResult;
  } catch (err) {
    return bridgeError(err);
  }
}

/**
 * Fetch ontology conditions for a category.
 */
export async function fetchOntologyConditions(catalogId: number, proxy?: string): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = { catalog_id: String(catalogId), transport_mode: _transportMode() };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  try {
    const res = await fetch(`${BRIDGE_BASE}/ontology/conditions?${qs}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    return (await res.json()) as BridgeResult;
  } catch (err) {
    return bridgeError(err);
  }
}

/**
 * Preview mutation — applies Pillow mutation without uploading. Returns mutated image bytes.
 */
export async function previewMutation(
  imageBuffer: Buffer,
  relistCount: number
): Promise<Buffer | null> {
  try {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'photo.jpg');
    formData.append('relist_count', String(relistCount));

    const res = await fetch(`${BRIDGE_BASE}/preview-mutation`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch {
    return null;
  }
}

/**
 * Create and publish a new listing.
 */
export async function createListing(
  itemData: Record<string, unknown>,
  uploadSessionId?: string,
  proxy?: string
): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = { transport_mode: _transportMode() };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  try {
    const res = await fetch(`${BRIDGE_BASE}/listing${qs ? '?' + qs : ''}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_data: itemData, upload_session_id: uploadSessionId }),
    });
    return (await res.json()) as BridgeResult;
  } catch (err) {
    return bridgeError(err);
  }
}

/**
 * Edit an existing listing.
 */
export async function editListing(
  itemId: number,
  itemData: Record<string, unknown>,
  uploadSessionId?: string,
  proxy?: string
): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = { transport_mode: _transportMode() };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  try {
    const res = await fetch(`${BRIDGE_BASE}/listing/${itemId}${qs ? '?' + qs : ''}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_data: itemData, upload_session_id: uploadSessionId }),
    });
    return (await res.json()) as BridgeResult;
  } catch (err) {
    return bridgeError(err);
  }
}

/**
 * Delete a live listing.
 */
export async function deleteListing(itemId: number, proxy?: string): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = { transport_mode: _transportMode() };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  try {
    const res = await fetch(`${BRIDGE_BASE}/listing/${itemId}/delete${qs ? '?' + qs : ''}`, {
      method: 'POST',
      headers: authHeaders(),
    });
    return (await res.json()) as BridgeResult;
  } catch (err) {
    return bridgeError(err);
  }
}

/**
 * Hide or unhide a listing.
 */
export async function toggleListingVisibility(
  itemId: number,
  isHidden: boolean,
  proxy?: string
): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = { transport_mode: _transportMode() };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  try {
    const res = await fetch(`${BRIDGE_BASE}/listing/${itemId}/visibility${qs ? '?' + qs : ''}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_hidden: isHidden }),
    });
    return (await res.json()) as BridgeResult;
  } catch (err) {
    return bridgeError(err);
  }
}

/**
 * Full stealth relist: mutate images, delete old, wait 10s, publish new.
 */
export async function relistItem(
  oldItemId: number,
  itemData: Record<string, unknown>,
  imageBuffers: Buffer[],
  relistCount: number,
  proxy?: string
): Promise<BridgeResult> {
  const cookie = secureStorage.retrieveCookie();
  if (!cookie) {
    return { ok: false, code: 'MISSING_COOKIE', message: 'No session cookie.' };
  }
  const params: Record<string, string> = { transport_mode: _transportMode() };
  if (proxy) params.proxy = proxy;
  const qs = new URLSearchParams(params).toString();

  // Encode images as base64 for JSON transport to bridge
  const imageB64 = imageBuffers.map((buf) => buf.toString('base64'));

  try {
    const res = await fetch(`${BRIDGE_BASE}/relist${qs ? '?' + qs : ''}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_item_id: oldItemId,
        item_data: itemData,
        image_bytes_b64: imageB64,
        relist_count: relistCount,
      }),
    });
    return (await res.json()) as BridgeResult;
  } catch (err) {
    return bridgeError(err);
  }
}
