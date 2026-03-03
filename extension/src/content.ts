/**
 * Vinted HQ Content Script
 * Runs on https://www.vinted.co.uk/*
 *
 * Two modes:
 *  1. Wardrobe Sync — on /member/items, extracts Next.js state and POSTs to python bridge.
 *  2. Assisted Edit — on /items/.../edit?hq_mode=true, fetches local DB data and autofills form.
 *
 * All bridge communication is routed through the background service worker
 * to avoid MV3 cross-origin issues with content scripts.
 */

// Top-level diagnostic — fires immediately when Chrome injects this script
console.log('[Vinted HQ] Content script injected on:', window.location.href);
console.log('[Vinted HQ] pathname:', window.location.pathname, 'search:', window.location.search);

/**
 * Send a fetch request via the background service worker.
 * This avoids CORS/CSP issues that content scripts face in Manifest V3.
 */
function bridgeFetch(path: string, method = 'GET', body?: unknown): Promise<{ ok: boolean; data?: any; error?: string }> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { type: 'BRIDGE_FETCH', path, method, body },
            (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(response);
                }
            }
        );
    });
}

// ─── Wardrobe Sync (Phase B) ────────────────────────────────────────────────

window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'VINTED_HQ_WARDROBE_SYNC') {
        console.log('[Vinted HQ] Intercepted wardrobe Next.js state!', event.data.payload);
        const result = await bridgeFetch('/ingest/wardrobe', 'POST', event.data.payload);
        if (result.ok) {
            console.log('[Vinted HQ] Successfully synced wardrobe data to python bridge.');
        } else {
            console.error('[Vinted HQ] Failed to sync wardrobe data:', result.error);
        }
    }
});

function injectScript() {
    const script = document.createElement('script');
    script.textContent = `
    (function() {
      if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps) {
        const items = window.__NEXT_DATA__.props.pageProps.items || [];
        window.postMessage({
          type: 'VINTED_HQ_WARDROBE_SYNC',
          payload: {
            items: items,
            timestamp: Date.now(),
            source: 'extension_wardrobe'
          }
        }, '*');
      }
    })();
  `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
}

// ─── Assisted Edit (Phase C) ────────────────────────────────────────────────

/**
 * React-safe way to set an input value.
 */
function setReactInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    try {
        const proto = el instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        if (nativeSetter) {
            nativeSetter.call(el, value);
        } else {
            el.value = value;
        }
    } catch {
        // Fallback if native setter throws (e.g. custom components)
        el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Wait for an element matching the selector to appear in the DOM.
 */
function waitForElement(selector: string, timeoutMs = 10000): Promise<Element | null> {
    return new Promise((resolve) => {
        const existing = document.querySelector(selector);
        if (existing) {
            resolve(existing);
            return;
        }

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeoutMs);
    });
}

function extractItemIdFromUrl(): string | null {
    const match = window.location.pathname.match(/\/items\/(\d+)\/edit/);
    return match ? match[1] : null;
}

/**
 * Extract CSRF token natively from the DOM/Cookies.
 */
function getCsrfTokenFromDOM(): string | null {
    console.log('[Vinted HQ CSRF] Attempting to extract CSRF token...');
    try {
        const nextData = document.getElementById('__NEXT_DATA__');
        if (nextData) {
            const json = JSON.parse(nextData.textContent || '{}');
            const token = json.runtimeConfig?.csrfToken || json.props?.pageProps?.csrfToken;
            if (token) {
                console.log('[Vinted HQ CSRF] Found CSRF token in __NEXT_DATA__:', token);
                return token;
            }
        }
    } catch { /* skip */ }

    try {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            const str = s.textContent || '';
            const match = str.match(/"csrfToken"\s*:\s*"([^"]+)"/);
            if (match) {
                console.log('[Vinted HQ CSRF] Found CSRF token in generic script tag:', match[1]);
                return match[1];
            }
        }
    } catch { /* skip */ }

    try {
        for (const part of document.cookie.split(';')) {
            const p = part.trim();
            if (p.startsWith('access_token_web=')) {
                try {
                    const params = p.split('=')[1];
                    const segments = params.split('.');
                    if (segments.length >= 2) {
                        const b64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
                        const json = JSON.parse(atob(b64));
                        const token = json.csrf_token || json.csrf;
                        if (token) {
                            console.log('[Vinted HQ CSRF] Found CSRF token in access_token_web JWT:', token);
                            return token;
                        }
                    }
                } catch (e) {
                    console.log('[Vinted HQ CSRF] Error decoding JWT', e);
                }
            }
        }
    } catch { /* skip */ }

    console.warn('[Vinted HQ CSRF] Failed to extract any CSRF token from DOM or Cookies.');
    return null;
}

