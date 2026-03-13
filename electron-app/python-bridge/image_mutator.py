"""
Stealth Image Mutation — Pillow-based binary mutation for relist fingerprint evasion.

Three mutation strategies:
  mutate_image()           — Legacy random mutation (used by /upload endpoint).
  mutate_image_for_relist() — Deterministic generation-based mutation with dHash
                              verification loop.  Uses seeded RNG so the same
                              generation always produces the same perturbation
                              direction, while each new generation produces a
                              distinct fingerprint.
  apply_fallback_mutation() — Subtle non-linear mutations applied when the standard
                              clockface crop fails to alter the dHash enough.

Generation-based mutations (Phase 2):
  1. Strip all EXIF / ICC metadata.
  2. Alternating micro-brightness (even gen) or micro-contrast (odd gen) shift.
  3. Clockface geometric crop: generation mod 12 selects one of 12 asymmetric
     crop positions (1-3% edge removal), shifting spatial geometry.
  4. Pixel-level jitter on 80 random pixels (±3 RGB per channel).

Phase 4 — dHash Verification Loop:
  After the Phase 2 mutations, compute dHash of original and mutated images.
  If Hamming distance < 5 (too close to Vinted's duplicate threshold), apply
  subtle fallback mutations and re-check.  Loop up to 3 times.

Phase 6 — Fallback Mutations (subtle / imperceptible):
  Attempt 1: Micro hue rotation (2-5°) via channel mixing
  Attempt 2: Very light Gaussian noise (sigma=3, barely visible)
  Attempt 3: Gentle asymmetric crop (2-3% from one edge)
"""

import io
import random

import numpy as np
from PIL import Image, ImageEnhance

try:
    import imagehash
except ImportError:
    imagehash = None  # type: ignore[assignment]

try:
    import piexif
except ImportError:
    piexif = None  # type: ignore[assignment]

# Minimum dimension (px) after crop — prevents Vinted upload rejection on small images.
MIN_CROP_DIM = 400

# Minimum Hamming distance to pass Vinted's duplicate detection.
# dHash produces 64-bit hashes; Vinted's match threshold is approximately 5 bits.
# We target 5 to avoid unnecessary fallback escalation — the Phase 2 mutations
# already change the binary fingerprint significantly even at low dHash distances.
MIN_DHASH_DISTANCE = 5


# ─── Legacy Random Mutation (existing behaviour, used by /upload) ────────────


def mutate_image(image_bytes: bytes, relist_count: int) -> bytes:
    """
    Mutate an image to produce a unique binary fingerprint.

    Args:
        image_bytes: Raw JPEG/PNG/WebP bytes of the original image.
        relist_count: Current relist count for this item (controls rotation direction).

    Returns:
        Mutated JPEG bytes (quality=95).
    """
    img = Image.open(io.BytesIO(image_bytes))

    # Convert to RGB if necessary (handles RGBA, palette, etc.)
    if img.mode != "RGB":
        img = img.convert("RGB")

    # 1. Strip all metadata (EXIF, ICC profile, JFIF comments)
    img.info.clear()

    # 2. Alternating rotation: +-0.3-0.6 degrees (imperceptible)
    angle = random.uniform(0.3, 0.6)
    if relist_count % 2 == 0:
        angle = -angle  # clockwise

    img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=None)

    # 3. Random 1-2% edge crop
    w, h = img.size
    crop_pct = random.uniform(0.01, 0.02)
    left = int(w * crop_pct)
    top = int(h * crop_pct)
    right = w - int(w * crop_pct)
    bottom = h - int(h * crop_pct)
    if (right - left) >= MIN_CROP_DIM and (bottom - top) >= MIN_CROP_DIM:
        img = img.crop((left, top, right, bottom))

    # 4. Slight brightness & contrast shift (+-1%)
    img = ImageEnhance.Brightness(img).enhance(random.uniform(0.99, 1.01))
    img = ImageEnhance.Contrast(img).enhance(random.uniform(0.99, 1.01))

    # 5. Pixel jitter: randomly alter RGB values of 80 pixels by +-3
    pixels = img.load()
    w, h = img.size
    for _ in range(80):
        x = random.randint(0, w - 1)
        y = random.randint(0, h - 1)
        r, g, b = pixels[x, y]
        pixels[x, y] = (
            max(0, min(255, r + random.randint(-3, 3))),
            max(0, min(255, g + random.randint(-3, 3))),
            max(0, min(255, b + random.randint(-3, 3))),
        )

    # Encode as JPEG (no EXIF written)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


