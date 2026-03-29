# Seller HQ — Agent Context & Project Knowledge

> **Purpose**: This document ensures continuity between AI agent sessions. It captures architecture, conventions, development history, and hard-won knowledge from 17+ prior conversations. Read this first before making any changes.

## Workspace Migration Notice

This project was **renamed and relocated** on 2026-03-26:
- **Old name**: Vinted-HQ
- **New name**: Seller-HQ
- **Old path**: `/Users/finlaysalisbury/Desktop/Software Development/Antigravity/Vinted-HQ/`
- **New path**: `/Users/finlaysalisbury/Documents/Seller HQ/Seller-HQ/`
- **Old GitHub repo**: Vinted-HQ → **renamed to** Seller-HQ

All source code references (`VINTED_HQ_*` constants, log prefixes, `package.json`, `manifest.json`, etc.) were systematically renamed to `SELLER_HQ_*` / "Seller HQ". Documentation file links were updated. The only untouched file is `electron-app/docs/Performance Diagnostics/Trace-20260315T234956.json` (historical Chrome DevTools trace snapshot — frozen diagnostic, not functional code).

---

## 1. What This App Does

**Seller HQ** is a desktop application for power-selling on Vinted (UK). It combines:
- **Real-time feed monitoring** — polls Vinted search URLs for new listings
- **Auto-buy (Sniper)** — configurable rules that auto-purchase matching items with a countdown timer + simulation mode
- **Wardrobe management** — full inventory view with Deep Sync (scrapes item edit pages for complete data)
- **Automated relisting** — deletes + recreates listings with mutated photos to evade duplicate detection
- **Purchase & Sales tracking** — dashboards for completed transactions
- **Auto-messaging (CRM)** — automated post-purchase seller messages with configurable delay
- **Session harvesting** — Chrome extension passively captures Vinted auth cookies

---

## 2. Architecture Overview

```
┌──────────────────────────────────────┐
│         Chrome Extension             │
│  (content.ts, background.ts,         │
│   fetch_interceptor.ts)              │
│  - Session harvesting (cookies/CSRF) │
│  - Deep Sync (edit page scraping)    │
│  - Datadome bypass via Main World    │
│  - Assisted Edit (form puppeteering) │
└──────────┬───────────────────────────┘
           │ HTTP POST to localhost:37421
           ▼
┌──────────────────────────────────────┐
│       Python Bridge (FastAPI)        │
│  server.py + vinted_client.py        │
│  - Vinted API calls via curl_cffi    │
│  - Image mutation (relist pipeline)  │
│  - Proxy rotation                    │
│  - Datadome evasion fingerprinting   │
└──────────┬───────────────────────────┘
           │ IPC (Electron contextBridge)
           ▼
┌──────────────────────────────────────┐
│       Electron App (React + TS)      │
│  - SQLite database (better-sqlite3)  │
│  - Main process: ipc.ts, bridge.ts,  │
│    inventoryService.ts, etc.         │
│  - Renderer: App.tsx + 12 components │
│  - Liquid Glass UI (CSS frosted)     │
└──────────────────────────────────────┘
```

### Communication Protocol
- **Extension ↔ Python Bridge**: HTTP via `localhost:37421`. The extension's `background.ts` proxies all requests (content scripts can't make cross-origin requests due to CORS).
- **Extension ↔ Electron**: Indirect — the extension POSTs data to the Python bridge, which the Electron app reads from SQLite.
- **Electron Main ↔ Renderer**: IPC via `contextBridge` (`preload.ts` exposes `window.vinted.*` API).
- **Extension internal messaging**: `window.postMessage` for Main World ↔ Isolated World communication. Constants prefixed `SELLER_HQ_*` (e.g. `SELLER_HQ_ATTRIBUTES_CAPTURED`, `SELLER_HQ_CSRF_SCRAPED`).

---

## 3. Key Files & Their Roles

