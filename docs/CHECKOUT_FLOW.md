# Vinted Checkout Flow (API Sequence)

**Status:** ✅ Filled from network-capture.har  
**Last Updated:** 12 Feb 2026  
**Source:** Manual purchase + Chrome DevTools Network tab + HAR export

---

## Overview

```
[Item Page] → [Checkout Build] → [Checkout PUT (multi-step)] → [3DS?] → [Order Confirmed]
```

**Key IDs:**
- `order_id` — from item/transaction (e.g. 18034809253)
- `purchase_id` — from checkout build response (e.g. Bckw5BEqW_DRb2xGn8_PP)
- `shipping_order_id` — for nearby pickup points (e.g. 21006853309)

---

## Step 1: Add to Cart / Initiate Checkout

Vinted does not use a traditional "add to cart" — clicking "Buy" triggers checkout build directly.

| Field | Value |
|-------|-------|
| **Endpoint** | `POST /api/v2/purchases/checkout/build` |
| **Method** | POST |
| **Request payload** | `{"purchase_items":[{"id":18034809253,"type":"transaction"}]}` |
| **Response** | Returns `purchase_id`, checkout session, available couriers, etc. |

**Notes:** `id` = order_id from the item page. `type` = "transaction" for single-item purchase.

---

## Step 2: Checkout Session (PUT)

All checkout steps use the same PUT endpoint with different `components` in the body.

| Field | Value |
|-------|-------|
| **Endpoint** | `PUT /api/v2/purchases/{purchase_id}/checkout` |
| **Method** | PUT |
| **Request payload** | `{"components":{...}}` — see steps 3–6 |

---

## Step 3: Item Verification (£10) — Optional

| Field | Value |
|-------|-------|
| **Component** | `additional_service` |
| **Payload** | `{"is_selected":true,"type":"item_verification"}` to enable |
| **Payload** | `{"is_selected":false,"type":"item_verification"}` to disable |

---

## Step 4: Delivery Type (Home vs Drop-off)

| Field | Value |
|-------|-------|
| **Component** | `shipping_pickup_options` |
| **Home delivery** | `{"pickup_type":1}` |
| **Drop-off** | `{"pickup_type":2}` |

---

## Step 5: Delivery Point (Drop-off) or Address

### If drop-off: fetch nearby pickup points

| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/shipping_orders/{shipping_order_id}/nearby_pickup_points` |
| **Query params** | `country_code=GB`, `latitude=51.53`, `longitude=-0.11` |
| **Response** | List of pickup points with `rate_uuid`, `point_code`, `point_uuid` |

### Then submit selection

| Field | Value |
|-------|-------|
| **Component** | `shipping_pickup_details` |
| **Payload** | `{"rate_uuid":"...","point_code":"3861500","point_uuid":"..."}` |

**Haversine:** Sort pickup points by distance, pick closest.

---

## Step 6: Payment / Submit Order

| Field | Value |
|-------|-------|
| **Component** | `payment_method` |
| **Payload** | `{"card_id":"292447044","pay_in_method_id":"1"}` |

**Notes:** `card_id` = saved card token. `pay_in_method_id` = payment method (1 = card).

---

## Step 7: 3D Secure (if triggered)

| Field | Value |
|-------|-------|
| **Flow** | Redirect to bank or in-page challenge |
| **Callback** | Bank redirects back to Vinted on success/failure |
| **Polling** | To be validated during testing |

**Optimistic:** Assume purchase stays active while user approves in banking app.

---

## Full PUT Component Shape

```json
{
  "components": {
    "item_presentation_escrow_v2": {},
    "additional_service": {"is_selected": true, "type": "item_verification"},
    "payment_method": {"card_id": "292447044", "pay_in_method_id": "1"},
    "shipping_address": {},
    "shipping_pickup_options": {"pickup_type": 2},
    "shipping_pickup_details": {"rate_uuid": "...", "point_code": "...", "point_uuid": "..."}
  }
}
```

---

## Notes

- **Sticky proxy:** Use same proxy for entire checkout sequence.
- **Session:** Cookie + x-csrf-token must persist across all steps.
- **Order of PUTs:** Multiple PUTs observed (verification toggle, pickup type, payment, pickup details). Order may matter — replicate browser sequence.
- **Timeout:** To be validated during testing.
