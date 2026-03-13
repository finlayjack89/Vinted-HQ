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

// ─── Proactive CSRF Token Scraping ──────────────────────────────────────────
// On every Vinted page load, scrape the CSRF token from the DOM and push
// it to the background service worker. This feeds the Session Harvester
// so it can include a fresh CSRF token in the /ingest/session payload.
(function scrapeAndPushCsrfToken() {
    // Wait for DOM to settle (React hydration may not be instant)
    setTimeout(() => {
        let token: string | null = null;

        // Strategy 1: <meta name="csrf-token">
        try {
            const meta = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement;
            if (meta?.content) token = meta.content;
        } catch { /* skip */ }

        // Strategy 2: __NEXT_DATA__ JSON
        if (!token) {
            try {
                const nextDataEl = document.getElementById('__NEXT_DATA__');
                if (nextDataEl?.textContent) {
                    const json = JSON.parse(nextDataEl.textContent);
                    token = json?.runtimeConfig?.csrfToken
                        || json?.props?.pageProps?.csrfToken
                        || null;
                }
            } catch { /* skip */ }
        }

        // Strategy 3: window.vinted global
        if (!token) {
            try {
                // This needs Main World access; use a script tag injection
                const probe = document.createElement('script');
                probe.textContent = `
                    (function() {
                        let t = null;
                        if (window.vinted && window.vinted.csrfToken) t = window.vinted.csrfToken;
                        if (!t && window.CSRFProtection && typeof window.CSRFProtection.token === 'function') t = window.CSRFProtection.token();
                        if (t) window.postMessage({ type: 'VINTED_HQ_CSRF_SCRAPED', token: t }, '*');
                    })();
                `;
                (document.head || document.documentElement).appendChild(probe);
                probe.remove();
            } catch { /* skip */ }
        }

        if (token) {
            console.log(`[Vinted HQ] 🔑 CSRF token scraped from DOM: ${token.slice(0, 10)}...`);
            chrome.runtime.sendMessage({ type: 'SESSION_CSRF_TOKEN', token });
        }
    }, 2000); // Wait 2s for React hydration
})();

// Listen for CSRF token scraped via Main World injection
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'VINTED_HQ_CSRF_SCRAPED' && event.data.token) {
        console.log(`[Vinted HQ] 🔑 CSRF token received from Main World probe: ${event.data.token.slice(0, 10)}...`);
        chrome.runtime.sendMessage({ type: 'SESSION_CSRF_TOKEN', token: event.data.token });
    }
});


// ── Listen for intercepted ontology data from the Main World fetch interceptor ──
let capturedAttributes: any = null;
let capturedSizes: any = null;
window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'VINTED_HQ_ATTRIBUTES_CAPTURED') {
        capturedAttributes = event.data.payload;
        const catalogId = event.data.catalogId;
        console.log(`[Vinted HQ] 🎯 Received intercepted attributes (catalog ${catalogId}):`, capturedAttributes);

        // POST to backend cache immediately
        if (capturedAttributes?.attributes && catalogId) {
            bridgeFetch('/ingest/materials', 'POST', {
                catalog_id: Number(catalogId),
                attributes: capturedAttributes.attributes
            }).then(r => {
                if (r.ok) console.log('[Vinted HQ] ✅ Attributes cached in backend.');
                else console.warn('[Vinted HQ] ⚠️ Attributes cache response:', r.error);
            }).catch(err => console.error('[Vinted HQ] Failed to cache attributes:', err));
        }
    }

    if (event.data?.type === 'VINTED_HQ_SIZES_CAPTURED') {
        capturedSizes = event.data.payload;
        const catalogId = event.data.catalogId;
        console.log(`[Vinted HQ] 🎯 Received intercepted sizes (catalog ${catalogId}):`, capturedSizes);

        // POST to backend cache immediately
        if (capturedSizes?.size_groups && catalogId) {
            // Flatten size_groups into a flat sizes array for the backend
            const allSizes: { id: number; title: string }[] = [];
            for (const group of capturedSizes.size_groups) {
                if (Array.isArray(group.sizes)) {
                    for (const s of group.sizes) {
                        allSizes.push({ id: s.id, title: s.title });
                    }
                }
            }
            if (allSizes.length > 0) {
                bridgeFetch('/ingest/sizes', 'POST', {
                    catalog_id: Number(catalogId),
                    sizes: allSizes
                }).then(r => {
                    if (r.ok) console.log('[Vinted HQ] ✅ Sizes cached in backend.');
                    else console.warn('[Vinted HQ] ⚠️ Sizes cache response:', r.error);
                }).catch(err => console.error('[Vinted HQ] Failed to cache sizes:', err));
            }
        }
    }
});

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
 * Simulate a full hardware click cycle on an element.
 * Standard `.click()` fails on React Headless UI / Radix components because
 * they guard on pointer events preceding mouse events for state hydration.
 */
