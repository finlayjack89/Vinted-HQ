# Vinted UK Sniper — Implementation Plan

**Document Version:** 1.0  
**Last Updated:** 12 Feb 2025  
**Status:** Phase 1 Complete — Ready for Phase 2

---

## 1. Requirements Summary (Locked)

| Requirement | Decision |
|-------------|----------|
| **API Source** | Reverse-engineer consumer web endpoints (same as vinted.co.uk) |
| **Item Verification** | Settings toggle: auto-include £10 verification on expensive items; Yodel/DPD prioritised for auth-capable delivery |
| **3DS** | Optimistic: keep purchase active; fix timeouts if discovered during testing |
| **Feed Depth** | MVP: first 2–3 pages of "newest" per URL |
| **Simulation Mode** | Autobuy only; logs "would have bought" without spending |
| **Session Auth** | DevTools MCP for full cookie string; fallback: single paste box |
| **Polling** | User-configurable interval (e.g. 1s, 5s) in settings |

---

## 2. Phased Implementation Overview

```
Phase 0: Discovery & Setup     ──► Phase 1: Foundation
Phase 1: Foundation            ──► Phase 2: Scraping Bridge
Phase 2: Scraping Bridge       ──► Phase 3: Core Feed
Phase 3: Core Feed            ──► Phase 4: Checkout & One-Click Buy
Phase 4: Checkout              ──► Phase 5: Autobuy (Sniper)
Phase 5: Autobuy              ──► Phase 6: Polish & Safety
```

---

## 3. Phase 0: Discovery & Setup

**Goal:** Establish the technical and API baseline before writing app code.

**Duration:** 2–5 days (dependent on exploratory work)

### 3.1 Tasks

| # | Task | Owner | Depends On | Notes |
|---|------|-------|------------|-------|
| 0.1 | **Reverse-engineer Vinted search API** | — | — | Use Chrome DevTools → Network tab. Record authenticated requests to `/api/v2/catalog/items` (or equivalent). Document: endpoint URLs, query params, headers (User-Agent, cookies, X-* headers), pagination format. |
| 0.2 | **Document checkout flow** | — | — | Perform a full purchase manually. Record: add-to-cart, select courier, select delivery point, payment, 3DS redirect. Map each step to API calls. |
| 0.3 | **Identify cookie names** | — | 0.1 | List all cookies sent to Vinted domain. Note which are required for auth vs analytics. |
| 0.4 | **Check for WebSocket/Pusher** | — | — | In Network tab, filter by WS or search "pusher". If real-time exists, document event names and payload. Don't block on this. |
| 0.5 | **Scaffold project** | — | — | `npm create electron-app@latest` (Electron Forge + Vite + React + TypeScript). Add SQLite (better-sqlite3 or sql.js). Create `docs/` folder. |
| 0.6 | **Create Python bridge scaffold** | — | 0.5 | Minimal FastAPI/Flask server; single health endpoint. Electron spawns it, calls it. Add curl_cffi to requirements.txt. |

### 3.2 Deliverables

- `docs/VINTED_API_REFERENCE.md` — Endpoints, headers, params
- `docs/CHECKOUT_FLOW.md` — Step-by-step checkout sequence
- Working Electron app shell + Python server that responds to health check

### 3.3 Risks

- **Cloudflare/Bot detection** — curl_cffi may not be enough; may need Playwright/Puppeteer fallback for critical paths.
- **API changes** — Vinted may update endpoints; document version headers if present.

---

## 4. Phase 1: Foundation

**Goal:** Core app structure, data layer, settings, auth storage.

**Duration:** 3–5 days

### 4.1 Tasks

| # | Task | Owner | Depends On | Notes |
|---|------|-------|------------|-------|
| 1.1 | **Design SQLite schema** | — | 0.5 | Tables: `settings`, `search_urls`, `snipers`, `logs`, `purchases`. Include migrations strategy. |
| 1.2 | **Implement settings CRUD** | — | 1.1 | Polling interval, default courier, home vs drop-off, lat/long, verification toggle, verification threshold (£). |
| 1.3 | **Implement secure storage** | — | 0.5 | Use Electron `safeStorage` (OS Keychain) for cookie string. Wrapper module: `encrypt(token)`, `decrypt()`. |
| 1.4 | **Session management UI** | — | 1.3 | Settings page: "Connect Vinted" — paste cookie string into textarea. Parse and store via secure storage. DevTools MCP integration: if available, auto-populate; else manual. |
| 1.5 | **Session expiry detection** | — | 1.4, 4.x | On first API call post-auth: if 401/403, mark session expired, show banner, prompt re-auth. |
| 1.6 | **Proxy configuration** | — | 1.2 | Settings: proxy list (URL format). Support rotation: one proxy per active search. Optional: sticky session ID for checkout. |
| 1.7 | **Logging infrastructure** | — | 1.1 | Structured logs to SQLite `logs` table. Levels: DEBUG, INFO, WARN, ERROR. Include: timestamp, event, payload (JSON), request_id. |

