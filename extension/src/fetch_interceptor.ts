/**
 * Vinted HQ — Main World Fetch Interceptor
 * 
 * This script runs in Vinted's MAIN WORLD at document_start, BEFORE any
 * Vinted/Datadome JavaScript executes. It wraps window.fetch to intercept
 * Vinted's own API responses (specifically /api/v2/item_upload/attributes)
 * and relays the captured data back to our Isolated World content script
 * via window.postMessage.
 *
 * This is the "eavesdrop" pattern: zero WAF risk because we never generate
 * our own API calls. We piggyback on Vinted's React code which already has
 * perfect Datadome telemetry, CSRF tokens, and session context.
 */

(function () {
    const originalFetch = window.fetch;

    window.fetch = async function (...args: Parameters<typeof fetch>) {
        // Let the native (Datadome-wrapped) request fire normally
        const response = await originalFetch.apply(this, args);

        // Check if this is the attributes endpoint we want to intercept
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';

        if (url.includes('/api/v2/item_upload/attributes')) {
            try {
                // Clone the response so we don't consume the stream for React
                const clone = response.clone();
                const data = await clone.json();

                console.log('[Vinted HQ Interceptor] 🎯 Captured attributes response:', data);

                // Relay the captured data to the Isolated World content script
                window.postMessage({
                    type: 'VINTED_HQ_ATTRIBUTES_CAPTURED',
                    payload: data,
                }, '*');
            } catch (e) {
                console.error('[Vinted HQ Interceptor] Failed to parse intercepted response:', e);
            }
        }

        // Always return the original response to Vinted's React code
        return response;
    };

    console.log('[Vinted HQ Interceptor] ✅ Fetch interceptor installed at document_start');
})();