# ─── Deterministic Generation-Based Mutation (relist pipeline) ───────────────


# 12 clockface crop positions.  Each is (left%, top%, right%, bottom%)
# representing the fraction to remove from each edge.  Asymmetric removal
# shifts the spatial geometry differently for each position.
_CLOCKFACE_CROPS = [
    (0.01, 0.00, 0.00, 0.02),  # 12 o'clock — trim top-left, bottom-right
    (0.02, 0.01, 0.00, 0.00),  # 1 o'clock
    (0.03, 0.01, 0.00, 0.01),  # 2 o'clock
    (0.00, 0.02, 0.01, 0.00),  # 3 o'clock
    (0.00, 0.03, 0.01, 0.01),  # 4 o'clock
    (0.01, 0.00, 0.02, 0.01),  # 5 o'clock
    (0.00, 0.01, 0.02, 0.00),  # 6 o'clock
    (0.01, 0.01, 0.01, 0.02),  # 7 o'clock
    (0.02, 0.00, 0.01, 0.01),  # 8 o'clock
    (0.00, 0.01, 0.01, 0.03),  # 9 o'clock
    (0.01, 0.02, 0.00, 0.01),  # 10 o'clock
    (0.00, 0.00, 0.03, 0.02),  # 11 o'clock
]


# ─── Phase 6 Fallback Mutations (subtle / imperceptible) ─────────────────────


def apply_fallback_mutation(img: Image.Image, attempt: int, generation: int = 0) -> Image.Image:
    """
    Apply subtle, imperceptible mutations when standard clockface crop fails
    to alter the dHash enough.  Each attempt level is applied INDEPENDENTLY
    (not cumulatively) to avoid stacking visible distortions.

    All transforms are designed to shift the dHash perceptual hash while
    remaining invisible to the human eye.

    Args:
        img: PIL Image (RGB) that has already been through Phase 2 mutation.
        attempt: 1-based attempt number (1, 2, or 3).
        generation: Relist generation for seeding noise RNG.

    Returns:
        Further-mutated PIL Image.
    """
    w, h = img.size
    rng = random.Random(generation * 100 + attempt)

    if attempt == 1:
        # Micro hue rotation (2-5°): shift colour channels by tiny amounts.
        # This changes the gradient directions that dHash measures but is
        # imperceptible to the human eye (similar to white balance drift).
        angle_deg = rng.uniform(2.0, 5.0)
        angle_rad = angle_deg * 3.14159 / 180.0
        cos_a = np.cos(angle_rad)
        sin_a = np.sin(angle_rad)
        # Apply rotation in RGB color space (simplified hue shift)
        arr = np.array(img, dtype=np.float32)
        r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
        new_r = np.clip(r * cos_a - g * sin_a * 0.3, 0, 255)
        new_g = np.clip(g * cos_a + r * sin_a * 0.3, 0, 255)
        arr[:, :, 0] = new_r
        arr[:, :, 1] = new_g
        img = Image.fromarray(arr.astype(np.uint8), mode="RGB")

    elif attempt == 2:
        # Very light Gaussian noise (sigma=3): barely visible, shifts
        # fine-grained gradients enough to alter the dHash thumbnail.
        arr = np.array(img, dtype=np.int16)
        noise = np.random.default_rng(seed=generation * 1000 + attempt).normal(0, 3, arr.shape).astype(np.int16)
        arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
        img = Image.fromarray(arr, mode="RGB")

    elif attempt == 3:
        # Gentle asymmetric crop: 2-3% off one edge only.
        # Shifts content within the dHash grid without visibly changing the image.
        edge = rng.choice(["top", "bottom", "left", "right"])
        pct = rng.uniform(0.02, 0.03)
        if edge == "top":
            crop_px = int(h * pct)
            if (h - crop_px) >= MIN_CROP_DIM:
                img = img.crop((0, crop_px, w, h))
        elif edge == "bottom":
            crop_px = int(h * pct)
            if (h - crop_px) >= MIN_CROP_DIM:
                img = img.crop((0, 0, w, h - crop_px))
        elif edge == "left":
            crop_px = int(w * pct)
            if (w - crop_px) >= MIN_CROP_DIM:
                img = img.crop((crop_px, 0, w, h))
        else:  # right
            crop_px = int(w * pct)
            if (w - crop_px) >= MIN_CROP_DIM:
                img = img.crop((0, 0, w - crop_px, h))

    return img


