# Vinted API Reference (Consumer Web)

**Status:** 🚧 To be filled during Phase 0 discovery  
**Last Updated:** —  
**Source:** Reverse-engineered from vinted.co.uk (Chrome DevTools)

---

## How to Fill This Document

1. Open **[https://www.vinted.co.uk](https://www.vinted.co.uk)** in Chrome
2. Log in with your account
3. Open DevTools → **Network** tab
4. Clear the network log (🚫 icon)
5. Perform a search (e.g. "nike shoes")
6. Filter by **Fetch/XHR** to isolate API calls
7. Record the requests below

---

## 1. Search / Catalog Endpoints

### Primary Search Endpoint

| Field | Value |
|-------|-------|
| **URL** | *(e.g. `https://www.vinted.co.uk/api/v2/catalog/items`)* |
| **Method** | GET / POST |
| **Query Parameters** | *(e.g. ` catalog_ids=..., order=newest_first, page=1)* |

### Request Headers (Required)

| Header | Example | Notes |
|--------|---------|-------|
| `Cookie` | — | Required for auth — see Cookies section |
| `User-Agent` | — | |
| `X-Requested-With` | — | If present |
| `X-Csrf-Token` | — | If present |
| *Others* | — | List any X-* or custom headers |

### Pagination Format

- Page parameter: `page=1`, `page=2`, etc.?
- Per-page count: `per_page=???`
- Sort order param: `order=newest_first`?

### Response Structure (Sample)

```json
// Paste a truncated/sanitised response sample here
{
  "items": [...],
  "pagination": {...}
}
```

---

## 2. Cookies (Auth Required)

| Cookie Name | Purpose | Required for Search? |
|-------------|---------|----------------------|
| *To be filled* | | |
| | | |

### How to Extract

1. DevTools → Application → Cookies → `https://www.vinted.co.uk`
2. Or: Right-click a request → Copy → Copy as cURL → extract Cookie header

---

## 3. Additional Endpoints Discovered

| Endpoint | Method | Purpose |
|----------|--------|---------|
| | | |
| | | |

---

## 4. WebSocket / Pusher (Optional)

- [ ] Checked for WebSocket connections
- [ ] Checked for "pusher" in Network tab

**Findings:** *(none / describe)*

---

## 5. Anti-Bot / Cloudflare

- Response headers that indicate bot challenge: —
- Any `cf-*` or `__cf_bm` cookies: —
- Rate limit observed: —
