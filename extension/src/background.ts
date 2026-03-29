/**
 * Seller HQ Background Service Worker
 * Proxies fetch requests from the content script to the local Python bridge.
 * In Manifest V3, the service worker has full cross-origin access via host_permissions,
 * while content scripts may be blocked by CORS or CSP on the host page.
 *
 * Session Harvesting: Passively extracts Vinted cookies and CSRF tokens,
 * then POSTs them to the local Python bridge for Electron DB sync.
 */

const BRIDGE_BASE = 'http://localhost:37421';

let cachedCsrfToken: string | null = null;
let cachedAnonId: string | null = null;
let cachedUserAgent: string | null = null;

// ─── Session Harvesting ─────────────────────────────────────────────────────
// Silently captures the active Vinted session from Chrome and transmits it
// to the local Python bridge. Leverages the high trust-score of the user's
// primary Chrome browser (already logged into Vinted).

const SESSION_ALARM_NAME = 'seller-hq-session-harvest';
const SESSION_HARVEST_INTERVAL_MINUTES = 5;

/** Target cookies we need for a complete session. */
const REQUIRED_COOKIES = ['access_token_web'];

/**
 * Harvest the active Vinted session from Chrome cookies.
 * Validates that access_token_web exists (user is logged in),
 * compiles a JSON payload, and POSTs to the Python bridge.
 */