# ─── dHash Helpers ───────────────────────────────────────────────────────────


def _compute_dhash(img: Image.Image) -> "imagehash.ImageHash | None":
    """Compute dHash of an image.  Returns None if imagehash is not installed."""
    if imagehash is None:
        return None
    return imagehash.dhash(img)


def _hamming_distance(h1, h2) -> int:
    """Compute Hamming distance between two ImageHash objects."""
    if h1 is None or h2 is None:
        return 999  # If imagehash unavailable, skip verification (always pass)
    return h1 - h2  # imagehash overloads __sub__ to return Hamming distance


# ─── EXIF Injection ──────────────────────────────────────────────────────────


def _inject_exif_software_tag(jpeg_bytes: bytes, generation: int) -> bytes:
    """Inject a Kiro-{generation} Software tag into the EXIF IFD."""
    if piexif is None:
        return jpeg_bytes  # graceful degrade if piexif not installed
    try:
        # Build a minimal EXIF dict with just the Software tag
        exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "Interop": {}}
        try:
            loaded = piexif.load(jpeg_bytes)
            if isinstance(loaded, dict):
                exif_dict = loaded
        except Exception:
            pass
        if "0th" not in exif_dict or not isinstance(exif_dict["0th"], dict):
            exif_dict["0th"] = {}
        exif_dict["0th"][piexif.ImageIFD.Software] = f"Kiro-{generation}".encode("utf-8")
        exif_bytes = piexif.dump(exif_dict)
        # Re-open and save with the new EXIF via Pillow (piexif.insert is unreliable with bytes)
        img = Image.open(io.BytesIO(jpeg_bytes))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=95, optimize=True, exif=exif_bytes)
        return buf.getvalue()
    except Exception:
        # If EXIF manipulation fails, return the original bytes rather than crash.
        return jpeg_bytes


# ─── Main Relist Mutator (Phase 2 + Phase 4 dHash loop + Phase 6 fallbacks) ─


