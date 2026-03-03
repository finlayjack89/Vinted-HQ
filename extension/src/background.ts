/**
 * Vinted HQ Background Service Worker
 * Proxies fetch requests from the content script to the local Python bridge.
 * In Manifest V3, the service worker has full cross-origin access via host_permissions,
 * while content scripts may be blocked by CORS or CSP on the host page.
 */

const BRIDGE_BASE = 'http://localhost:37421';

console.log('[Vinted HQ BG] Service worker started');

chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
    console.log('[Vinted HQ BG] Received message:', message);

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

    if (message.type === 'VINTED_FETCH') {
        const { url, method, headers, body } = message;
        console.log(`[Vinted HQ BG] Proxying Vinted API Fetch: ${method} ${url}`);

        const options: RequestInit = {
            method: method || 'GET',
            headers: headers || {},
        };
        if (body) {
            options.body = JSON.stringify(body);
        }

        fetch(url, options)
            .then(async (res) => {
                console.log(`[Vinted HQ BG] Vinted API response status: ${res.status}`);
                const data = await res.json();
                sendResponse({ ok: res.ok, status: res.status, data });
            })
            .catch((err) => {
                console.error('[Vinted HQ BG] Vinted API fetch error:', err);
                sendResponse({ ok: false, error: String(err) });
            });

        return true;
    }
});
