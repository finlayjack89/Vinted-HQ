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

// ─── Deep Sync (Phase C.2) ──────────────────────────────────────────────────

function extractItemIdFromPathname(): string | null {
    const match = window.location.pathname.match(/\/items\/(\d+)/);
    return match ? match[1] : null;
}

async function runDeepSync() {
    const itemId = extractItemIdFromPathname();
    if (!itemId) {
        console.error('[Vinted HQ] Could not extract item_id from URL for deep sync.');
        showBanner('Could not determine item ID.', 'error');
        return;
    }

    showBanner('Deep syncing item details…', 'info');
    console.log(`[Vinted HQ] Deep sync: reading __NEXT_DATA__ for item ${itemId}`);

    // Read __NEXT_DATA__ directly from the DOM — no inline script needed (avoids CSP blocks)
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    let data: any = null;

    if (nextDataEl?.textContent) {
        try {
            const parsed = JSON.parse(nextDataEl.textContent);
            const pageProps = parsed?.props?.pageProps;
            console.log('[Vinted HQ] __NEXT_DATA__ found. pageProps keys:', pageProps ? Object.keys(pageProps) : 'no pageProps');

            // Try various keys Vinted might use
            data = pageProps?.item
                || pageProps?.itemDto
                || pageProps?.itemData
                || pageProps?.product
                || pageProps?.listing
                || null;

            // If still null, check if the item data is at the top level of pageProps
            if (!data && pageProps) {
                // Look for any key that has an 'id' and 'title' (item-like object)
                for (const key of Object.keys(pageProps)) {
                    const val = pageProps[key];
                    if (val && typeof val === 'object' && 'id' in val && 'title' in val) {
                        console.log(`[Vinted HQ] Found item-like object under key "${key}"`);
                        data = val;
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('[Vinted HQ] Failed to parse __NEXT_DATA__:', e);
        }
    } else {
        console.warn('[Vinted HQ] No __NEXT_DATA__ element found in DOM');
    }

    if (!data) {
        console.error('[Vinted HQ] No item data found in __NEXT_DATA__.');
        showBanner('No item data found on this page.', 'error');
        return;
    }

    console.log('[Vinted HQ] Scraped item data:', data);

    // POST to the Python bridge via background service worker
    const result = await bridgeFetch('/ingest/item', 'POST', { item: data });

    if (result.ok && result.data?.ok) {
        console.log('[Vinted HQ] ✅ Deep sync complete:', result.data.message);
        showBanner('Deep sync complete! You can close this tab.', 'success');
        // Auto-close after a brief delay
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
} else if (window.location.pathname.includes('/edit') && window.location.search.includes('hq_mode=true')) {
    console.log('[Vinted HQ] ✨ HQ Mode activated — running Assisted Edit...');
    setTimeout(runAssistedEdit, 2000);
} else if (window.location.pathname.match(/\/items\/\d+/) && window.location.hash === '#hq_sync') {
    console.log('[Vinted HQ] 🔄 Deep Sync mode activated...');
    setTimeout(runDeepSync, 2000);
}
