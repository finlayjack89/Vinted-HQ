# Relist Pipeline Hardening — Walkthrough

## Changes Made

### `requirements.txt`
Added `imagehash>=4.3.0` and `numpy>=1.24.0` for dHash verification loop.

### [image_mutator.py](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/electron-app/python-bridge/image_mutator.py)

**Phase 6 — `apply_fallback_mutation(img, attempt, generation)`**
Cumulative, generation-seeded escalating mutations:
| Attempt | Strategy | Effect |
|---------|----------|--------|
| 1 | 2-4° rotation | Shifts the 9×8 gradient grid dHash operates on |
| 2 | + Gaussian noise (σ=25) | Scrambles fine gradients in the thumbnail |
| 3 | + 15%/10% asymmetric crop | Shifts content within the dHash grid |

**Phase 4 — dHash Verification Loop**
After Phase 2 clockface mutation, `mutate_image_for_relist()` now:
1. Computes `imagehash.dhash()` of original and mutated images
2. Checks Hamming distance ≥ 12 (internal threshold, accounting for ~2-bit JPEG drift)
3. If insufficient, applies fallback tiers 1→2→3 cumulatively
4. Only then exports JPEG + injects EXIF `Kiro-{gen}` tag

### [vinted_client.py](file:///Users/finlaysalisbury/Desktop/Software%20Development/Antigravity/Seller-HQ/electron-app/python-bridge/vinted_client.py)

**Datadome Circuit Breaker** in `orchestrate_relist()`:
- **Upload-time interception**: If any `upload_photo()` raises `DATADOME_CHALLENGE` or `FORBIDDEN`, the entire relist aborts *before* DELETE
- **Pre-delete health probe**: `_verify_session_health()` calls `GET /api/v2/users/current` and checks for 403 or HTML challenge signatures (`datadome`, `captcha-delivery.com`, `just a moment`, `<!doctype`)
- **Result**: Item is never deleted if the session is blocked — prevents permanent item loss

## Test Results

```
── Determinism ──
  ✓ Deterministic: same generation → identical bytes
  ✓ Different generations → different bytes

── dHash Verification ──
    gen=0: dHash distance = 16 ✓
    gen=1: dHash distance = 23 ✓
    gen=2: dHash distance = 19 ✓
    gen=3: dHash distance = 13 ✓
    gen=4: dHash distance = 16 ✓
  ✓ dHash distance >= 10 for generations 0-4
    solid image: dHash distance = 15
  ✓ Solid image mutation completes without crash

── Fallback Mutations ──
    attempt 1 (rotation): dimensions preserved at (800, 600)
    attempt 2 (rotation + noise): mean pixel diff = 22.57
    attempt 3 (rotation + noise + crop): (800, 600) → (720, 510)
  ✓ All 3 fallback tiers work correctly

── EXIF / Quality ──
  ✓ EXIF Software tag: 'Kiro-7'
  ✓ Valid JPEG output: 776×594
  ✓ jitter_text_zwsp works correctly

✅ All hardened mutator tests passed.
```
