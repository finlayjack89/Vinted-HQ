/**
 * Vinted HQ — Main World Fetch Interceptor
 * 
 * This script runs in Vinted's MAIN WORLD at document_start, BEFORE any
 * Vinted/Datadome JavaScript executes. It wraps window.fetch to intercept
 * Vinted's own API responses and relays captured JSON to our Isolated World
 * content script via window.postMessage.
 *
 * Pure passive eavesdrop architecture. We intercept organic Vinted React
 * API calls because they possess valid Datadome telemetry.
 */

(function () {
    const originalFetch = window.fetch;

    window.fetch = async function (...args: Parameters<typeof fetch>) {
        const response = await originalFetch.apply(this, args);

        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';

        // Intercept attributes (materials schema)
        if (url.includes('/api/v2/item_upload/attributes')) {
            try {
                const clone = response.clone();
                const data = await clone.json();
                console.log('[Vinted HQ Interceptor] 🎯 Captured attributes response:', data);
                window.postMessage({
                    type: 'VINTED_HQ_ATTRIBUTES_CAPTURED',
                    payload: data,
                }, '*');
            } catch (e) {
                console.error('[Vinted HQ Interceptor] Failed to parse intercepted attributes:', e);
            }
        }

        // Intercept sizes
        if (url.includes('/size_groups')) {
            try {
                const clone = response.clone();
                const data = await clone.json();
                console.log('[Vinted HQ Interceptor] 🎯 Captured sizes response:', data);
                window.postMessage({
                    type: 'VINTED_HQ_SIZES_CAPTURED',
                    payload: data,
                }, '*');
            } catch (e) {
                console.error('[Vinted HQ Interceptor] Failed to parse intercepted sizes:', e);
            }
        }

        return response;
    };

    console.log('[Vinted HQ Interceptor] ✅ Fetch interceptor installed at document_start');
})();
