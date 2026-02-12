# Vinted API Reference (Consumer Web)

**Status:** ✅ Filled from network-capture.har  
**Last Updated:** 12 Feb 2026  
**Source:** Reverse-engineered from vinted.co.uk (Chrome DevTools + HAR export)

---

## 1. Search / Catalog Endpoints

### Primary Search Endpoint (User Search)

| Field | Value |
|-------|-------|
| **URL** | `https://www.vinted.co.uk/api/v2/users/{user_id}/searches/{search_id}` |
| **Method** | GET |
| **Query Parameters** | None (search_id and params are in the path/URL) |

**Catalog URL format:** `https://www.vinted.co.uk/catalog?search_text=hermes%20kelly&search_id=31195792639&order=newest_first`

The `search_id` is returned when a search is created/updated. The same endpoint returns paginated items.

### Alternative: Catalog Items (if different)

| Field | Value |
|-------|-------|
| **URL** | `https://www.vinted.co.uk/api/v2/catalog/items` |
| **Query Params** | `page=1`, `per_page=96`, `order=newest_first`, `search_text=...`, `global_search_session_id=...` |

### Update Search (PUT)

| Field | Value |
|-------|-------|
| **URL** | `https://www.vinted.co.uk/api/v2/users/{user_id}/searches/{search_id}` |
| **Method** | PUT |
| **Request body** | `{"search":{"search_text":"hermes kelly","filters":{},"subscribed":false},"keep_last_visit_time":false}` |

### Request Headers (Required)

| Header | Example | Notes |
|--------|---------|-------|
| `Cookie` | *(full cookie string)* | Required for auth |
| `x-csrf-token` | `75f6c9fa-dc8e-4e52-a000-e09dd4084b3e` | Required |
| `x-anon-id` | `1a037f89-b2a1-44fc-9370-c12426a16f84` | Anonymous ID |
| `User-Agent` | Chrome 144 | Browser fingerprint |
| `Accept` | `application/json, text/plain, */*,image/webp` | |
| `Referer` | `https://www.vinted.co.uk/catalog?search_text=...` | Same-origin |

### Pagination

- Search results: Fetched via GET `/searches/{search_id}`. Pagination params to be confirmed (page, per_page).
- For MVP: first 2–3 pages of "newest" per URL.

---

## 2. Cookies (Auth Required)

| Cookie Name | Purpose | Required for Search? |
|-------------|---------|----------------------|
| `_vinted_fr_session` | Session | Yes |
| `access_token_web` | JWT access token | Yes |
| `refresh_token_web` | JWT refresh token | Yes |
| `anon_id` | Anonymous ID (matches x-anon-id) | Yes |
| `v_uid` | User ID | Yes |
| `v_sid` | Session ID | Yes |
| `cf_clearance` | Cloudflare bypass | Yes (if behind CF) |
| `datadome` | Datadome bot protection | Yes |
| `__cf_bm` | Cloudflare Bot Management | Yes |

### How to Extract

1. DevTools → Application → Cookies → `https://www.vinted.co.uk`
2. Or: Right-click a request → Copy → Copy as cURL → extract Cookie header
3. Paste full cookie string into app settings

---

## 3. Checkout & Purchase Endpoints

### Initiate Checkout (Build)

| Field | Value |
|-------|-------|
| **URL** | `https://www.vinted.co.uk/api/v2/purchases/checkout/build` |
| **Method** | POST |
| **Request body** | `{"purchase_items":[{"id":18034809253,"type":"transaction"}]}` |
| **Notes** | `id` = order_id from item page, `type` = "transaction" |

### Checkout Steps (PUT)

| Field | Value |
|-------|-------|
| **URL** | `https://www.vinted.co.uk/api/v2/purchases/{purchase_id}/checkout` |
| **Method** | PUT |
| **Request body** | `{"components":{...}}` — see below |

**Component payloads (merge into single PUT):**

| Step | Component | Payload |
|------|-----------|---------|
| Item verification | `additional_service` | `{"is_selected":true,"type":"item_verification"}` or `{"is_selected":false,...}` |
| Delivery type | `shipping_pickup_options` | `{"pickup_type":1}` (home) or `{"pickup_type":2}` (drop-off) |
| Drop-off point | `shipping_pickup_details` | `{"rate_uuid":"...","point_code":"3861500","point_uuid":"..."}` |
| Payment | `payment_method` | `{"card_id":"292447044","pay_in_method_id":"1"}` |

### Nearby Pickup Points (Haversine)

| Field | Value |
|-------|-------|
| **URL** | `https://www.vinted.co.uk/api/v2/shipping_orders/{shipping_order_id}/nearby_pickup_points` |
| **Method** | GET |
| **Query params** | `country_code=GB`, `latitude=51.5315705`, `longitude=-0.1140708` |

### Offers / Buy Options

| Field | Value |
|-------|-------|
| **URL** | `https://www.vinted.co.uk/api/v2/offers/request_options` |
| **Method** | POST |
| **Request body** | `{"price":{"amount":"11000.0","currency_code":"GBP"},"seller_id":72931995}` |

### Countries Bounds

| Field | Value |
|-------|-------|
| **URL** | `https://www.vinted.co.uk/api/v2/countries/13/bounds` |
| **Method** | GET |

---

## 4. Additional Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v2/users/{user_id}/searches/sorted` | GET | User's saved/sorted searches |
| `/api/v2/search_suggestions?query=...` | GET | Autocomplete |
| `/api/v2/info_banners/catalog` | GET | Catalog banners |
| `/api/v2/conversations/stats` | GET | Inbox stats |
| `/api/v2/info_banners/item` | GET | Item page banners |

---

## 5. WebSocket / Pusher (Optional)

- [ ] Checked for WebSocket connections
- [ ] Checked for "pusher" in Network tab

**Findings:** No WebSocket/Pusher observed in HAR for catalog feed. Use polling.

---

## 6. Anti-Bot / Cloudflare

- **cf-cache-status:** DYNAMIC
- **cf-ray:** Present in responses (Cloudflare)
- **Cookies:** `cf_clearance`, `__cf_bm`, `datadome` — all required for bot bypass
- **curl_cffi:** Use `impersonate="chrome"` or `"chrome110"` for JA3/JA4 fingerprint