/**
 * Extract Anon ID natively from the Cookies.
 * Vinted requires x-anon-id alongside x-csrf-token for POST requests.
 */
function getAnonIdFromDOM(): string | null {
    try {
        for (const part of document.cookie.split(';')) {
            const p = part.trim();
            if (p.startsWith('anon_id=')) {
                const token = p.split('=')[1];
                if (token) {
                    console.log('[Vinted HQ CSRF] Found anon_id token in cookies:', token);
                    return token;
                }
            }
        }
    } catch { /* skip */ }

    return null;
}

function showBanner(message: string, type: 'info' | 'success' | 'error' = 'info') {
    const banner = document.createElement('div');
    const bgColor = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1';
    banner.setAttribute('style', `
        position: fixed; top: 16px; right: 16px; z-index: 999999;
        padding: 12px 20px; border-radius: 8px;
        background: ${bgColor}; color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px; font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        transition: opacity 0.3s ease;
    `);
    banner.textContent = `🏠 Vinted HQ: ${message}`;
    document.body.appendChild(banner);

    setTimeout(() => {
        banner.style.opacity = '0';
        setTimeout(() => banner.remove(), 300);
    }, 4000);
}

async function runAssistedEdit() {
    const itemId = extractItemIdFromUrl();
    if (!itemId) {
        console.error('[Vinted HQ] Could not extract item_id from URL.');
        showBanner('Could not determine item ID.', 'error');
        return;
    }

    showBanner('Fetching local data…', 'info');
    console.log(`[Vinted HQ] Fetching local data for item ${itemId}…`);

    const result = await bridgeFetch(`/items/${itemId}`);

    if (!result.ok) {
        console.error('[Vinted HQ] Bridge fetch failed:', result.error);
        showBanner('Failed to connect to Python Bridge.', 'error');
        return;
    }

    const payload = result.data;
    if (!payload?.ok) {
        console.error('[Vinted HQ] Item not found in local DB:', payload);
        showBanner(`Item ${itemId} not found in local database.`, 'error');
        return;
    }

    const data = payload.data;
    console.log('[Vinted HQ] Local data retrieved:', data);

    // Wait for the form to be rendered by Vinted's React app
    await waitForElement('input[name="title"], [data-testid="title-input"]', 8000);
    await new Promise((r) => setTimeout(r, 1500));

    let filled = 0;

    // ── Title ──
    try {
        const titleInput = document.querySelector<HTMLInputElement>(
            'input[name="title"], [data-testid="title-input"], input[id*="title"]'
        );
        if (titleInput && data.title) {
            setReactInputValue(titleInput, data.title);
            filled++;
            console.log('[Vinted HQ] ✅ Filled title:', data.title);
        }
    } catch (e) { console.warn('[Vinted HQ] ⚠️ Failed to fill title:', e); }

    // ── Description ──
    try {
        const descInput = document.querySelector<HTMLTextAreaElement>(
            'textarea[name="description"], [data-testid="description-input"], textarea[id*="description"]'
        );
        if (descInput && data.description) {
            setReactInputValue(descInput, data.description);
            filled++;
            console.log('[Vinted HQ] ✅ Filled description');
        }
    } catch (e) { console.warn('[Vinted HQ] ⚠️ Failed to fill description:', e); }

    // ── Price ──
    try {
        const priceInput = document.querySelector<HTMLInputElement>(
            'input[name="price"], [data-testid="price-input"], input[id*="price"]'
        );
        if (priceInput && data.price != null) {
            setReactInputValue(priceInput, String(data.price));
            filled++;
            console.log('[Vinted HQ] ✅ Filled price:', data.price);
        }
    } catch (e) { console.warn('[Vinted HQ] ⚠️ Failed to fill price:', e); }

    if (filled > 0) {
        showBanner(`Autofilled ${filled} field(s) from local DB.`, 'success');
    } else {
        showBanner('Form found but no fields matched. Check console.', 'error');
        console.warn('[Vinted HQ] Could not find any matching input fields. DOM selectors may need updating.');
    }
}