### 4.2 Deliverables

- Working settings page with all config options
- Secure cookie storage + session UI
- SQLite schema + logging

### 4.3 Dependencies

- Phase 0 complete
- API reference for testing auth

---

## 5. Phase 2: Python Scraping Bridge

**Goal:** Stealth HTTP client that bypasses bot detection, used by Electron.

**Duration:** 4–7 days

### 5.1 Tasks

| # | Task | Owner | Depends On | Notes |
|---|------|-------|------------|-------|
| 2.1 | **Implement curl_cffi client** | — | 0.6 | Use `curl_cffi.requests.Session` with impersonate="chrome" (or "chrome110"). Verify JA3/JA4 fingerprint. |
| 2.2 | **Proxy support** | — | 2.1, 1.6 | Pass proxy URL per request. Support http/socks5. Test with residential proxy. |
| 2.3 | **HTTP API for Electron** | — | 2.1 | Endpoints: `GET /search?url=...&proxy=...`, `POST /checkout/step1`, etc. Electron sends cookie string in header; Python passes it. |
| 2.4 | **Rate limiting & jitter** | — | 2.3 | Per-request delay: base interval + random jitter (0–1s). Configurable from Electron. |
| 2.5 | **Error handling** | — | 2.3 | Return structured errors: `{ ok: false, code: "CF_CHALLENGE", message: "..." }`. Surface to Electron for retry/fallback. |
| 2.6 | **Integration tests** | — | 2.3 | Hit real Vinted search (with test cookie). Confirm 200 and valid JSON. |

### 5.2 Deliverables

- Python server with `/search`, `/checkout/*` endpoints
- curl_cffi + proxy working against Vinted
- Electron can call Python and receive parsed results

### 5.3 Risks

- **Cloudflare upgrade** — If v8 changes, impersonation may need updating.
- **Proxy costs** — Heavy polling can burn budget; user controls interval.

---

## 6. Phase 3: Core Feed (Multi-Query Aggregation)

**Goal:** Aggregate listings from multiple URLs, deduplicate, display in UI.

**Duration:** 4–6 days

### 6.1 Tasks

| # | Task | Owner | Depends On | Notes |
|---|------|-------|------------|-------|
| 3.1 | **Search URL management** | — | 1.1, 1.2 | CRUD for search URLs. Toggle: active (in feed) vs inactive. Inactive = no requests. |
| 3.2 | **Polling loop** | — | 2.3, 1.2 | For each active URL: call Python `/search` at user interval + jitter. One proxy per URL. |
| 3.3 | **Fetch 2–3 pages per URL** | — | 3.2 | Per URL, request page 1, 2, 3 of "newest". Merge into single list per URL. |
| 3.4 | **Deduplication** | — | 3.3 | Key by item ID. If item appears in multiple URLs, show once. Tag with which URLs matched. |
| 3.5 | **Feed UI** | — | 3.4 | List/grid of items. Show: image, title, price, condition, seller. Click to expand. |
| 3.6 | **Real-time updates** | — | 3.5 | As new items arrive, prepend to feed. Optional: toast for "X new items". |
| 3.7 | **WebSocket exploration (optional)** | — | 0.4 | If Pusher/WS found, integrate for real-time; else rely on polling. Non-blocking. |

### 6.2 Deliverables

- Consolidated feed from 5–20 URLs
- Deduplication working
- Responsive feed UI

### 6.3 Dependencies

- Phase 2 complete
- Vinted search API documented

---

## 7. Phase 4: Checkout & One-Click Buy

**Goal:** Manual one-click purchase from feed item; full checkout automation.

**Duration:** 5–8 days

### 7.1 Tasks

| # | Task | Owner | Depends On | Notes |
|---|------|-------|------------|-------|
| 4.1 | **Add to cart API** | — | 0.2 | Implement add-to-cart via Python bridge. |
| 4.2 | **Courier selection** | — | 0.2, 1.2 | Map user preference (Yodel > DPD > cheapest) to API. If Yodel/DPD unavailable, use cheapest. |
| 4.3 | **Delivery point selection** | — | 0.2, 1.2 | Haversine: given lat/long, fetch drop-off points, sort by distance, pick closest. If home delivery, skip. |
| 4.4 | **Item verification logic** | — | 1.2 | If user enabled "auto-include verification on expensive items" and item price >= threshold, add £10 verification. |
| 4.5 | **Payment API** | — | 0.2 | Use saved card token. Trigger payment. |
| 4.6 | **3DS handling** | — | 4.5 | If 3DS required: return redirect URL to Electron. Open in hidden BrowserWindow or system browser. Poll for completion. Notify user: "Approve in your banking app. Purchase will complete when done." |
| 4.7 | **One-Click Buy button** | — | 4.1–4.6 | On feed item: "Buy Now" button. Runs full sequence. Progress indicator. Success/error toast. |
| 4.8 | **Sticky proxy for checkout** | — | 2.2 | Use same proxy for entire checkout sequence to avoid IP rotation mid-flow. |

