"""
Stealth Image Mutation — Pillow-based binary mutation for relist fingerprint evasion.

Applies sub-perceptual changes to avoid Vinted's duplicate image detection:
  1. Alternating rotation (±0.5–1.0°) based on relist_count to prevent drift.
  2. Random pixel jitter on 5 pixels (±3 RGB per channel).
"""

import io
import random

from PIL import Image


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

    # 1. Alternating rotation: ±0.5–1.0 degrees
    #    Even relist_count → clockwise (negative angle in Pillow)
    #    Odd relist_count  → counter-clockwise (positive angle)
    angle = random.uniform(0.5, 1.0)
    if relist_count % 2 == 0:
        angle = -angle  # clockwise

    # Use nearest-neighbor fill from edge pixels to avoid black borders
    img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=None)

    # 2. Pixel jitter: randomly alter RGB values of 5 pixels by ±3
    pixels = img.load()
    w, h = img.size
    for _ in range(5):
        x = random.randint(0, w - 1)
        y = random.randint(0, h - 1)
        r, g, b = pixels[x, y]
        pixels[x, y] = (
            max(0, min(255, r + random.randint(-3, 3))),
            max(0, min(255, g + random.randint(-3, 3))),
            max(0, min(255, b + random.randint(-3, 3))),
        )

    # Encode as JPEG
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def jitter_text(text: str, relist_count: int) -> str:
    """
    Append or remove a trailing space based on relist_count.
    Alternates each relist to produce a different text fingerprint.
    """
    stripped = text.rstrip()
    if relist_count % 2 == 0:
        return stripped + " "
    return stripped