// ─── Deep Sync (Phase C.2) — Extension-first architecture ──────────────────
// The edit page (/items/{id}/edit) contains __NUXT_DATA__ script tags with
// the full item object. We read these from the DOM, find the item dict,
// and POST it directly to the local Python bridge's /ingest/item endpoint.

function extractItemIdFromPathname(): string | null {
    const match = window.location.pathname.match(/\/items\/(\d+)/);
    return match ? match[1] : null;
}

/**
 * Recursively search a parsed data structure for an object that looks like
 * a Vinted item (has 'id' matching our item_id, and has 'title').
 */
function findItemInData(data: any, itemId: string): any {
    if (!data || typeof data !== 'object') return null;

    // Check if this object IS the item
    if (data.id !== undefined && String(data.id) === itemId && 'title' in data) {
        return data;
    }

    // Recurse into arrays and objects
    const entries = Array.isArray(data) ? data : Object.values(data);
    for (const val of entries) {
        const found = findItemInData(val, itemId);
        if (found) return found;
    }
    return null;
}

async function runDeepSync() {
    const itemId = extractItemIdFromPathname();
    if (!itemId) {
        console.error('[Vinted HQ] Could not extract item_id from URL for deep sync.');
        showBanner('Could not determine item ID.', 'error');
        return;
    }

    showBanner('Deep syncing item details…', 'info');
    console.log(`[Vinted HQ] 🔄 Deep sync: extracting item data for ${itemId} from edit page`);

    let data: any = null;

    // ── Strategy 1: Next.js App Router RSC Payload (self.__next_f) ──────
    // Vinted uses Next.js App Router on the edit page. The data is embedded 
    // in flight chunks inside script tags. The main object is 'itemEditModel'.
    const scripts = Array.from(document.querySelectorAll('script'));
    console.log(`[Vinted HQ] Scanning ${scripts.length} script tags for itemEditModel...`);

    for (const script of scripts) {
        const content = script.textContent;
        if (!content || !content.includes('itemEditModel')) continue;

        console.log(`[Vinted HQ] Found script containing 'itemEditModel'`);

        // 1. Unescape the Next.js RSC payload string (it's often escaped JSON inside an array)
        // A generic unescape that handles \" and \\
        const unescaped = content.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

        // 2. Locate the itemEditModel object start
        const match = unescaped.match(/"itemEditModel":\s*({.*})/);
        if (match) {
            const str = match[1];
            let braceCount = 0;
            let endPos = -1;

            // 3. Find the matching closing brace to extract exactly this object
            for (let i = 0; i < str.length; i++) {
                if (str[i] === '{') braceCount++;
                else if (str[i] === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        endPos = i + 1;
                        break;
                    }
                }
            }

            if (endPos !== -1) {
                try {
                    const jsonStr = str.substring(0, endPos);
                    const parsed = JSON.parse(jsonStr);

                    // Verify it matches our item ID
                    if (String(parsed.id) === itemId) {
                        data = parsed;
                        console.log(`[Vinted HQ] Successfully extracted itemEditModel JSON`, Object.keys(data));
                        break;
                    }
                } catch (e) {
                    console.error("[Vinted HQ] Failed to parse extracted itemEditModel string:", e);
                }
            }
        }
    }

    // ── Strategy 2: Pre-rendered State (window.__NEXT_DATA__) ──────────
    // Fallback for older Vinted pages
    if (!data) {
        try {
            const nextDataEl = document.getElementById('__NEXT_DATA__');
            if (nextDataEl?.textContent) {
                const parsed = JSON.parse(nextDataEl.textContent);
                const found = findItemInData(parsed, itemId);
                if (found) {
                    data = found;
                    console.log(`[Vinted HQ] Found item in __NEXT_DATA__ element`);
                }
            }
        } catch { /* skip */ }
    }

    if (!data) {
        console.error('[Vinted HQ] No item data found in page.');
        showBanner('No item data found. Check console for diagnostics.', 'error');
        return;
    }

    // Ensure the id is present
    if (!data.id) data.id = parseInt(itemId, 10);

    // ── Pre-fetch category attributes natively from Chrome ──────────
    const catalogId = data.catalogId || data.catalog_id || data.categoryId || data.category_id;
    if (catalogId) {
        console.log(`[Vinted HQ] 🔄 Fetching attributes natively via extension for category ${catalogId}...`);
        const brandId = data.brandId || data.brand_id || (data.brand ? data.brand.id : undefined) || (data.brand_dto ? data.brand_dto.id : undefined);
        const statusId = data.statusId || data.status_id || (data.status ? data.status.id : undefined);

        const csrfToken = getCsrfTokenFromDOM();
        const anonId = getAnonIdFromDOM();

        const apiPayload: any = { attributes: [{ code: 'category', value: [catalogId] }] };
        if (brandId) apiPayload.attributes.push({ code: 'brand', value: [brandId] });
        if (statusId) apiPayload.attributes.push({ code: 'status', value: [statusId] });

        try {
            const attrRes = await new Promise<any>((resolve) => {
                chrome.runtime.sendMessage({
                    type: 'VINTED_FETCH',
                    url: 'https://www.vinted.co.uk/api/v2/item_upload/attributes',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/plain, */*',
                        'x-csrf-token': csrfToken || '',
                        'x-anon-id': anonId || ''
                    },
                    body: apiPayload
                }, resolve);
            });

            if (attrRes.ok) {
                console.log('[Vinted HQ] ✅ Fetched attributes via Background API:', attrRes.data);
                data._hq_attributes_schema = attrRes.data;
            } else {
                console.warn('[Vinted HQ] ⚠️ Failed to fetch attributes via Background API', attrRes.status, attrRes.error);
            }
        } catch (e) {
            console.error('[Vinted HQ] ⚠️ Error proxying fetch attributes', e);
        }
    }

    // ── 4. DOM Fallbacks for RSC References ─────────────────────────────
    // In Next.js RSC, large strings (like description) are sometimes replaced 
    // by references (e.g. "$86") pointing to other chunks. If we see a reference 
    // (starts with $ and is short), we grab the real value directly from the DOM form.

    // Description
    if (!data.description || (typeof data.description === 'string' && data.description.startsWith('$') && data.description.length < 10)) {
        const domDesc = document.querySelector('textarea[name="description"]') as HTMLTextAreaElement;
        if (domDesc && domDesc.value) {
            console.log(`[Vinted HQ] Extracting description from DOM fallback`);
            data.description = domDesc.value;
        }
    }

    // Title
    if (!data.title || (typeof data.title === 'string' && data.title.startsWith('$') && data.title.length < 10)) {
        const domTitle = document.querySelector('input[name="title"]') as HTMLInputElement;
        if (domTitle && domTitle.value) {
            console.log(`[Vinted HQ] Extracting title from DOM fallback`);
            data.title = domTitle.value;
        }
    }

    // Price
    const domPrice = document.querySelector('input[name="price"]') as HTMLInputElement;
    if (domPrice && domPrice.value) {
        // Vinted stores price in various formats (dict, string, float). The python bridge handles normalization.
        // We inject a clean numeric string from the DOM just to be safe.
        const cleanPrice = domPrice.value.replace(/[^0-9.]/g, '');
        if (cleanPrice) {
            data.price_numeric = cleanPrice;
        }
    }

    console.log('[Vinted HQ] Extracted item data keys:', Object.keys(data));
    console.log('[Vinted HQ] Posting to /ingest/item…');

    // POST the raw item data to the Python bridge via the background service worker
    const result = await bridgeFetch('/ingest/item', 'POST', { item: data });

    if (result.ok && result.data?.ok) {
        console.log('[Vinted HQ] ✅ Deep sync complete:', result.data.message);
        showBanner('✅ Deep sync complete! Closing tab…', 'success');
        setTimeout(() => window.close(), 2500);
    } else {
        const err = result.data?.message || result.error || 'Unknown error';
        console.error('[Vinted HQ] Deep sync failed:', err);
        showBanner(`Deep sync failed: ${err}`, 'error');
    }
}

// ─── Router ─────────────────────────────────────────────────────────────────

if (window.location.pathname.startsWith('/member/items')) {
    console.log('[Vinted HQ] Member items page detected, injecting Next.js state extractor...');
    setTimeout(injectScript, 1000);
} else if (window.location.pathname.includes('/edit') && window.location.search.includes('hq_sync=true')) {
    // Deep Sync — scrape the edit page for __NUXT_DATA__ and POST to bridge
    console.log('[Vinted HQ] 🔄 Deep Sync mode activated (edit page)...');
    setTimeout(runDeepSync, 2000);
} else if (window.location.pathname.includes('/edit') && window.location.search.includes('hq_mode=true')) {
    // Assisted Edit — push local data into the Vinted edit form
    console.log('[Vinted HQ] ✨ HQ Mode activated — running Assisted Edit...');
    setTimeout(runAssistedEdit, 2000);
}
