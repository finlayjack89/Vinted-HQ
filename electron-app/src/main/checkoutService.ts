/**
 * Checkout Service — full one-click buy flow.
 * Orchestrates: build → verification → delivery → pickup → payment.
 * Uses sticky proxy for entire sequence.
 */

import { BrowserWindow } from 'electron';
import * as fs from 'fs';

const CHECKOUT_PROGRESS_CHANNEL = 'checkout:progress';
import * as bridge from './bridge';
import * as settings from './settings';
import { getDb } from './db';
import * as sessionService from './sessionService';
import * as proxyService from './proxyService';
import type { FeedItem } from './feedService';

const DEBUG_LOG = '/tmp/checkout-debug.log';
function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(DEBUG_LOG, line); } catch { /* ignore */ }
}

export interface CheckoutResult {
  ok: boolean;
  purchaseId?: string;
  redirectUrl?: string;
  message: string;
  code?: string;
}

/** Haversine distance in km */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Extract shipping_order_id from checkout build response */
function getShippingOrderId(data: unknown): number | null {
  const d = data as Record<string, unknown>;
  const purchase = d.purchase as { shipping_orders?: unknown[] } | undefined;
  const orders = purchase?.shipping_orders ?? d.shipping_orders ?? d.shipping_orders_list;
  if (Array.isArray(orders) && orders.length > 0) {
    const first = orders[0] as Record<string, unknown>;
    const id = first.id ?? first.shipping_order_id;
    if (typeof id === 'number') return id;
    if (typeof id === 'string') return parseInt(id, 10);
  }
  if (typeof d.shipping_order_id === 'number') return d.shipping_order_id;
  return null;
}

/** Extract available payment methods (card_id) from checkout response */
function getPaymentMethod(data: unknown, preferredCardId?: string): { card_id: string; pay_in_method_id: string } | null {
  const d = data as Record<string, unknown>;
  
  // The checkout response nests data inside checkout.components.payment_method
  const checkout = d.checkout as Record<string, unknown> | undefined;
  const comps = (checkout?.components ?? d.components ?? d) as Record<string, unknown>;
  const pmComp = comps.payment_method as Record<string, unknown> | undefined;
  
  // Collect all candidate arrays to search
  const candidateArrays: any[][] = [];
  
  // Direct top-level
  if (Array.isArray(d.payment_methods)) candidateArrays.push(d.payment_methods);
  if (Array.isArray(d.pay_in_methods)) candidateArrays.push(d.pay_in_methods);
  // Inside checkout.components.payment_method
  if (pmComp) {
    if (Array.isArray(pmComp.payment_methods)) candidateArrays.push(pmComp.payment_methods);
    if (Array.isArray(pmComp.pay_in_methods)) candidateArrays.push(pmComp.pay_in_methods);
  }
  // Inside purchase
  const purchase = d.purchase as Record<string, unknown> | undefined;
  if (purchase && Array.isArray(purchase.payment_methods)) candidateArrays.push(purchase.payment_methods);

  debugLog(`getPaymentMethod: found ${candidateArrays.length} candidate arrays, preferredCardId=${preferredCardId}`);
  
  for (const methods of candidateArrays) {
    if (methods.length === 0) continue;
    debugLog(`  checking array with ${methods.length} methods: ${JSON.stringify(methods.map((m: any) => ({id: m.id, card_id: m.card_id, type: m.type}))).slice(0, 500)}`);
    
    // Priority 1: Match preferredCardId from settings
    if (preferredCardId) {
      const preferred = methods.find((m: any) => String(m.id ?? m.card_id) === preferredCardId);
      if (preferred) {
        return {
          card_id: String(preferred.id ?? preferred.card_id),
          pay_in_method_id: String(preferred.pay_in_method_id ?? preferred.id ?? '1'),
        };
      }
    }

    // Priority 2: Use first available method
    const first = methods[0];
    const cardId = first.id ?? first.card_id;
    if (cardId) {
      return {
        card_id: String(cardId),
        pay_in_method_id: String(first.pay_in_method_id ?? first.id ?? '1'),
      };
    }
  }

  // Fallback: look for a single payment_method object
  const pm = pmComp ?? (d.purchase as any)?.payment_method ?? (d.purchase as any)?.default_payment_method ?? d.payment_method ?? d.default_payment_method;
  if (pm && typeof pm === 'object' && !Array.isArray(pm)) {
    const p = pm as Record<string, unknown>;
    const cardId = p.card_id ?? p.id;
    if (cardId) {
      debugLog(`  found single payment_method: card_id=${cardId}`);
      return { card_id: String(cardId), pay_in_method_id: '1' };
    }
  }
  
  debugLog('  NO payment method found');
  return null;
}