function simulateReactClick(element: Element | null): boolean {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const commonInit: MouseEventInit = {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1,
        clientX: x,
        clientY: y,
    };

    // Pointer events must precede mouse events for React 18+ and Radix UI
    element.dispatchEvent(new PointerEvent('pointerdown', { ...commonInit, pointerId: 1, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mousedown', commonInit));
    element.dispatchEvent(new PointerEvent('pointerup', { ...commonInit, pointerId: 1, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseup', commonInit));
    element.dispatchEvent(new MouseEvent('click', commonInit));

    return true;
}

// ─── Dropdown Puppeteers (Phase D.1) ────────────────────────────────────────

/**
 * Open a React Headless UI dropdown trigger, wait for portal render,
 * then click the option matching the given data-testid.
 */
async function selectDropdownOption(
    triggerSelector: string,
    optionTestId: string,
    label: string,
): Promise<boolean> {
    const trigger = document.querySelector(triggerSelector);
    if (!trigger) {
        console.warn(`[Vinted HQ] ⚠️ ${label} trigger not found: ${triggerSelector}`);
        return false;
    }

    simulateReactClick(trigger);
    // Wait for React to render the portal/menu
    await new Promise(resolve => setTimeout(resolve, 200));

    const option = document.querySelector(`[data-testid="${optionTestId}"]`);
    if (option) {
        simulateReactClick(option);
        console.log(`[Vinted HQ] ✅ Selected ${label}: ${optionTestId}`);
        return true;
    } else {
        console.warn(`[Vinted HQ] ⚠️ ${label} option not found: ${optionTestId}`);
        // Close the open menu by clicking away
        document.body.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        return false;
    }
}

async function selectCondition(statusId: number | string): Promise<boolean> {
    return selectDropdownOption(
        '[data-testid="condition-select-dropdown-input"], input#condition',
        `condition-${statusId}`,
        'Condition',
    );
}

async function selectSize(sizeId: number | string): Promise<boolean> {
    return selectDropdownOption(
        '[data-testid="size-select-dropdown-input"], input#size, [data-testid*="size"][role="combobox"], input[name="size_id"]',
        `size-${sizeId}`,
        'Size',
    );
}

async function selectPackageSize(packageSizeId: number | string): Promise<boolean> {
    return selectDropdownOption(
        '[data-testid="package_size-select-dropdown-input"], input#package_size, [data-testid*="package-size"][role="combobox"], input[name="package_size_id"]',
        `package_size-${packageSizeId}`,
        'Package Size',
    );
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
 * Fetch the snuffed CSRF token and Anon ID from the background script.
 * The background script caches these from intercepting live Vinted API requests.
 */
// @ts-ignore: kept for future use
function getSniffedTokens(): Promise<{ csrfToken: string | null; anonId: string | null }> {
    return new Promise((resolve) => {
        console.log('[Vinted HQ CSRF] Requesting sniffed tokens from background...');

        chrome.runtime.sendMessage({ type: 'GET_SNIFFED_TOKENS' }, (response) => {
            if (response && response.ok) {
                console.log('[Vinted HQ CSRF] Retrieved sniffed tokens:', response);
                resolve({ csrfToken: response.csrfToken, anonId: response.anonId });
            } else {
                console.warn('[Vinted HQ CSRF] Failed to retrieve sniffed tokens.');
                resolve({ csrfToken: null, anonId: null });
            }
        });
    });
}

/**
 * Fetch HttpOnly cookies via background Service Worker.
 */
// @ts-ignore: kept for future use
function getCookiesFromBackground(): Promise<chrome.cookies.Cookie[]> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_VINTED_COOKIES' }, (response) => {
            if (response && response.ok && response.cookies) {
                resolve(response.cookies);
            } else {
                console.warn('[Vinted HQ BG] Failed to fetch cookies via background.');
                resolve([]);
            }
        });
    });
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

    // ── Dropdown Puppeteering (Phase D.1) ──
    // Must be sequential — React Headless UI modals steal focus from each other
    try {
        if (data.status_id) {
            const ok = await selectCondition(data.status_id);
            if (ok) filled++;
        }
    } catch (e) { console.warn('[Vinted HQ] ⚠️ Failed to select condition:', e); }

    try {
        if (data.size_id) {
            const ok = await selectSize(data.size_id);
            if (ok) filled++;
        }
    } catch (e) { console.warn('[Vinted HQ] ⚠️ Failed to select size:', e); }

    try {
        if (data.package_size_id) {
            const ok = await selectPackageSize(data.package_size_id);
            if (ok) filled++;
        }
    } catch (e) { console.warn('[Vinted HQ] ⚠️ Failed to select package size:', e); }

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

    // ── Phase D.1d: Extension-Mediated API Fetch ────────────────────────
    // The ontology schema (materials with labels, sizes with labels) is NOT
    // pre-hydrated in the SSR HTML. It's only available via Vinted's API.
    // We use the background service worker to execute fetch() in the page's
    // MAIN WORLD context — this uses Vinted's own Datadome-patched fetch,
    // bypassing WAF restrictions that block server-side Python calls.

    const catalogId = data.catalogId || data.catalog_id;

    if (catalogId) {
        console.log(`[Vinted HQ] 🔄 Fetching ontology schema via Main World for catalog ${catalogId}...`);

        // Fetch attributes (materials schema) via Main World
        try {
            const attrResult: any = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    type: 'FETCH_ATTRIBUTES_MAIN_WORLD',
                    catalogId: Number(catalogId),
                }, (response) => resolve(response));
            });

            if (attrResult?.ok && attrResult.data?.attributes) {
                const attrs = attrResult.data.attributes;
                console.log(`[Vinted HQ] 🎯 Main World attributes fetch: ${attrs.length} attribute groups`);
                data._hq_attributes_schema = attrResult.data;

                // Forward full schema to Python bridge cache
                bridgeFetch('/ingest/materials', 'POST', {
                    catalog_id: Number(catalogId),
                    attributes: attrs
                }).then(r => {
                    if (r.ok) console.log('[Vinted HQ] ✅ Attributes schema cached in backend.');
                    else console.warn('[Vinted HQ] ⚠️ Attributes cache response:', r.error);
                }).catch(err => console.error('[Vinted HQ] Failed to cache attributes:', err));
            } else {
                console.warn('[Vinted HQ] ⚠️ Main World attributes fetch failed:', attrResult?.error);
            }
        } catch (err) {
            console.error('[Vinted HQ] ⚠️ FETCH_ATTRIBUTES_MAIN_WORLD error:', err);
        }

        // Fetch sizes via Main World
        try {
            const sizesResult: any = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    type: 'FETCH_SIZES_MAIN_WORLD',
                    catalogId: Number(catalogId),
                }, (response) => resolve(response));
            });

            if (sizesResult?.ok && sizesResult.data?.size_groups) {
                const groups = sizesResult.data.size_groups;
                // Flatten sizes from all groups
                const allSizes = groups.flatMap((g: any) => g.sizes || []);
                console.log(`[Vinted HQ] 🎯 Main World sizes fetch: ${allSizes.length} sizes from ${groups.length} groups`);
                data._hq_sizes_schema = allSizes;

                // Forward to Python bridge cache (skip if this category has no sizes)
                if (allSizes.length > 0) {
                    bridgeFetch('/ingest/sizes', 'POST', {
                        catalog_id: Number(catalogId),
                        sizes: allSizes
                    }).then(r => {
                        if (r.ok) console.log('[Vinted HQ] ✅ Sizes schema cached in backend.');
                        else console.warn('[Vinted HQ] ⚠️ Sizes cache response:', r.error);
                    }).catch(err => console.error('[Vinted HQ] Failed to cache sizes:', err));
                } else {
                    console.log('[Vinted HQ] ℹ️ Category has no sizes — skipping cache.');
                }
            } else {
                console.warn('[Vinted HQ] ⚠️ Main World sizes fetch failed:', sizesResult?.error);
            }
        } catch (err) {
            console.error('[Vinted HQ] ⚠️ FETCH_SIZES_MAIN_WORLD error:', err);
        }
    } else {
        console.warn('[Vinted HQ] ⚠️ No catalogId found, skipping ontology fetch.');
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

    // ── 5. Sanitize RSC reference values ──────────────────────────────────
    // Next.js RSC serializes JS `undefined` as "$undefined" and internal
    // references as "$L5", "$Sreact.suspense" etc. These must be nullified
    // before sending to the bridge to prevent them from being stored as
    // literal strings in numeric database columns.
    const rscFields = [
        'statusId', 'status_id', 'brandId', 'brand_id', 'sizeId', 'size_id',
        'catalogId', 'catalog_id', 'categoryId', 'category_id',
        'packageSizeId', 'package_size_id', 'isbn', 'isbn13',
        'measurementWidth', 'measurement_width', 'measurementLength', 'measurement_length',
        'video_game_rating_id', 'collection_id', 'model_id',
    ];
    for (const field of rscFields) {
        if (typeof data[field] === 'string' && data[field].startsWith('$')) {
            console.log(`[Vinted HQ] 🧹 Sanitized RSC reference: ${field} = "${data[field]}" → null`);
            data[field] = null;
        }
    }
    // Also sanitize short-string text fields that might be RSC refs
    for (const textField of ['brandTitle', 'brand_title', 'sizeTitle', 'size_title', 'condition']) {
        if (typeof data[textField] === 'string' && data[textField].startsWith('$') && data[textField].length < 15) {
            console.log(`[Vinted HQ] 🧹 Sanitized RSC reference: ${textField} = "${data[textField]}" → null`);
            data[textField] = null;
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
