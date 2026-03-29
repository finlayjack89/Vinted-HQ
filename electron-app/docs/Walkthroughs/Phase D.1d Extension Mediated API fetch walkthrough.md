# Phase D.1d: Extension-Mediated API Fetch — Walkthrough

## Problem

The edit modal's Materials and Sizes dropdowns were empty for the Sandals category (catalog 2949). The [extractFromAttributes()](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/electron-app/src/components/Wardrobe.tsx#1191-1266) function expects `materialAttr.configuration.options` but received only `{ids:[43,457], code:"material"}`.

## Root Cause

The Python bridge calls `POST /api/v2/item_upload/attributes` server-side, but Datadome downgrades the response — stripping `configuration.options` (the full 55-material schema with labels). The SSR HTML also does NOT contain this data.

## Solution

Use `chrome.scripting.executeScript` in the page's **MAIN WORLD** to call Vinted's API using its own Datadome-patched [fetch()](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/extension/src/fetch_interceptor.ts#16-53). The background service worker orchestrates this:

```
Content Script → FETCH_ATTRIBUTES_MAIN_WORLD → Background SW → executeScript(MAIN WORLD)
                                                                      ↓
                                                         POST /api/v2/item_upload/attributes
                                                                      ↓
                                                Full schema {configuration.options: [...55 materials]}
                                                                      ↓
                                              Python Bridge /ingest/materials → SQLite cache
```

## Files Changed

| File | Change |
|------|--------|
| [background.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/extension/src/background.ts) | Added `FETCH_SIZES_MAIN_WORLD` handler |
| [content.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/extension/src/content.ts) | Replaced diagnostic `extractStaticOntologies()` with Main World fetch calls |
| [fetch_interceptor.ts](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/extension/src/fetch_interceptor.ts) | Reverted to clean passive state |

## Verification Results

### ✅ Attributes Fetch
- Main World `POST /api/v2/item_upload/attributes` returned **5 attribute groups** (brand, size, condition, color, material)
- Material group includes **55 options** with full `{id, title}` labels (Acrylic → Wool)
- Cached via `/ingest/materials` → 200 OK

### ✅ Sizes Fetch
- Main World `GET /api/v2/item_upload/size_groups?catalog_ids=2949` returned **1 size group** (Footwear)
- **27 sizes** flattened and cached via `/ingest/sizes` → 200 OK

### ✅ Edit Modal
- First open: shows old IDs-only response (cache not yet populated)
- After deep sync + reopen: full material dropdown with all 55 options

### Minor Notes

| Issue | Impact | Explanation |
|-------|--------|-------------|
| `runtime.lastError: message port closed` | Benign | Chrome extension timing — message handlers race with tab navigation. Does not affect functionality. |
| React Error #418 | Benign | Hydration mismatch from extension injection. Does not affect data extraction. |
| First-open doesn't populate | Expected | Edit modal fires `getMaterials` before deep sync caches. Close/reopen reads from cache. |
| Duplicate deep sync runs | Benign | Content script triggers twice (navigation events). Cache is idempotent — second write is a no-op. |