### Electron Main Process (`electron-app/src/main/`)
| File | Role |
|------|------|
| `ipc.ts` | All IPC handlers — the central routing layer between renderer and backend |
| `bridge.ts` | HTTP client to Python bridge (`localhost:37421`) |
| `inventoryService.ts` | **Largest file (113KB)** — wardrobe sync orchestration, Deep Sync, relist queue, status tracking |
| `inventoryDb.ts` | SQLite CRUD for `inventory_master`, `inventory_photos`, `vinted_ontology` |
| `db.ts` | Schema migrations, table creation |
| `checkoutService.ts` | Purchase flow: cart → checkout → 3DS authentication → confirmation |
| `sessionService.ts` | Cookie management, extension session polling, fast-poll mode |
| `feedService.ts` | Search URL polling, deduplication |
| `sniperService.ts` | Sniper rule matching + auto-buy trigger |
| `proxyService.ts` | Dual proxy pools (ISP for scraping, residential for checkout), sticky sessions |
| `crmService.ts` | Post-purchase automated messaging with randomized delays |
| `authCapture.ts` | Login window cookie interception |
| `ontologyService.ts` | Category/brand/material/size schema caching |
| `liveSnapshot.ts` | In-memory item state for fast-path sync skipping |

### Renderer Components (`electron-app/src/components/`)
| Component | Purpose |
|-----------|---------|
| `Wardrobe.tsx` | **Largest component (133KB)** — inventory grid, edit modal with 14+ field types, category drill-down, brand search, material/size/colour pickers |
| `Settings.tsx` | Session management, proxy config, search URLs, snipers, courier settings |
| `Feed.tsx` | Virtualized feed grid (`react-window`), polling status indicators |
| `PurchasesSuite.tsx` | Purchase history with detail modals |
| `SalesSuite.tsx` | Sales history dashboard |
| `AutoMessage.tsx` | CRM message template editor with listing selection |
| `Sniper.tsx` | Sniper tab showing auto-buy hits and simulation results |
| `ProxyStatus.tsx` | Proxy health monitoring |

### Chrome Extension (`extension/src/`)
| File | Role |
|------|------|
| `background.ts` | Service worker — proxies fetch requests, session harvesting via cookies API, network header sniffing (CSRF, anon-id), Main World script injection |
| `content.ts` | Runs on `vinted.co.uk` — two modes: (1) wardrobe page → inject Next.js state extractor, (2) edit page → Deep Sync or Assisted Edit |
| `fetch_interceptor.ts` | **Main World, `document_start`** — wraps `window.fetch` before Datadome loads to intercept attribute/size API responses passively |

### Python Bridge (`electron-app/python-bridge/`)
| File | Role |
|------|------|
| `server.py` (79KB) | FastAPI server — all Vinted API proxying, session management, ontology caching, relist orchestration |
| `vinted_client.py` (94KB) | Low-level Vinted API client using `curl_cffi` with browser fingerprint impersonation |
| `image_mutator.py` | Photo mutation for relisting — clockface crops, gamma/hue shifts, EXIF injection, dHash verification loop |

---

## 4. Critical Knowledge & Gotchas