async function harvestSession(): Promise<void> {
    console.log('[Seller HQ BG] 🔑 Starting session harvest...');

    try {
        // 1. Extract all Vinted cookies
        const allCookies = await chrome.cookies.getAll({ domain: '.vinted.co.uk' });
        if (!allCookies || allCookies.length === 0) {
            console.log('[Seller HQ BG] 🔑 No Vinted cookies found — user may not have visited Vinted.');
            return;
        }

        // 2. Build cookie map for validation and payload
        const cookieMap: Record<string, string> = {};
        for (const c of allCookies) {
            cookieMap[c.name] = c.value;
        }

        // 3. Abort if access_token_web is missing (user is logged out)
        const missingRequired = REQUIRED_COOKIES.filter(name => !cookieMap[name]);
        if (missingRequired.length > 0) {
            console.log(`[Seller HQ BG] 🔑 Session harvest aborted — user not logged in. Missing: ${missingRequired.join(', ')}`);
            return;
        }

        // 4. Build the cookie header string (same format as Electron's secureStorage)
        const cookieHeader = allCookies
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => `${c.name}=${c.value}`)
            .join('; ');

        // 5. Compile session payload
        const payload = {
            cookies: cookieMap,
            cookie_header: cookieHeader,
            csrf_token: cachedCsrfToken || null,
            user_agent: cachedUserAgent || navigator.userAgent,
            anon_id: cachedAnonId || cookieMap['anon_id'] || null,
            timestamp: Date.now(),
            source: 'chrome_extension',
        };

        console.log(`[Seller HQ BG] 🔑 Session compiled: ${allCookies.length} cookies, CSRF=${!!cachedCsrfToken}, UA=${!!cachedUserAgent}`);

        // 6. POST to Python bridge
        const res = await fetch(`${BRIDGE_BASE}/ingest/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (data.ok) {
            console.log('[Seller HQ BG] 🔑 ✅ Session harvested and synced to bridge successfully.');
        } else {
            console.warn('[Seller HQ BG] 🔑 ⚠️ Bridge rejected session:', data.message || data.error);
        }
    } catch (err) {
        // Bridge may not be running — this is expected during development
        console.warn('[Seller HQ BG] 🔑 Session harvest failed (bridge may be offline):', String(err));
    }
}

// Trigger session harvest on extension startup and install
chrome.runtime.onStartup.addListener(() => {
    console.log('[Seller HQ BG] 🔑 Browser startup — scheduling session harvest.');
    // Small delay to allow cookies to settle after browser launch
    setTimeout(harvestSession, 3000);
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('[Seller HQ BG] 🔑 Extension installed/updated — scheduling session harvest.');
    setTimeout(harvestSession, 2000);

    // Set up periodic harvest alarm
    chrome.alarms.create(SESSION_ALARM_NAME, {
        delayInMinutes: SESSION_HARVEST_INTERVAL_MINUTES,
        periodInMinutes: SESSION_HARVEST_INTERVAL_MINUTES,
    });
});

// Periodic harvest via alarms API
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SESSION_ALARM_NAME) {
        harvestSession();
    }
});

// Harvest when user navigates to Vinted (tab update with Vinted URL)
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('vinted.co.uk')) {
        // Debounce: don't re-harvest on every sub-navigation
        harvestSession();
    }
});

// Harvest when a Vinted tab gains focus (e.g. opened by Electron app via `open -a Chrome`)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url && tab.url.includes('vinted.co.uk')) {
            console.log('[Seller HQ BG] 🔑 Vinted tab activated — triggering harvest.');
            harvestSession();
        }
    } catch {
        // Tab may have been closed before we could query it
    }
});

// ─── Network Sniffing (CSRF, Anon ID, User-Agent) ──────────────────────────
// Sniff all Vinted API requests to dynamically capture tokens from headers.

chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        if (details.requestHeaders) {
            for (const header of details.requestHeaders) {
                const lowerName = header.name.toLowerCase();
                if (lowerName === 'x-csrf-token') {
                    if (header.value && header.value !== cachedCsrfToken) {
                        cachedCsrfToken = header.value;
                        console.log(`[Seller HQ BG] 🛡️ Sniffed new CSRF token from network: ${cachedCsrfToken}`);
                    }
                }
                if (lowerName === 'x-anon-id') {
                    if (header.value && header.value !== cachedAnonId) {
                        cachedAnonId = header.value;
                        console.log(`[Seller HQ BG] 🛡️ Sniffed new Anon ID from network: ${cachedAnonId}`);
                    }
                }
                if (lowerName === 'user-agent') {
                    if (header.value && header.value !== cachedUserAgent) {
                        cachedUserAgent = header.value;
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
        console.log(`[Seller HQ BG] 🔇 Deactivated sync tab ${tabId} — running in background`);
    }
});

chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: any) => {
    console.log('[Seller HQ BG] Received message:', message);

    if (message.type === 'GET_SNIFFED_TOKENS') {
        sendResponse({ ok: true, csrfToken: cachedCsrfToken, anonId: cachedAnonId });
        return true;
    }

    // ── Proactive CSRF Token Push from Content Script ──
    // Content script scrapes CSRF from DOM and pushes it here.
    // This is more reliable than sniffing network headers alone.
    if (message.type === 'SESSION_CSRF_TOKEN') {
        const token = message.token;
        if (token && typeof token === 'string' && token !== cachedCsrfToken) {
            cachedCsrfToken = token;
            console.log(`[Seller HQ BG] 🔑 CSRF token received from content script: ${token.slice(0, 10)}...`);
            // Re-harvest session with the fresh CSRF token
            harvestSession();
        }
        sendResponse({ ok: true });
        return true;
    }

    // ── Manual harvest trigger (from popup or external) ──
    if (message.type === 'HARVEST_SESSION') {
        harvestSession().then(() => sendResponse({ ok: true }));
        return true;
    }

    if (message.type === 'BRIDGE_FETCH') {
        const { method, path, body } = message;
        const url = `${BRIDGE_BASE}${path}`;

        console.log(`[Seller HQ BG] Fetching ${method || 'GET'} ${url}`);

        const options: RequestInit = {
            method: method || 'GET',
            headers: { 'Content-Type': 'application/json' },
        };
        if (body) {
            options.body = JSON.stringify(body);
        }

        fetch(url, options)
            .then(async (res) => {
                console.log(`[Seller HQ BG] Fetch response status: ${res.status}`);
                const data = await res.json();
                console.log('[Seller HQ BG] Sending response back to content script:', data);
                sendResponse({ ok: true, data });
            })
            .catch((err) => {
                console.error('[Seller HQ BG] Fetch error:', err);
                sendResponse({ ok: false, error: String(err) });
            });

        return true;
    }

    if (message.type === 'GET_VINTED_COOKIES') {
        chrome.cookies.getAll({ domain: '.vinted.co.uk' }, (cookies) => {
            console.log(`[Seller HQ BG] Fetched ${cookies.length} cookies for vinted.co.uk`);
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
        console.log(`[Seller HQ BG] Executing Main World attributes fetch on tab ${tabId} for category ${catalogId}...`);

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
                    console.log('[Seller HQ BG] ✅ Main World attributes fetch succeeded:', result);
                    sendResponse({ ok: true, data: result });
                } else {
                    console.warn('[Seller HQ BG] ⚠️ Main World attributes fetch returned error:', result);
                    sendResponse({ ok: false, error: result?.error || 'Empty result' });
                }
            })
            .catch((err: Error) => {
                console.error('[Seller HQ BG] Main World executeScript failed:', err);
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
        console.log(`[Seller HQ BG] Executing Main World sizes fetch on tab ${tabId} for category ${catalogId}...`);

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
                    console.log('[Seller HQ BG] ✅ Main World sizes fetch succeeded:', result);
                    sendResponse({ ok: true, data: result });
                } else {
                    console.warn('[Seller HQ BG] ⚠️ Main World sizes fetch returned error:', result);
                    sendResponse({ ok: false, error: result?.error || 'Empty result' });
                }
            })
            .catch((err: Error) => {
                console.error('[Seller HQ BG] Main World sizes executeScript failed:', err);
                sendResponse({ ok: false, error: String(err) });
            });

        return true;
    }

    if (message.type === 'FETCH_ITEM_MAIN_WORLD') {
        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({ ok: false, error: 'No active tab ID' });
            return true;
        }

        const { itemId } = message;
        console.log(`[Seller HQ BG] Executing Main World item fetch on tab ${tabId} for item ${itemId}...`);

        chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (id: string | number, csrfToken: string, anonId: string) => {
                return fetch(`/api/v2/items/${id}`, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'locale': 'en-GB',
                        'x-csrf-token': csrfToken,
                        'x-anon-id': anonId,
                    },
                })
                    .then((res: Response) => res.json())
                    .catch((err: Error) => ({ error: String(err) }));
            },
            args: [itemId, cachedCsrfToken || '', cachedAnonId || ''],
        })
            .then((injectionResults: any[]) => {
                const result = injectionResults?.[0]?.result;
                if (result && !result.error) {
                    console.log('[Seller HQ BG] ✅ Main World item fetch succeeded');
                    sendResponse({ ok: true, data: result });
                } else {
                    console.warn('[Seller HQ BG] ⚠️ Main World item fetch returned error:', result);
                    sendResponse({ ok: false, error: result?.error || 'Empty result' });
                }
            })
            .catch((err: Error) => {
                console.error('[Seller HQ BG] Main World executeScript failed:', err);
                sendResponse({ ok: false, error: String(err) });
            });

        return true;
    }

    if (message.type === 'GET_VINTED_CSRF_TOKEN') {
        if (!sender.tab?.id) {
            sendResponse({ ok: false, error: 'No active tab ID found for script injection.' });
            return false;
        }

        console.log(`[Seller HQ BG] Executing Main World script on tab ${sender.tab.id}...`);

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
                        console.log(`[Seller HQ BG] Successfully extracted token from Main World:`, frameResult.result);
                        sendResponse({ ok: true, token: frameResult.result });
                        return;
                    }
                }
                sendResponse({ ok: false, error: 'Token not found in Main World evaluation.' });
            })
            .catch((err) => {
                console.error('[Seller HQ BG] ExecuteScript failed:', err);
                sendResponse({ ok: false, error: String(err) });
            });

        return true;
    }
});
