"""
Google Cloud Vision API integration for OCR text extraction.

Extracts text from listing photos — serial numbers, care labels,
brand stamps, and other text indicators that support authentication.
"""

from __future__ import annotations

from typing import Optional

import httpx


CLOUD_VISION_API = "https://vision.googleapis.com/v1/images:annotate"
TIMEOUT = 30.0


async def extract_text_from_images(
    photo_urls: list[str],
    api_key: str,
    max_images: int = 10,
) -> list[dict]:
    """Extract text and labels from listing photos via Cloud Vision API.

    Cost: ~$1.50 per 1,000 images = ~£0.001 per photo.

    Args:
        photo_urls: URLs to listing photos.
        api_key: Google Cloud Vision API key (can use Gemini API key).
        max_images: Maximum number of images to process.

    Returns:
        List of dicts: [
            {
                "image_index": 0,
                "text": "CHANEL MADE IN FRANCE S/N 12345678",
                "labels": ["leather", "handbag", "luxury"],
                "has_serial": True,
            }
        ]
    """
    results: list[dict] = []

    # Process images in batch (Cloud Vision supports batch annotation)
    urls_to_process = photo_urls[:max_images]

    # Build batch request
    requests_payload = []
    for url in urls_to_process:
        requests_payload.append({
            "image": {"source": {"imageUri": url}},
            "features": [
                {"type": "TEXT_DETECTION", "maxResults": 10},
                {"type": "LABEL_DETECTION", "maxResults": 5},
            ],
        })

    payload = {"requests": requests_payload}

    headers = {"Content-Type": "application/json"}
    api_url = f"{CLOUD_VISION_API}?key={api_key}"

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(api_url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        # Cloud Vision failure is non-fatal — return empty results
        print(f"[Cloud Vision] OCR extraction failed: {e}")
        return results

    # Parse batch response
    responses = data.get("responses", [])
    for i, response in enumerate(responses):
        text_annotations = response.get("textAnnotations", [])
        label_annotations = response.get("labelAnnotations", [])

        # Full text is in the first annotation
        full_text = text_annotations[0]["description"].strip() if text_annotations else ""

        # Extract labels
        labels = [
            label["description"].lower()
            for label in label_annotations
        ]

        # Heuristic: check if text looks like a serial number
        has_serial = _detect_serial_number(full_text)

        results.append({
            "image_index": i,
            "text": full_text,
            "labels": labels,
            "has_serial": has_serial,
        })

    return results


def _detect_serial_number(text: str) -> bool:
    """Simple heuristic to detect if extracted text contains a serial number.

    Common patterns:
    - Long alphanumeric strings (6+ chars)
    - Strings with mixed letters and numbers
    - Text following keywords like 'S/N', 'Serial', 'No.', 'Ref'
    """
    import re

    if not text:
        return False

    text_upper = text.upper()

    # Check for serial number keywords
    serial_keywords = ["SERIAL", "S/N", "REF.", "NO.", "MADE IN"]
    if any(kw in text_upper for kw in serial_keywords):
        return True

    # Check for alphanumeric sequences of 6+ characters (likely serial numbers)
    alphanumeric_pattern = re.compile(r'[A-Z0-9]{6,}')
    matches = alphanumeric_pattern.findall(text_upper)
    if matches:
        # Filter out common non-serial strings
        non_serial = {"CHANEL", "GUCCI", "LOUIS", "VUITTON", "HERMES", "PRADA"}
        return any(m not in non_serial for m in matches)

    return False


def format_ocr_for_prompt(ocr_results: list[dict]) -> str:
    """Format OCR results into a text block for inclusion in the auth analysis prompt.

    Args:
        ocr_results: Output from extract_text_from_images().

    Returns:
        Formatted string for the vision model's prompt.
    """
    if not ocr_results:
        return ""

    lines = ["--- OCR TEXT EXTRACTED FROM LISTING PHOTOS ---"]

    for result in ocr_results:
        if result.get("text"):
            lines.append(
                f"Photo {result['image_index'] + 1}: \"{result['text']}\""
            )
            if result.get("has_serial"):
                lines.append("  ⚠️ Possible serial number detected")

    if len(lines) == 1:
        return ""  # No text found in any photo

    lines.append("--- END OCR DATA ---")
    return "\n".join(lines)