### Datadome WAF Bypass
- **Vinted uses Datadome** for bot protection. Direct API calls from Python or the extension's Isolated World get blocked or return empty data.
- **Solution**: The `fetch_interceptor.ts` runs in Vinted's **Main World** at `document_start`, wrapping `window.fetch` *before* Datadome's agent loads. This lets us eavesdrop on Vinted's own React-initiated API calls.
- **For active fetching** (when Vinted doesn't naturally call an endpoint): `background.ts` uses `chrome.scripting.executeScript` with `world: 'MAIN'` to call fetch using the page's own Datadome-patched version.
- **Full post-mortem**: `electron-app/docs/Post-Mortems/Post_Mortem_Edit_Modal_Datadome_Bypass.md`

### Relist Pipeline
- **Sequence**: Download CDN photos → mutate (clockface crop, gamma, EXIF) → upload mutated photos one-by-one with 1.5-3.5s jitter → delete original listing → wait 8-15s → create new listing with ZWSP text jitter
- **Datadome circuit breaker**: If any upload returns `DATADOME_CHALLENGE` or `FORBIDDEN`, the entire relist aborts *before* deletion
- **dHash verification**: Each mutated photo is checked against the original to ensure visual similarity while being technically different
- **Queue system**: SQLite-persisted queue with pause/resume, configurable delays (30-90s default), recovery on app restart

### Session Management
- The extension's `background.ts` harvests Vinted cookies every 5 minutes (via Chrome alarms API), on tab activation, and on page navigation
- CSRF tokens are sniffed from network headers AND scraped from DOM
- The "1-Click Sync" feature opens Vinted in Chrome (if not already open), waits up to 50s for the extension to harvest and POST the session

### 3DS Authentication
- Checkout uses `BrowserWindow` with a custom session that preserves cookies through redirect chains
- The 3DS authentication page (`checkout.com/device-information`) requires correct `User-Agent` and cookie forwarding
- Handled in `checkoutService.ts` with `will-redirect` listeners

### Deep Sync
- Triggered by opening an item's edit URL with `?hq_sync=true`
- The content script parses Next.js flight chunks in `<script>` tags for `itemEditModel` data
- Falls back to DOM scraping for title/description when RSC references (`$L5`) are present
- Also fetches attribute schemas (materials, sizes) via Main World injection and caches them in SQLite ontology tables

### Proxy Architecture
- **Dual pools**: ISP proxies for high-speed scraping, residential proxies for checkout (sticky sessions)
- **Browser ops**: Can route Electron browser actions (edit save, relist) through dedicated ISP proxies
- **Transport modes**: `PROXY` (default) or `DIRECT` (tethered mobile — uses Chrome 110 Android fingerprint)

---

## 5. UI Design System

- **Theme**: Elevated neutral / liquid glass aesthetic (Revolut-inspired)
- **Base**: `#FAF9F6` background, `#111111` text, Indigo-600 (`#6366F1`) primary
- **Font**: Inter (loaded via CDN link in `index.html`)
- **Glass panels**: `rgba(255,255,255,0.7)` with `1px solid rgba(255,255,255,0.85)` border
- **Theme file**: `electron-app/src/theme.ts` — all design tokens exported as objects
- **CSS**: `electron-app/src/index.css` — minimal base reset + scrollbar + animations
- **Sidebar**: Fixed 220px sidebar with tab navigation, gradient underlay
- **Design docs**: `electron-app/docs/Design/Output/Agent Design Plans/SPEC.md` and `PLAN.md`

---

## 6. Development History (17 Conversations, Chronological)

### Phase A-C: Core Platform (early sessions, not in summary)
- Feed polling, wardrobe sync, basic UI, SQLite schema, session management

### Phase D: Edit Modal & Ontology System
1. **Phase D.1 — Dropdown Puppeteering**: Content script simulates React pointer events to select condition/size/package size on Vinted's edit page
2. **Phase D.1d — Datadome Bypass**: Discovered Datadome blocks direct API calls. Built passive fetch interceptor in Main World. Full post-mortem documented.
3. **Phase D.1d — Futureproofing**: Added `FETCH_SIZES_MAIN_WORLD` for active fetching when passive interception captures nothing (e.g. Sandals category). Added 404 handling for sizeless categories.

### Phase E: Offline & Inventory
4. **Phase E.3 — Offline Sync Audit**: Verified `COALESCE`-based merge is safe (shallow syncs never overwrite deep sync data). Confirmed offline-first boot.
5. **Item Status Tracking**: Added `last_seen_at` timestamp, sweep-based removal detection, 6-state status system (`live`/`sold`/`removed`/`draft`/`hidden`/`local_only`)

### Phase F: Relist Pipeline
6. **Relist Pipeline**: Full CDN→mutate→upload→delete→create pipeline with Datadome circuit breaker
7. **Relist Image Editing Fix**: Fixed over-aggressive photo mutations. Added dHash verification loop, cumulative fallback tiers, generation-seeded deterministic mutations.
8. **Relist Queue Enhancement**: SQLite persistence, pause/resume, configurable delays, recovery dialog on restart, bulk selection from Live tab

### Phase G: UI Redesign
9. **Redesign V1**: Liquid glass theme, motion system (Framer Motion), SVG displacement filter, mouse-tracking specular highlights, scroll degradation hook
10. **Redesign V2**: Feed virtualization (`react-window`), DOM texture via canvas, sidebar/modal glass tracking, keyframe cleanup
11. **WebGL Integration Plan**: Attempted Three.js-based glass rendering (planned but not fully shipped due to ANGLE compatibility issues)
12. **Liquid Glass Architecture Post-Mortem**: Documented SVG filter pipeline performance characteristics

### Phase H: Commerce & Messaging
13. **Sales Suite**: Sold items dashboard with card-based UI
14. **Purchase/Sale Modal Redesign**: Larger thumbnail, restructured layout, evenly-spaced action buttons
15. **Checkout UI Refinement**: Klarna logo sizing, Apple Pay → "Check Out Now" button text
16. **3DS Authentication Fix**: Resolved `device-information` page rendering issues in Electron's BrowserWindow
17. **Auto-Message (CRM)**: Post-purchase seller messaging with configurable delay, template system with dynamic placeholders

### Phase I: Sniper & Feed
18. **Sniper Tab**: Auto-buy display + simulation mode with "would have bought" logging
19. **Feed Polling Optimization**: Sorting by `created_at_ts` (live upload time) instead of `fetched_at` (poll time)
20. **Polling Search UI**: Item card dimension/spacing adjustments

### Phase J: Maintenance
21. **SQLite Upsert Fix**: Resolved `TypeError` for non-bindable types
22. **Sync Failure Audit**: Diagnosed frequent session refresh timeouts
23. **Force Relist**: Skip-delete retry for moderation-locked items
24. **Git sync + push**
25. **Seller HQ Rebrand** (this session): Renamed all references across 10 source files and 16+ markdown docs

---

## 7. Known Issues & Pre-existing Lint Errors

- **`ipc.ts:262`** — `FeedItem` type mismatch: missing `currency`, `photo_url`, `url`, `fetched_at` properties. Pre-existing, not introduced by any recent changes.
- **`Wardrobe.tsx`** — Multiple pre-existing TypeScript errors (type assertions, missing properties). This is the largest and most complex component.
- **WebGL glass rendering** — Planned but not fully shipped. CSS-only glass (SVG filter + `backdrop-filter`) is the current implementation.

---

## 8. Existing Documentation Index

All docs live in `electron-app/docs/`:

### Walkthroughs
- `Walkthroughs/Phase D.1 walkthrough.md` — Dropdown puppeteering
- `Walkthroughs/Phase D.1d Extension Mediated API fetch walkthrough.md` — Main World fetching
- `Walkthroughs/Phase D.1d futureproofing update walkthrough.md` — Sizes + 404 hardening
- `Walkthroughs/Phase E.3 Offline Sync walkthrough.md` — Offline-first audit
- `Walkthroughs/Item Status walkthrough.md` — Status tracking system
- `Walkthroughs/Relist pipeline walkthrough.md` — Full relist flow
- `Walkthroughs/Relist image editing walkthrough.md` — Photo mutation pipeline
- `Walkthroughs/Edit Modal System Rundown walkthrough.md` — All 14 edit modal fields
- `Walkthroughs/Sales Suite walkthrough.md` — Sales dashboard
- `Walkthroughs/Redesign walkthrough.md` — Liquid glass UI V1
- `Walkthroughs/Redesign V2 walkthrough.md` — Virtualization + glass V2
- `Walkthroughs/WebGL Integration Plan walkthrough.md` — Three.js attempt
- `Walkthroughs/WebGL V2 implementation_plan.md` — DOM texture approach

### Post-Mortems
- `Post-Mortems/Post_Mortem_Edit_Modal_Datadome_Bypass.md` — **Critical read** for understanding the eavesdrop architecture
- `Post-Mortems/Extension_Mediated_Fetch_Postmortem.md` — Active Main World fetching
- `Post-Mortems/Post_Mortem_Liquid_Glass_Architecture.md` — SVG filter performance

### Design
- `Design/Output/Agent Design Plans/SPEC.md` — Design system specification
- `Design/Output/Agent Design Plans/PLAN.md` — Implementation plan for the redesign
- `Design/Input/Static Design/Research:Theory/Strategic UI_UX Architecture Redesign.md` — UX research

---

## 9. Build & Run

### Electron App
```bash
cd electron-app
npm install
npm run dev          # Development (Vite + Electron)
npm run build        # Production build
```

### Chrome Extension
```bash
cd extension
npm install
npm run build        # Outputs to extension/dist/
# Load unpacked in Chrome: chrome://extensions → Load unpacked → select dist/
```

### Python Bridge
```bash
cd electron-app/python-bridge
pip install -r requirements.txt
python server.py     # Starts FastAPI on localhost:37421
```

The Python bridge starts automatically when the Electron app launches (managed by the main process).
