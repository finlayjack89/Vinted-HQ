"""
Agent 1: Item Identifier — Multimodal Vision + Text Extraction.

Uses Google Lens (via SerpAPI) for visual hints, then Gemini 3.0 Flash
for structured attribute extraction. Falls back to Gemini 3.1 Pro
if confidence is < 0.6.
"""

from __future__ import annotations

import base64
import json
from io import BytesIO
from typing import Optional

import httpx

from ..schemas import ItemIdentification


GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
TIMEOUT = 30.0


EXTRACTION_PROMPT = """You are a fashion item identification expert. Analyze the provided 
listing photos and text to extract structured attributes.

Listing title: {title}
{description_line}
{brand_hint_line}
{category_hint_line}
{condition_hint_line}
{lens_hints_line}

Analyze the images carefully and extract the following attributes.
Respond in this exact JSON format:
{{
  "brand": "Brand name (required)",
  "model": "Model name if identifiable, or null",
  "sub_model": "Sub-model/variant if identifiable, or null",
  "colorway": "Primary color(s), e.g. 'Black/Gold'",
  "size": "Size if visible/mentioned, or null",
  "material": "Primary material, e.g. 'Leather', or null",
  "condition": "Assessed condition based on photos, e.g. 'Good'",
  "category": "Category, e.g. 'Bags', 'Shoes', 'Jackets'",
  "gender": "Target gender: 'Women', 'Men', 'Unisex'",
  "retail_price_estimate_gbp": null or estimated RRP in GBP,
  "year_or_season": "Year/season if identifiable, or null",
  "confidence": 0.0 to 1.0,
  "reasoning": "Brief explanation of how you identified this item"
}}

Be precise with the brand and model. If you're unsure about a field, set it to null.
The confidence score should reflect how certain you are of the brand+model identification."""


async def run(
    photo_urls: list[str],
    listing_title: str,
    listing_description: Optional[str] = None,
    brand_hint: Optional[str] = None,
    category_hint: Optional[str] = None,
    condition_hint: Optional[str] = None,
    api_keys: dict[str, str] = {},
    model_override: Optional[str] = None,
) -> ItemIdentification:
    """Run Agent 1: identify the item from photos and listing text.

    Process:
    1. Send ALL images + text + hints to Gemini (model determined by tier)
    2. If confidence < 0.6 AND using Flash, escalate to Pro

    Args:
        photo_urls: URLs to listing photos (minimum 1). ALL photos are sent.
        listing_title: Vinted listing title.
        listing_description: Listing description text (optional).
        brand_hint: Pre-filled brand from Vinted metadata.
        category_hint: Pre-filled category.
        condition_hint: Pre-filled condition.
        api_keys: Dict containing 'gemini' key.
        model_override: Override the default model (set by tier config).

    Returns:
        ItemIdentification with extracted attributes.
    """
    gemini_key = api_keys.get("gemini")
    if not gemini_key:
        raise ValueError("Gemini API key required for Agent 1")

    # Google Lens is NOT used at Stage 1 — visual search is deferred to Stage 4
    # for reference image comparison against authenticated examples.
    lens_hints: list[str] = []

    # Build the prompt (lens_hints kept as empty list for interface compatibility)
    prompt = _build_prompt(
        listing_title, listing_description,
        brand_hint, category_hint, condition_hint, lens_hints,
    )

    # Download and prepare ALL images — no cap
    image_parts = await _prepare_images(photo_urls)

    # Call Gemini with the tier-configured model
    primary_model = model_override or "gemini-3-flash-preview"
    result = await _call_gemini(
        model=primary_model,
        prompt=prompt,
        image_parts=image_parts,
        api_key=gemini_key,
    )

    identification = _parse_response(result, lens_hints)

    # Only fallback to Pro if we're on Flash AND confidence is low
    if identification.confidence < 0.6 and "flash" in primary_model:
        try:
            result_pro = await _call_gemini(
                model="gemini-3.1-pro-preview",
                prompt=prompt,
                image_parts=image_parts,
                api_key=gemini_key,
            )
            identification = _parse_response(result_pro, lens_hints)
        except Exception:
            pass  # Keep the Flash result

    return identification


