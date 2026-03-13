# Relist Pipeline — Walkthrough

## Changes Made

### Database Layer
- **[db.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/main/db.ts)** — Added `inventory_photos` table with `internal_photo_id`, `item_id`, `vinted_photo_id`, `generation`, `original_url`
- **[inventoryDb.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/main/inventoryDb.ts)** — Added `upsertInventoryPhoto()` and `getInventoryPhotos()` CRUD helpers

### Python Bridge
- **[image_mutator.py](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/python-bridge/image_mutator.py)** — Added `mutate_image_for_relist()` with deterministic seeded RNG, clockface crops, piexif EXIF injection (`Kiro-{gen}`), and `jitter_text_zwsp()`
- **[vinted_client.py](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/python-bridge/vinted_client.py)** — Added `orchestrate_relist()` (CDN download → mutate → upload with 1.5-3.5s jitter → delete → 8-15s wait → ZWSP text jitter → create)
- **[server.py](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/python-bridge/server.py)** — Added `POST /relist-v2` route with Datadome error surfacing
- **[requirements.txt](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/python-bridge/requirements.txt)** — Added `piexif>=1.1.3`

### Electron Main
- **[bridge.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/main/bridge.ts)** — Added `relistItemV2()` calling `/relist-v2` with CDN URLs
- **[inventoryService.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Vinted-HQ/electron-app/src/main/inventoryService.ts)** — Rewired `processQueue()` relist stub → calls `bridge.relistItemV2()`, updates sync record, increments relist count, upserts photo lineage

## Test Results

All 6 image mutator tests passed:

```
Testing mutate_image_for_relist...
  ✓ Deterministic: same generation → identical bytes
  ✓ Different generations → different bytes
  ✓ Valid JPEG output: 776×594
  ✓ EXIF Software tag: 'Kiro-7'
  ✓ jitter_text_zwsp: gen0 ≠ gen1, both contain ZWSP
  ✓ Min dimension guard: 406×402 (input 410×410)

✅ All image mutator tests passed.
```

## Notes
- Full end-to-end relist requires a live Vinted session — manual testing needed at deployment time
- All lint errors shown are pre-existing (missing Pyre2 venv config, missing `@types/better-sqlite3`)
- The existing `/relist` route (V1) and `relist_item()` function remain untouched for backward compatibility