def mutate_image_for_relist(image_bytes: bytes, generation: int) -> bytes:
    """
    Apply deterministic, generation-based mutations to bypass perceptual hashing.
    Includes a closed-loop dHash verification step: if the Hamming distance between
    original and mutated is < MIN_DHASH_DISTANCE, subtle fallback mutations are
    applied until the distance is safe (up to 3 attempts).

    All mutations are designed to be IMPERCEPTIBLE to the human eye while
    producing a distinct binary and perceptual fingerprint.

    Args:
        image_bytes: Raw JPEG/PNG/WebP bytes of the original image.
        generation: Relist generation counter (0, 1, 2, …). Controls the seed
                    for all random operations so the same generation always
                    produces the same mutation direction.

    Returns:
        Mutated JPEG bytes (quality=95, optimize=True) with Kiro-{gen} EXIF tag.
    """
    # Seed RNG for deterministic output per generation
    rng = random.Random(generation)

    original_img = Image.open(io.BytesIO(image_bytes))

    # Convert to RGB
    if original_img.mode != "RGB":
        original_img = original_img.convert("RGB")

    # Compute dHash of original before any mutations
    original_dhash = _compute_dhash(original_img)

    # Work on a copy so we can re-apply fallbacks without re-reading bytes
    img = original_img.copy()

    # 1. Strip all EXIF / ICC metadata
    img.info.clear()

    # 2. Alternating brightness (even) / contrast (odd) micro-shift (±1%)
    if generation % 2 == 0:
        factor = rng.uniform(0.99, 1.01)
        img = ImageEnhance.Brightness(img).enhance(factor)
    else:
        factor = rng.uniform(0.99, 1.01)
        img = ImageEnhance.Contrast(img).enhance(factor)

    # 3. Clockface geometric crop — generation mod 12 selects position
    w, h = img.size
    crop_idx = generation % len(_CLOCKFACE_CROPS)
    lp, tp, rp, bp = _CLOCKFACE_CROPS[crop_idx]
    left = int(w * lp)
    top = int(h * tp)
    right = w - int(w * rp)
    bottom = h - int(h * bp)
    if (right - left) >= MIN_CROP_DIM and (bottom - top) >= MIN_CROP_DIM:
        img = img.crop((left, top, right, bottom))

    # 4. Pixel-level jitter: 80 random pixels, ±3 per channel
    pixels = img.load()
    w, h = img.size
    for _ in range(80):
        x = rng.randint(0, w - 1)
        y = rng.randint(0, h - 1)
        r, g, b = pixels[x, y]
        pixels[x, y] = (
            max(0, min(255, r + rng.randint(-3, 3))),
            max(0, min(255, g + rng.randint(-3, 3))),
            max(0, min(255, b + rng.randint(-3, 3))),
        )

    # ── Phase 4: dHash Verification Loop ──
    # Check if the mutation is sufficient to evade Vinted's duplicate detection.
    # If distance < MIN_DHASH_DISTANCE, apply Phase 6 fallback mutations.
    for attempt in range(1, 4):  # Up to 3 fallback attempts
        mutated_dhash = _compute_dhash(img)
        distance = _hamming_distance(original_dhash, mutated_dhash)

        if distance >= MIN_DHASH_DISTANCE:
            break  # Safe — mutation is sufficient

        # Not enough divergence; apply subtle fallback
        img = apply_fallback_mutation(img, attempt, generation=generation)

    # 5. Export as JPEG (quality=95, optimize=True)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95, optimize=True)
    jpeg_bytes = buf.getvalue()

    # 6. Inject Kiro-{generation} EXIF Software tag
    jpeg_bytes = _inject_exif_software_tag(jpeg_bytes, generation)

    return jpeg_bytes


# ─── Text Jitter Helpers ─────────────────────────────────────────────────────


# Unicode whitespace variants that survive basic ASCII strip() normalisation.
# Cycled by relist_count to produce a different text fingerprint each time.
_TEXT_JITTER_VARIANTS = [
    "\u2009",   # thin space
    "\u200A",   # hair space
    "\u200B",   # zero-width space
    "\u2009\u200B",  # thin + zero-width
    "\u200A\u200B",  # hair + zero-width
]


def jitter_text(text: str, relist_count: int) -> str:
    """
    Append a visually-invisible Unicode whitespace variant to the text.
    Cycles through variants based on relist_count so each relist produces
    a distinct string that survives basic ASCII strip() normalisation.
    """
    stripped = text.rstrip()
    suffix = _TEXT_JITTER_VARIANTS[relist_count % len(_TEXT_JITTER_VARIANTS)]
    return stripped + suffix


def jitter_text_zwsp(text: str, generation: int) -> str:
    """
    Append 1-4 zero-width spaces to text based on generation.
    This is the V2 jitter used by the relist orchestrator.
    """
    rng = random.Random(generation + 0xCAFE)  # offset seed to differ from image RNG
    count = rng.randint(1, 4)
    return text.rstrip() + ("\u200B" * count)

