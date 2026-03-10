"""
Stealth Image Mutation — Pillow-based binary mutation for relist fingerprint evasion.

Two mutation strategies:
  mutate_image()           — Legacy random mutation (used by /upload endpoint).
  mutate_image_for_relist() — Deterministic generation-based mutation for the relist
                              pipeline.  Uses seeded RNG so the same generation always
                              produces the same perturbation direction, while each new
                              generation produces a distinct fingerprint.

Generation-based mutations:
  1. Strip all EXIF / ICC metadata.
  2. Alternating micro-brightness (even gen) or micro-contrast (odd gen) shift.
  3. Clockface geometric crop: generation mod 12 selects one of 12 asymmetric
     crop positions (1-3% edge removal), shifting spatial geometry.
  4. Pixel-level jitter on 80 random pixels (±3 RGB per channel).
  5. Inject Kiro-{generation} tag into EXIF Software IFD via piexif.
  6. Export JPEG at quality=95, optimize=True.
"""

import io
import random

from PIL import Image, ImageEnhance

try:
    import piexif
except ImportError:
    piexif = None  # type: ignore[assignment]

# Minimum dimension (px) after crop — prevents Vinted upload rejection on small images.
MIN_CROP_DIM = 400


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

    # 2. Alternating rotation: +-0.5-1.0 degrees
    angle = random.uniform(0.5, 1.0)
    if relist_count % 2 == 0:
        angle = -angle  # clockwise

    img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=None)

    # 3. Random 1-3% edge crop
    w, h = img.size
    crop_pct = random.uniform(0.01, 0.03)
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


def mutate_image_for_relist(image_bytes: bytes, generation: int) -> bytes:
    """
    Apply deterministic, generation-based mutations to bypass perceptual hashing.

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

    img = Image.open(io.BytesIO(image_bytes))

    # Convert to RGB
    if img.mode != "RGB":
        img = img.convert("RGB")

    # 1. Strip all EXIF / ICC metadata
    img.info.clear()

    # 2. Alternating brightness (even) / contrast (odd) micro-shift (±1-2%)
    if generation % 2 == 0:
        factor = rng.uniform(0.98, 1.02)
        img = ImageEnhance.Brightness(img).enhance(factor)
    else:
        factor = rng.uniform(0.98, 1.02)
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