/** Extract pickup points from nearby_pickup_points response, sorted by distance */
function getPickupPointsSorted(
  data: unknown,
  userLat: number,
  userLon: number
): Array<{ rate_uuid: string; point_code: string; point_uuid: string }> {
  const d = data as Record<string, unknown>;
  let points: unknown[] = [];
  if (Array.isArray(d.pickup_points)) points = d.pickup_points;
  else if (Array.isArray(d.points)) points = d.points;
  else if (Array.isArray(d.nearby_pickup_points)) points = d.nearby_pickup_points;
  else if (Array.isArray(d.rates)) {
    for (const r of d.rates as unknown[]) {
      const rate = r as Record<string, unknown>;
      const pts = rate.pickup_points ?? rate.points;
      if (Array.isArray(pts)) points.push(...pts.map((p: unknown) => ({ ...(p as object), rate_uuid: rate.uuid ?? rate.id })));
    }
  }
  if (points.length === 0) return [];

  const withDist = points
    .map((p) => {
      const r = p as Record<string, unknown>;
      const lat = typeof r.latitude === 'number' ? r.latitude : parseFloat(String(r.latitude ?? 0));
      const lon = typeof r.longitude === 'number' ? r.longitude : parseFloat(String(r.longitude ?? 0));
      const dist = haversine(userLat, userLon, lat, lon);
      const rateObj = r.rate as { uuid?: string } | undefined;
      const rate = r.rate_uuid ?? (rateObj?.uuid ?? (r as { rate?: { uuid?: string } }).rate?.uuid);
      return {
        rate_uuid: String(rate ?? ''),
        point_code: String(r.point_code ?? r.code ?? r.id ?? ''),
        point_uuid: String(r.point_uuid ?? r.uuid ?? r.id ?? ''),
        dist,
      };
    })
    .filter((x) => x.rate_uuid && x.point_code);

  withDist.sort((a, b) => a.dist - b.dist);
  return withDist.map(({ rate_uuid, point_code, point_uuid }) => ({ rate_uuid, point_code, point_uuid }));
}

function emitProgress(step: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.isDestroyed()) {
      win.webContents.send(CHECKOUT_PROGRESS_CHANNEL, step);
    }
  }
}

export async function runCheckout(item: FeedItem, proxy?: string, sniperId?: number): Promise<CheckoutResult> {
  // Sticky Lock: prevent transport mode changes during checkout
  proxyService.setCheckoutActive(true);
  try {
    return await _executeCheckout(item, proxy, sniperId);
  } finally {
    proxyService.setCheckoutActive(false);
  }
}

