# Vinted Checkout Flow (API Sequence)

**Status:** 🚧 To be filled during Phase 0 discovery  
**Last Updated:** —  
**Source:** Manual purchase + Chrome DevTools Network tab

---

## How to Fill This Document

1. Log into Vinted UK in Chrome
2. Open DevTools → Network tab, filter **Fetch/XHR**
3. Clear the log
4. Perform a **full purchase** (add to cart → checkout → pay)
5. Record each API call in order
6. If 3DS triggers, note the redirect flow

---

## Step-by-Step API Sequence

### Step 1: Add to Cart

| Field | Value |
|-------|-------|
| **Endpoint** | |
| **Method** | |
| **Request payload** | *(item_id, quantity, etc.)* |
| **Response** | *(cart_id? session?)* |

---

### Step 2: Initiate Checkout / Get Checkout Session

| Field | Value |
|-------|-------|
| **Endpoint** | |
| **Method** | |
| **Request payload** | |
| **Response** | *(checkout_id, available couriers?)* |

---

### Step 3: Select Courier

| Field | Value |
|-------|-------|
| **Endpoint** | |
| **Method** | |
| **Request payload** | *(courier_id: Yodel, DPD, etc.)* |
| **Response** | *(delivery options?)* |

---

### Step 4: Select Delivery Point (Drop-off) or Home Address

| Field | Value |
|-------|-------|
| **Endpoint** | |
| **Method** | |
| **Request payload** | *(coordinates? address_id?)* |
| **Response** | *(delivery point list?)* |

---

### Step 5: Add Item Verification (£10) — if applicable

| Field | Value |
|-------|-------|
| **Endpoint** | |
| **Method** | |
| **Request payload** | |
| **Response** | |

---

### Step 6: Payment / Submit Order

| Field | Value |
|-------|-------|
| **Endpoint** | |
| **Method** | |
| **Request payload** | *(card_token? payment_method_id?)* |
| **Response** | *(order_id? 3DS redirect URL?)* |

---

### Step 7: 3D Secure (if triggered)

| Field | Value |
|-------|-------|
| **Flow** | *(Redirect to bank? Popup?)* |
| **Callback** | *(How does success/failure return to Vinted?)* |
| **Polling** | *(Any poll endpoint for completion?)* |

---

## Diagram (Optional)

```
[Add to Cart] → [Checkout Session] → [Courier] → [Delivery Point] → [Payment] → [3DS?] → [Order Confirmed]
```

---

## Notes

- Any session tokens that must persist across steps: —
- Sticky proxy recommended: Yes / No
- Observed timeout for checkout session: —
