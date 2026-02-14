"""
Stealth Image Mutation — Pillow-based binary mutation for relist fingerprint evasion.

Applies sub-perceptual changes to avoid Vinted's duplicate image detection:
  1. Strip all EXIF / ICC metadata.
  2. Alternating rotation (+-0.5-1.0 deg) based on relist_count to prevent drift.
  3. Random 1-3% edge crop (with 400px minimum guard) to shift spatial geometry.
  4. +-1% brightness and contrast shift to alter DCT coefficients.
  5. Random pixel jitter on 80 pixels (+-3 RGB per channel).
"""

import io
import random

from PIL import Image, ImageEnhance

# Minimum dimension (px) after crop — prevents Vinted upload rejection on small images.
MIN_CROP_DIM = 400


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
    #    Even relist_count -> clockwise (negative angle in Pillow)
    #    Odd relist_count  -> counter-clockwise (positive angle)
    angle = random.uniform(0.5, 1.0)
    if relist_count % 2 == 0:
        angle = -angle  # clockwise

    # Use nearest-neighbor fill from edge pixels to avoid black borders
    img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=None)

    # 3. Random 1-3% edge crop — shifts spatial geometry to alter pHash / CLIP vectors.
    #    Only applied if resulting dimensions stay above MIN_CROP_DIM.
    w, h = img.size
    crop_pct = random.uniform(0.01, 0.03)
    left = int(w * crop_pct)
    top = int(h * crop_pct)
    right = w - int(w * crop_pct)
    bottom = h - int(h * crop_pct)
    if (right - left) >= MIN_CROP_DIM and (bottom - top) >= MIN_CROP_DIM:
        img = img.crop((left, top, right, bottom))

    # 4. Slight brightness & contrast shift (+-1%) — imperceptible but alters DCT coeffs
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

    # Encode as JPEG (no EXIF written — Pillow omits metadata by default)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


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
