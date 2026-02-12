/**
 * Checkout Service — full one-click buy flow.
 * Orchestrates: build → verification → delivery → pickup → payment.
 * Uses sticky proxy for entire sequence.
 */

import { BrowserWindow, shell } from 'electron';

const CHECKOUT_PROGRESS_CHANNEL = 'checkout:progress';
import * as bridge from './bridge';
import * as settings from './settings';
import { getDb } from './db';
import type { FeedItem } from './feedService';

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
function getPaymentMethod(data: unknown): { card_id: string; pay_in_method_id: string } | null {
  const d = data as Record<string, unknown>;
  const methods = d.payment_methods ?? d.pay_in_methods ?? d.purchase?.payment_methods;
  if (Array.isArray(methods) && methods.length > 0) {
    const first = methods[0] as Record<string, unknown>;
    const cardId = first.id ?? first.card_id;
    if (cardId) {
      return {
        card_id: String(cardId),
        pay_in_method_id: String(first.pay_in_method_id ?? first.id ?? '1'),
      };
    }
  }
  const purchase = d.purchase as Record<string, unknown> | undefined;
  const pm = purchase?.payment_method ?? purchase?.default_payment_method;
  if (pm && typeof pm === 'object') {
    const p = pm as Record<string, unknown>;
    const cardId = p.card_id ?? p.id;
    if (cardId) return { card_id: String(cardId), pay_in_method_id: '1' };
  }
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

export async function runCheckout(item: FeedItem, proxy?: string): Promise<CheckoutResult> {
  const orderId = item.order_id ?? item.id;
  const price = parseFloat(item.price) || 0;
  const s = settings.getAllSettings();
  const wantVerification =
    s.verificationEnabled && price >= s.verificationThresholdPounds;

  emitProgress('Initiating checkout...');

  const buildResult = await bridge.checkoutBuild(orderId, proxy);
  if (!buildResult.ok) {
    return {
      ok: false,
      message: buildResult.message,
      code: buildResult.code,
    };
  }

  const data = buildResult.data as Record<string, unknown>;
  const purchaseId = data.id ?? data.purchase_id ?? (data.purchase as Record<string, unknown>)?.id;
  if (!purchaseId) {
    return { ok: false, message: 'Checkout build did not return purchase_id' };
  }

  const purchaseIdStr = String(purchaseId);
  emitProgress('Configuring delivery...');

  const components: Record<string, unknown> = {};

  // Verification
  components.additional_service = {
    is_selected: wantVerification,
    type: 'item_verification',
  };

  // Delivery type
  components.shipping_pickup_options = {
    pickup_type: s.deliveryType === 'home' ? 1 : 2,
  };

  // Drop-off: fetch pickup points and select closest
  if (s.deliveryType === 'dropoff') {
    const shippingOrderId = getShippingOrderId(buildResult.data);
    if (shippingOrderId) {
      const pointsResult = await bridge.nearbyPickupPoints(
        shippingOrderId,
        s.latitude,
        s.longitude,
        'GB',
        proxy
      );
      if (pointsResult.ok && pointsResult.data) {
        const points = getPickupPointsSorted(pointsResult.data, s.latitude, s.longitude);
        if (points.length > 0) {
          components.shipping_pickup_details = points[0];
        }
      }
    }
  }

  const putResult = await bridge.checkoutPut(purchaseIdStr, components, proxy);
  if (!putResult.ok) {
    return { ok: false, message: putResult.message, code: putResult.code };
  }

  emitProgress('Adding payment...');

  const payment = getPaymentMethod(putResult.data ?? buildResult.data);
  if (!payment) {
    return { ok: false, message: 'No saved payment method found. Add a card on Vinted.' };
  }

  const paymentPutResult = await bridge.checkoutPut(
    purchaseIdStr,
    { components: { payment_method: payment } },
    proxy
  );
  if (!paymentPutResult.ok) {
    return { ok: false, message: paymentPutResult.message, code: paymentPutResult.code };
  }

  const finalData = paymentPutResult.data as Record<string, unknown>;
  const redirectUrl = finalData.redirect_url ?? finalData.three_ds_url ?? finalData.url;

  if (redirectUrl && typeof redirectUrl === 'string') {
    emitProgress('3DS required — open in browser');
    shell.openExternal(redirectUrl);
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('checkout:3ds-required', { redirectUrl, purchaseId: purchaseIdStr });
    }
    return {
      ok: true,
      purchaseId: purchaseIdStr,
      redirectUrl,
      message: 'Approve in your banking app. Purchase will complete when done.',
    };
  }

  const db = getDb();
  if (db) {
    db.prepare(
      'INSERT INTO purchases (item_id, order_id, amount, status, created_at) VALUES (?, ?, ?, ?, unixepoch())'
    ).run(item.id, orderId, item.price, 'completed');
  }

  return {
    ok: true,
    purchaseId: purchaseIdStr,
    message: 'Purchase completed.',
  };
}