async function _executeCheckout(item: FeedItem, proxy?: string, sniperId?: number): Promise<CheckoutResult> {
  const price = parseFloat(item.price) || 0;
  const s = settings.getAllSettings();
  const wantVerification =
    s.verificationEnabled && price >= s.verificationThresholdPounds;

  emitProgress('Fetching item details...');

  // The checkout/build endpoint expects a transaction_id (not the catalog listing id).
  // Vinted's web flow: POST /api/v2/conversations with initiator=buy → creates a
  // buy conversation which generates the transaction_id → use that for checkout/build.
  let orderId = item.order_id ?? item.id;
  debugLog(`=== CHECKOUT START === item=${JSON.stringify({id: item.id, order_id: item.order_id, seller_id: item.seller_id, title: item.title, price: item.price})}`);

  // Helper to extract txnId from conversation/item data
  function extractTxnId(data: Record<string, unknown>): number | null {
    // Conversation response may have transaction at top level or nested
    const conv = (data.conversation ?? data) as Record<string, unknown>;
    const txn = (conv.transaction ?? data.transaction) as Record<string, unknown> | undefined;
    const candidates = [
      txn?.id,
      conv.transaction_id,
      data.transaction_id,
      conv.order_id,
    ];
    for (const c of candidates) {
      if (typeof c === 'number' && c > 0) return c;
      if (typeof c === 'string' && parseInt(c, 10) > 0) return parseInt(c, 10);
    }
    return null;
  }

  // Primary approach: create a buy conversation to get the transaction_id
  if (item.seller_id) {
    emitProgress('Creating buy conversation...');
    try {
      const convResult = await bridge.createBuyConversation(item.id, item.seller_id, proxy);
      debugLog(`createBuyConversation ok=${convResult.ok}`);
      if (convResult.ok) {
        const convData = convResult.data as Record<string, unknown>;
        debugLog(`conversation data keys: ${Object.keys(convData).join(', ')}`);
        debugLog(`conversation data (first 2000): ${JSON.stringify(convData).slice(0, 2000)}`);
        const txnId = extractTxnId(convData);
        debugLog(`conversation txnId=${txnId}`);
        if (txnId) orderId = txnId;
      } else {
        debugLog(`createBuyConversation failed: ${JSON.stringify(convResult).slice(0, 300)}`);
      }
    } catch (e) {
      debugLog(`createBuyConversation exception: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    debugLog('No seller_id available — cannot create buy conversation');
  }

  debugLog(`FINAL orderId for build: ${orderId} (original item.id was ${item.id})`);
  if (orderId === item.id) {
    debugLog('WARNING: orderId equals item.id — transaction_id was NOT found. Checkout will likely 404.');
  }

  emitProgress('Initiating checkout...');

  const buildResult = await bridge.checkoutBuild(orderId, proxy);
    if (!buildResult.ok) {
      if (sessionService.isSessionExpiredError(buildResult)) {
        sessionService.emitSessionExpired();
      }
      const err = buildResult as { ok: false; message: string; code?: string };
      return {
        ok: false,
        message: err.message,
        code: err.code,
      };
    }

  const data = buildResult.data as Record<string, unknown>;
  debugLog(`checkout build response keys: ${Object.keys(data).join(', ')}`);
  debugLog(`checkout build response (first 2000): ${JSON.stringify(data).slice(0, 2000)}`);
  const purchaseId = (data.checkout as Record<string, unknown>)?.id ?? data.id ?? data.purchase_id ?? (data.purchase as Record<string, unknown>)?.id;
  debugLog(`extracted purchaseId: ${purchaseId} (type: ${typeof purchaseId})`);
  if (!purchaseId) {
    return { ok: false, message: 'Checkout build did not return purchase_id' };
  }

  const purchaseIdStr = String(purchaseId);
  emitProgress('Finalising checkout...');

  // First PUT: all components empty — Vinted assigns defaults automatically (HAR-verified)
  const components: Record<string, unknown> = {
    item_presentation_escrow_v2: {},
    additional_service: {},
    payment_method: {},
    shipping_address: {},
    shipping_pickup_options: {},
    shipping_pickup_details: {},
  };

  debugLog(`checkout PUT components: ${JSON.stringify(components)}`);
  const putResult = await bridge.checkoutPut(purchaseIdStr, components, proxy);
  debugLog(`checkout PUT ok=${putResult.ok}`);
  if (putResult.ok) {
    debugLog(`checkout PUT response (first 2000): ${JSON.stringify(putResult.data).slice(0, 2000)}`);
  }
  if (!putResult.ok) {
    if (sessionService.isSessionExpiredError(putResult)) {
      sessionService.emitSessionExpired();
    }
    const err = putResult as { ok: false; message: string; code?: string };
    debugLog(`checkout PUT failed: ${err.message}`);
    return { ok: false, message: err.message, code: err.code };
  }

   // Extract checksum from PUT #1 response (needed as fallback)
  const putData = putResult.data as Record<string, unknown>;
  const checkout1 = putData.checkout as Record<string, unknown> | undefined;
  const comps1 = (checkout1?.components ?? putData.components ?? {}) as Record<string, unknown>;
  
  // Step 4: Select the preferred courier from available shipping options
  emitProgress('Selecting courier...');
  const deliveryKey = s.deliveryType === 'home' ? 'home' : 'pickup';
  const spdComp = comps1.shipping_pickup_details as Record<string, unknown> | undefined;
  const pickupTypes = (spdComp?.pickup_types ?? {}) as Record<string, unknown>;
  const typeData = pickupTypes[deliveryKey] as Record<string, unknown> | undefined;
  const shippingOptions = (typeData?.shipping_options ?? []) as Array<Record<string, unknown>>;
  
  debugLog(`available carriers for '${deliveryKey}': ${JSON.stringify(shippingOptions.map(o => ({
    carrier: o.carrier_code, title: o.title, rate_uuid: o.rate_uuid, delivery_type: o.delivery_type
  })))}`);

  // Match carrier_code against user's defaultCourier setting
  // Normalize: replace underscores/spaces with hyphens, case-insensitive
  const normalizeName = (s: string) => s.toUpperCase().replace(/[_ ]+/g, '-');
  const courierPref = normalizeName(s.defaultCourier ?? '');
  let selectedOption = shippingOptions.find(
    o => normalizeName(String(o.carrier_code ?? '')).includes(courierPref)
  );
  if (!selectedOption && shippingOptions.length > 0) {
    selectedOption = shippingOptions[0]; // Fallback to first available
    debugLog(`preferred courier '${courierPref}' not found, using default: ${selectedOption.carrier_code}`);
  }

  // Build shipping_pickup_details for PUT#2
  // HAR shows the correct format: shipping_pickup_details: { rate_uuid: "..." }
  // shipping_pickup_options stays EMPTY {} — the web app never puts anything there for carrier changes
  let shippingPickupDetails: Record<string, unknown> = {};
  if (selectedOption) {
    const rateUuid = String(selectedOption.rate_uuid);
    shippingPickupDetails = {
      rate_uuid: rateUuid,
    };
    debugLog(`selected courier: ${selectedOption.carrier_code} (rate_uuid=${rateUuid})`);
  } else {
    debugLog('no shipping options found — leaving shipping_pickup_details empty');
  }

  // Step 5: Second PUT — select payment method + courier
  if (!s.defaultCardId) {
    return { ok: false, message: 'No default card ID configured. Set a card in Checkout settings.' };
  }
  
  const paymentMethod = {
    card_id: s.defaultCardId,
    pay_in_method_id: '1',
  };
  debugLog(`payment method for PUT#2: ${JSON.stringify(paymentMethod)}`);

  const components2: Record<string, unknown> = {
    item_presentation_escrow_v2: {},
    additional_service: {},
    payment_method: paymentMethod,
    shipping_address: {},
    shipping_pickup_options: {},
    shipping_pickup_details: shippingPickupDetails,
  };

  debugLog(`checkout PUT#2 components: ${JSON.stringify(components2)}`);
  const put2Result = await bridge.checkoutPut(purchaseIdStr, components2, proxy);
  debugLog(`checkout PUT#2 ok=${put2Result.ok}`);
  if (!put2Result.ok) {
    if (sessionService.isSessionExpiredError(put2Result)) {
      sessionService.emitSessionExpired();
    }
    const err = put2Result as { ok: false; message: string; code?: string };
    debugLog(`checkout PUT#2 failed: ${err.message}`);
    return { ok: false, message: err.message, code: err.code };
  }

  // Extract checksum from PUT#2 response — needed for the final payment step
  const put2Data = put2Result.data as Record<string, unknown>;
  const checkout2 = put2Data.checkout as Record<string, unknown> | undefined;
  const comps2 = (checkout2?.components ?? put2Data.components ?? {}) as Record<string, unknown>;
  
  // Log the confirmed carrier from PUT#2 response to verify Vinted accepted our selection
  const spdResp = comps2.shipping_pickup_details as Record<string, unknown> | undefined;
  const pdResp = spdResp?.pickup_details as Record<string, unknown> | undefined;
  const confirmedCarrier = (pdResp?.shipping_option as Record<string, unknown>)?.carrier_code;
  const confirmedRate = pdResp?.selected_rate_uuid;
  debugLog(`PUT#2 response confirmed carrier: ${confirmedCarrier} (rate_uuid=${confirmedRate})`);
  
  const checksum = (checkout2?.checksum ?? put2Data.checksum ?? checkout1?.checksum ?? putData.checksum) as string | undefined;
  debugLog(`checksum from PUT#2: ${checksum}`);

  if (!checksum) {
    return { ok: false, message: 'Checkout PUT did not return a checksum. Cannot process payment.' };
  }

  // Step 5: Execute the actual payment — POST /checkout/payment
  emitProgress('Processing payment...');
  const payResult = await bridge.checkoutPay(purchaseIdStr, checksum, proxy);
  debugLog(`checkoutPay ok=${payResult.ok}`);
  if (payResult.ok) {
    debugLog(`checkoutPay response (first 2000): ${JSON.stringify(payResult.data).slice(0, 2000)}`);
  }
  if (!payResult.ok) {
    if (sessionService.isSessionExpiredError(payResult)) {
      sessionService.emitSessionExpired();
    }
    const err = payResult as { ok: false; message: string; code?: string };
    debugLog(`checkoutPay failed: ${err.message}`);
    return { ok: false, message: err.message, code: err.code };
  }

  const finalData = payResult.data as Record<string, unknown>;
  
  // Extract redirect URL — Vinted puts it at action.parameters.url
  const action = finalData.action as Record<string, unknown> | undefined;
  const actionParams = action?.parameters as Record<string, unknown> | undefined;
  const redirectUrl = actionParams?.url ?? finalData.redirect_url ?? finalData.three_ds_url ?? finalData.url;
  
  // Check payment status — "pending" means 3DS required
  const payment = finalData.payment as Record<string, unknown> | undefined;
  const paymentStatus = payment?.status as string | undefined;
  debugLog(`payment status=${paymentStatus}, action type=${action?.type}, redirect=${redirectUrl}`);

  if (redirectUrl && typeof redirectUrl === 'string') {
    emitProgress('3DS required — opening authentication window...');
    
    // Real Chrome user agent — checkout.com rejects Electron's default UA
    const chromeUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    
    // Open 3DS in a dedicated Electron window with full browser capabilities
    // checkout.com's device-fingerprinting page needs: real UA, JS, popups, iframes,
    // and a persistent session to preserve cookies across the redirect chain
    const threeDSWin = new BrowserWindow({
      width: 500,
      height: 700,
      title: '3D Secure — Bank Authentication',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: true,
        allowRunningInsecureContent: true,
        // Persistent session — preserves cookies across the redirect chain
        // (Vinted API → checkout.com → authentication-devices.checkout.com → bank)
        partition: 'persist:threeds',
      },
    });
    
    // Set Chrome user agent before loading the page
    threeDSWin.webContents.setUserAgent(chromeUA);
    threeDSWin.loadURL(redirectUrl);
    
    // Allow popups (some banks open auth in a popup)
    threeDSWin.webContents.setWindowOpenHandler(({ url }) => {
      threeDSWin.loadURL(url);
      return { action: 'deny' };
    });
    
    // Log all navigations for debugging the redirect chain
    threeDSWin.webContents.on('did-navigate', (_event, url) => {
      debugLog(`3DS navigate: ${url}`);
      if (url.includes('vinted.co.uk') || url.includes('vinted.com/checkout') || url.includes('vinted.com/inbox')) {
        debugLog(`3DS completed — navigated back to: ${url}`);
        threeDSWin.close();
      }
    });
    threeDSWin.webContents.on('did-navigate-in-page', (_event, url) => {
      debugLog(`3DS in-page navigate: ${url}`);
    });
    
    const win = BrowserWindow.getAllWindows().find(w => w !== threeDSWin && !w.isDestroyed());
    if (win) {
      win.webContents.send('checkout:3ds-required', { redirectUrl, purchaseId: purchaseIdStr });
    }
    return {
      ok: true,
      purchaseId: purchaseIdStr,
      redirectUrl,
      message: 'Approve in the 3DS authentication window. Purchase will complete when done.',
    };
  }

  if (paymentStatus === 'pending') {
    return {
      ok: true,
      purchaseId: purchaseIdStr,
      message: 'Payment is pending — check your banking app for 3DS approval.',
    };
  }

  const db = getDb();
  if (db) {
    db.prepare(
      'INSERT INTO purchases (item_id, order_id, amount, status, sniper_id, created_at) VALUES (?, ?, ?, ?, ?, unixepoch())'
    ).run(item.id, orderId, item.price, 'completed', sniperId ?? null);
  }

  return {
    ok: true,
    purchaseId: purchaseIdStr,
    message: 'Purchase completed.',
  };
}
