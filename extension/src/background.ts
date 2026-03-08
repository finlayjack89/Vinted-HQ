/**
 * Vinted HQ Background Service Worker
 * Proxies fetch requests from the content script to the local Python bridge.
 * In Manifest V3, the service worker has full cross-origin access via host_permissions,
 * while content scripts may be blocked by CORS or CSP on the host page.
 */

const BRIDGE_BASE = 'http://localhost:37421';

let cachedCsrfToken: string | null = null;
let cachedAnonId: string | null = null;

// Sniff all Vinted API requests to dynamically capture the CSRF token from headers
// This mimics how dotb.io and other extensions bypass DOM protection.
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        if (details.requestHeaders) {
            for (const header of details.requestHeaders) {
                if (header.name.toLowerCase() === 'x-csrf-token') {
                    if (header.value && header.value !== cachedCsrfToken) {
                        cachedCsrfToken = header.value;
                        console.log(`[Vinted HQ BG] 🛡️ Sniffed new CSRF token from network: ${cachedCsrfToken}`);
                    }
                }
                if (header.name.toLowerCase() === 'x-anon-id') {
                    if (header.value && header.value !== cachedAnonId) {
                        cachedAnonId = header.value;
                        console.log(`[Vinted HQ BG] 🛡️ Sniffed new Anon ID from network: ${cachedAnonId}`);
                    }
                }
            }
        }
        return { requestHeaders: details.requestHeaders };
    },
    { urls: ["*://*.vinted.co.uk/api/*", "*://www.vinted.co.uk/api/*"] },
    ["requestHeaders", "extraHeaders"]
);

// ── Background Tab Deactivation for Deep Sync ──
// When the Electron app triggers a deep sync by opening a Vinted edit URL
// with ?hq_sync=true, we immediately deactivate the tab so it loads
// invisibly in the background. The content script still runs normally
// on inactive tabs — DOM parsing, fetch interception, and messaging
// are all unaffected by tab visibility state.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url && changeInfo.url.includes('hq_sync=true')) {
        chrome.tabs.update(tabId, { active: false });
        console.log(`[Vinted HQ BG] 🔇 Deactivated sync tab ${tabId} — running in background`);
    }
});

chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: any) => {
    console.log('[Vinted HQ BG] Received message:', message);

    if (message.type === 'GET_SNIFFED_TOKENS') {
        sendResponse({ ok: true, csrfToken: cachedCsrfToken, anonId: cachedAnonId });
        return true;
    }

    if (message.type === 'BRIDGE_FETCH') {
        const { method, path, body } = message;
        const url = `${BRIDGE_BASE}${path}`;

        console.log(`[Vinted HQ BG] Fetching ${method || 'GET'} ${url}`);

        const options: RequestInit = {
            method: method || 'GET',
            headers: { 'Content-Type': 'application/json' },
        };
        if (body) {
            options.body = JSON.stringify(body);
        }

        fetch(url, options)
            .then(async (res) => {
                console.log(`[Vinted HQ BG] Fetch response status: ${res.status}`);
                const data = await res.json();
                console.log('[Vinted HQ BG] Sending response back to content script:', data);
                sendResponse({ ok: true, data });
            })
            .catch((err) => {
                console.error('[Vinted HQ BG] Fetch error:', err);
                sendResponse({ ok: false, error: String(err) });
            });

        return true;
    }

    if (message.type === 'GET_VINTED_COOKIES') {
        chrome.cookies.getAll({ domain: '.vinted.co.uk' }, (cookies) => {
            console.log(`[Vinted HQ BG] Fetched ${cookies.length} cookies for vinted.co.uk`);
            sendResponse({ ok: true, cookies });
        });
        return true;
    }

    if (message.type === 'FETCH_ATTRIBUTES_MAIN_WORLD') {
        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({ ok: false, error: 'No active tab ID' });
            return true;
        }

        const { catalogId, brandId, statusId } = message;
        console.log(`[Vinted HQ BG] Executing Main World attributes fetch on tab ${tabId} for category ${catalogId}...`);

        chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (catId: number, _brId: number | null, _stId: number | null, csrfToken: string, anonId: string) => {
                // This runs in Vinted's Main World — using Datadome's monkey-patched fetch().
                // Only send category — HAR proves adding brand+status returns empty/restricted results.
                const payload: any = { attributes: [{ code: 'category', value: [catId] }] };

                // Execute fetch using the page's own (Datadome-patched) fetch API
                // CSRF token and anon ID are passed from the webRequest sniffer
                return fetch('/api/v2/item_upload/attributes', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/plain, */*,image/webp',
                        'accept-features': 'ALL',
                        'locale': 'en-GB',
                        'x-csrf-token': csrfToken,
                        'x-anon-id': anonId,
                    },
                    body: JSON.stringify(payload),
                })
                    .then((res: Response) => res.json())
                    .catch((err: Error) => ({ error: String(err) }));
            },
            args: [catalogId, brandId || null, statusId || null, cachedCsrfToken || '', cachedAnonId || ''],
        })
            .then((injectionResults: any[]) => {
                const result = injectionResults?.[0]?.result;
                if (result && !result.error) {
                    console.log('[Vinted HQ BG] ✅ Main World attributes fetch succeeded:', result);
                    sendResponse({ ok: true, data: result });
                } else {
                    console.warn('[Vinted HQ BG] ⚠️ Main World attributes fetch returned error:', result);
                    sendResponse({ ok: false, error: result?.error || 'Empty result' });
                }
            })
            .catch((err: Error) => {
                console.error('[Vinted HQ BG] Main World executeScript failed:', err);
                sendResponse({ ok: false, error: String(err) });
            });

        return true;
    }

    if (message.type === 'FETCH_SIZES_MAIN_WORLD') {
        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({ ok: false, error: 'No active tab ID' });
            return true;
        }

        const { catalogId } = message;
        console.log(`[Vinted HQ BG] Executing Main World sizes fetch on tab ${tabId} for category ${catalogId}...`);

        chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (catId: number, csrfToken: string, anonId: string) => {
                return fetch(`/api/v2/item_upload/size_groups?catalog_ids=${catId}`, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'locale': 'en-GB',
                        'x-csrf-token': csrfToken,
                        'x-anon-id': anonId,
                    },
                })
                    .then((res: Response) => {
                        // Vinted returns 404 for categories with no sizes (e.g. Handbags).
                        // The 404 body is HTML, not JSON, so calling .json() would throw.
                        if (res.status === 404) return { size_groups: [], code: 0 };
                        if (!res.ok) return { error: `HTTP ${res.status}` };
                        return res.json();
                    })
                    .catch((err: Error) => ({ error: String(err) }));
            },
            args: [catalogId, cachedCsrfToken || '', cachedAnonId || ''],
        })
            .then((injectionResults: any[]) => {
                const result = injectionResults?.[0]?.result;
                if (result && !result.error) {
                    console.log('[Vinted HQ BG] ✅ Main World sizes fetch succeeded:', result);
                    sendResponse({ ok: true, data: result });
                } else {
                    console.warn('[Vinted HQ BG] ⚠️ Main World sizes fetch returned error:', result);
                    sendResponse({ ok: false, error: result?.error || 'Empty result' });
                }
            })
            .catch((err: Error) => {
                console.error('[Vinted HQ BG] Main World sizes executeScript failed:', err);
                sendResponse({ ok: false, error: String(err) });
            });

        return true;
    }

    if (message.type === 'GET_VINTED_CSRF_TOKEN') {
        if (!sender.tab?.id) {
            sendResponse({ ok: false, error: 'No active tab ID found for script injection.' });
            return false;
        }

        console.log(`[Vinted HQ BG] Executing Main World script on tab ${sender.tab.id}...`);

        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            world: 'MAIN',
            func: () => {
                let token = null;

                try {
                    const meta = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement;
                    if (meta && meta.content) token = meta.content;
                } catch (e) { }

                if (!token && (window as any).__NEXT_DATA__) {
                    try {
                        const json = (window as any).__NEXT_DATA__;
                        token = json.runtimeConfig?.csrfToken || json.props?.pageProps?.csrfToken;
                    } catch (e) { }
                }

                if (!token && (window as any).vinted && (window as any).vinted.csrfToken) {
                    token = (window as any).vinted.csrfToken;
                }

                if (!token && (window as any).CSRFProtection && typeof (window as any).CSRFProtection.token === 'function') {
                    token = (window as any).CSRFProtection.token();
                }

                return token || null;
            }
        })
            .then((injectionResults) => {
                for (const frameResult of injectionResults) {
                    if (frameResult.result) {
                        console.log(`[Vinted HQ BG] Successfully extracted token from Main World:`, frameResult.result);
                        sendResponse({ ok: true, token: frameResult.result });
                        return;
                    }
                }
                sendResponse({ ok: false, error: 'Token not found in Main World evaluation.' });
            })
            .catch((err) => {
                console.error('[Vinted HQ BG] ExecuteScript failed:', err);
                sendResponse({ ok: false, error: String(err) });
            });

        return true;
    }
});
