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

        // Return true to indicate we will send a response asynchronously
        return true;
    }
});