### 7.2 Deliverables

- One-click buy from feed
- Courier + delivery point auto-selection
- 3DS flow (optimistic) with user notification

### 7.3 Risks

- **3DS timeout** — If Vinted closes session quickly, may need re-initiate flow. Document and handle.
- **Verification API** — Confirm how £10 verification is added server-side.

---

## 8. Phase 5: Autobuy (The Sniper)

**Goal:** Background task that auto-purchases items matching sniper rules.

**Duration:** 4–6 days

### 8.1 Tasks

| # | Task | Owner | Depends On | Notes |
|---|------|-------|------------|-------|
| 5.1 | **Sniper CRUD** | — | 1.1 | Table: name, filters (price_max, keywords, condition), budget_limit, enabled. |
| 5.2 | **Sniper matching engine** | — | 5.1 | For each new item in feed: against each enabled sniper, check price, keywords, condition. If match, candidate for purchase. |
| 5.3 | **Budget tracking** | — | 5.1 | Per sniper: track spent. If spent >= limit, disable purchases for that sniper. |
| 5.4 | **Autobuy trigger** | — | 5.2, 4.7 | On match: if Autobuy enabled, 3s countdown. Show cancel button. If not cancelled, run checkout. If Simulation Mode: log "would have bought" only. |
| 5.5 | **Verification popup** | — | 4.4 | If item can't use Yodel/DPD verification and user wanted auth: popup "Purchase without verification?" or "Cancel". Block until user responds. |
| 5.6 | **Simulation Mode** | — | 5.4 | Global toggle. When on: no checkout, only log. |
| 5.7 | **Autobuy disabled by default** | — | 5.4 | Session start: Autobuy off. User must explicitly enable. |

### 8.2 Deliverables

- Sniper creation UI
- Match → countdown → purchase flow
- Simulation mode
- Budget limits per sniper

### 8.3 Dependencies

- Phase 4 complete
- Feed emitting new items

---

## 9. Phase 6: Polish & Safety

**Goal:** Robustness, UX improvements, edge cases.

**Duration:** 2–4 days

### 9.1 Tasks

| # | Task | Owner | Depends On | Notes |
|---|------|-------|------------|-------|
| 6.1 | **Session expiry UX** | — | 1.5 | Banner + modal: "Session expired. Re-authenticate." Trigger MCP or show paste box. |
| 6.2 | **Error recovery** | — | 2.5 | Retry logic for transient failures. Exponential backoff for rate limits. |
| 6.3 | **Log viewer** | — | 1.7 | UI to browse logs. Filter by level, event, time. Export. |
| 6.4 | **Purchase history** | — | 4.7 | Log successful purchases. Show in dedicated view. |
| 6.5 | **Testing with real account** | — | All | Full E2E: authenticate, add URL, run sniper in simulation, then one real buy. Document any issues. |

### 9.2 Deliverables

- Production-ready error handling
- Log viewer
- Purchase history
- Tested against live Vinted

---

## 10. MVP vs Post-MVP

### MVP (Phases 0–6)

- Multi-query feed with deduplication
- User-configurable polling
- One-click buy
- Autobuy with filters, budget, 3s countdown, simulation
- Courier + delivery point logic
- Verification toggle
- Secure auth storage
- Python bridge with curl_cffi
- Proxy support

### Post-MVP

- WebSocket/Pusher if available
- 3DS timeout handling improvements
- Advanced filters (brand, size, etc.)
- Sniper presets/templates
- Analytics dashboard

---

## 11. File Structure (Proposed)

```
vinted-hq/
├── docs/
│   ├── IMPLEMENTATION_PLAN.md    (this file)
│   ├── VINTED_API_REFERENCE.md   (Phase 0)
│   └── CHECKOUT_FLOW.md          (Phase 0)
├── src/
│   ├── main/                     (Electron main process)
│   ├── renderer/                 (React UI)
│   ├── preload/
│   └── shared/                   (types, constants)
├── python-bridge/
│   ├── server.py
│   ├── requirements.txt
│   └── vinted_client.py
├── package.json
└── .env.example
```

---

## 12. Next Action

**Start Phase 0, Task 0.1:** Open vinted.co.uk in Chrome, log in, perform a search, and document the Network requests in `docs/VINTED_API_REFERENCE.md`.