def _build_prompt(
    title: str,
    description: Optional[str],
    brand_hint: Optional[str],
    category_hint: Optional[str],
    condition_hint: Optional[str],
    lens_hints: list[str],
) -> str:
    """Build the extraction prompt with all available context."""
    desc_line = f"Description: {description}" if description else ""
    brand_line = f"Brand hint from metadata: {brand_hint}" if brand_hint else ""
    category_line = f"Category hint from metadata: {category_hint}" if category_hint else ""
    condition_line = f"Condition from listing: {condition_hint}" if condition_hint else ""
    lens_line = ""
    if lens_hints:
        lens_line = "Google Lens visual matches: " + "; ".join(lens_hints)

    return EXTRACTION_PROMPT.format(
        title=title,
        description_line=desc_line,
        brand_hint_line=brand_line,
        category_hint_line=category_line,
        condition_hint_line=condition_line,
        lens_hints_line=lens_line,
    )


async def _prepare_images(photo_urls: list[str]) -> list[dict]:
    """Download images and prepare them as base64 inline data for Gemini."""
    image_parts: list[dict] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        for url in photo_urls:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                content_type = resp.headers.get("content-type", "image/jpeg")

                # Resize if needed (token savings) — use Pillow
                image_data = resp.content
                try:
                    from PIL import Image
                    img = Image.open(BytesIO(image_data))
                    # Resize to max 1024x1024 if larger
                    if img.width > 1024 or img.height > 1024:
                        img.thumbnail((1024, 1024), Image.LANCZOS)
                        buf = BytesIO()
                        img.save(buf, format="JPEG", quality=80)
                        image_data = buf.getvalue()
                        content_type = "image/jpeg"
                except ImportError:
                    pass  # Pillow not available, use raw image

                b64 = base64.b64encode(image_data).decode("utf-8")
                image_parts.append({
                    "inline_data": {
                        "mime_type": content_type.split(";")[0],
                        "data": b64,
                    }
                })
            except Exception:
                continue  # Skip failed downloads

    return image_parts


async def _call_gemini(
    model: str,
    prompt: str,
    image_parts: list[dict],
    api_key: str,
) -> str:
    """Call the Gemini API with images + text prompt.

    Returns the raw text response.
    """
    # Build multimodal content
    parts: list[dict] = []
    for img in image_parts:
        parts.append(img)
    parts.append({"text": prompt})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        },
    }

    url = f"{GEMINI_API_BASE}/{model}:generateContent?key={api_key}"

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()

    # Extract text from response
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini returned no candidates")

    content = candidates[0].get("content", {})
    parts = content.get("parts", [])
    if not parts:
        raise ValueError("Gemini returned no content parts")

    return parts[0].get("text", "")


def _parse_response(response_text: str, lens_hints: list[str]) -> ItemIdentification:
    """Parse Gemini's JSON response into an ItemIdentification.

    Handles both clean JSON and JSON embedded in markdown code blocks.
    """
    text = response_text.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Try to extract JSON from text
        json_start = text.find("{")
        json_end = text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            data = json.loads(text[json_start:json_end])
        else:
            raise ValueError(f"Cannot parse Gemini response as JSON: {text[:200]}")

    return ItemIdentification(
        brand=data.get("brand", "Unknown"),
        model=data.get("model"),
        sub_model=data.get("sub_model"),
        colorway=data.get("colorway"),
        size=data.get("size"),
        material=data.get("material"),
        condition=data.get("condition"),
        category=data.get("category"),
        gender=data.get("gender"),
        retail_price_estimate_gbp=data.get("retail_price_estimate_gbp"),
        year_or_season=data.get("year_or_season"),
        confidence=float(data.get("confidence", 0.5)),
        reasoning=data.get("reasoning", ""),
        google_lens_hints=lens_hints,
    )
