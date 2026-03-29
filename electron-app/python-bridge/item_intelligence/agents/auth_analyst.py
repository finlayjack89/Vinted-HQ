"""
Agent 4: Authenticity Analyst — Deep Vision Forensic Analysis.

Uses Gemini 3.1 Pro to evaluate listing photos against the
authenticity rubric from Agent 2.

STRICT CONSTRAINT: This agent does NOT calculate averages or
final verdicts. It evaluates each marker categorically and
outputs PASS / FAIL / UNVERIFIABLE. The Forensic Veto Engine
(veto.py) handles the verdict.
"""

from __future__ import annotations

import base64
import json
from io import BytesIO
from typing import Optional

import httpx

from ..schemas import (
    AuthenticityEvaluationOutput,
    AuthenticityMarkerEvaluation,
    AuthenticityRubric,
    MarkerResult,
    MarkerWeight,
)


GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
TIMEOUT = 60.0  # Auth analysis is the most image-heavy call


EVAL_PROMPT = """You are an expert fashion authenticator. You have been given photos 
of a {brand} {model} and a detailed authenticity rubric.

Your task: evaluate EACH marker in the rubric against the actual photos.
For each marker, determine if the item PASSES, FAILS, or is UNVERIFIABLE.

## Authenticity Rubric

{rubric_text}
{reference_section}
{ocr_section}

## Instructions

For EACH marker in the rubric, evaluate the photos and respond with this JSON:
{{
  "evaluations": [
    {{
      "marker_name": "exact name from rubric",
      "weight": "CRITICAL" or "SUPPORTING",
      "result": "PASS" or "FAIL" or "UNVERIFIABLE",
      "observation": "What you specifically see in the photos",
      "vision_confidence": 0.0 to 1.0,
      "image_index": 0-based index of most relevant photo, or null
    }}
  ],
  "general_observations": [
    "Any broader observations not tied to specific markers"
  ]
}}

RULES:
- You MUST evaluate every marker in the rubric
- Use UNVERIFIABLE when the relevant detail is not visible (blurry, wrong angle, cropped)
- vision_confidence reflects how clearly you can see the relevant detail
- Do NOT calculate any averages or overall verdicts — only evaluate individual markers
- Be precise about what you see, not what you expect to see
- If a photo shows a clear fake indicator, describe exactly what's wrong
- If REFERENCE images are provided, compare the listing photos against them for each marker
- If OCR text is provided, use it to verify serial numbers, labels, and text-based markers"""


REFERENCE_SECTION = """
## Reference Images (Confirmed Authentic)

The following images are from CONFIRMED AUTHENTIC items sourced from trusted
authentication platforms. Compare these references against the listing photos
for each relevant marker. Note any differences in:
- Stitching patterns and density
- Hardware finish, colour, and engravings
- Logo placement, font, and spacing
- Material texture and grain
- Label formatting and alignment
"{reference_sources}"""


async def run(
    photo_urls: list[str],
    rubric: AuthenticityRubric,
    api_keys: dict[str, str],
    reference_images: Optional[list[dict]] = None,
    ocr_text: Optional[str] = None,
) -> AuthenticityEvaluationOutput:
    """Run Agent 4: forensic visual analysis against auth rubric.

    Args:
        photo_urls: URLs to listing photos (all available photos).
        rubric: Authenticity rubric from Agent 2 (Perplexity research).
        api_keys: API keys dict (needs 'gemini').
        reference_images: Optional list of authenticated reference images
            (dicts with 'image_url', 'title', 'source_domain') for visual comparison.
        ocr_text: Optional formatted OCR text extracted from Cloud Vision.

    Returns:
        AuthenticityEvaluationOutput with per-marker evaluations.
    """
    gemini_key = api_keys.get("gemini")
    if not gemini_key:
        raise ValueError("Gemini API key required for Agent 4")

    if not rubric.markers:
        return AuthenticityEvaluationOutput(
            evaluations=[],
            general_observations=["No authenticity markers to evaluate"],
            photos_analyzed=0,
            model_used="none",
        )

    # Build the rubric text
    rubric_text = _format_rubric(rubric)

    # Build reference section if reference images are provided
    reference_section = ""
    if reference_images:
        sources = "\n".join(
            f"- Reference {i+1}: {ref.get('title', 'Unknown')} (from {ref.get('source_domain', 'unknown source')})"
            for i, ref in enumerate(reference_images)
        )
        reference_section = REFERENCE_SECTION.format(reference_sources=sources)

    # Build OCR section
    ocr_section = ""
    if ocr_text:
        ocr_section = f"\n{ocr_text}"

    # Build the prompt
    model_name = rubric.model or ""
    prompt = EVAL_PROMPT.format(
        brand=rubric.brand,
        model=model_name,
        rubric_text=rubric_text,
        reference_section=reference_section,
        ocr_section=ocr_section,
    )

    # Download and prepare all listing images (auth analysis needs all angles)
    image_parts = await _prepare_images(photo_urls)

    # Download and prepare reference images (labelled separately)
    ref_count = 0
    if reference_images:
        ref_urls = [ref["image_url"] for ref in reference_images if ref.get("image_url")]
        ref_parts = await _prepare_images(ref_urls)
        ref_count = len(ref_parts)
        # Append reference images after listing images
        image_parts.extend(ref_parts)

    # Call Gemini 3.1 Pro (the strongest vision model)
    response = await _call_gemini_pro(
        prompt=prompt,
        image_parts=image_parts,
        api_key=gemini_key,
    )

    # Parse the response
    result = _parse_response(response, rubric, len(photo_urls))
    result.reference_images_used = ref_count
    if ocr_text:
        result.ocr_text_extracted = [ocr_text]
    return result


def _format_rubric(rubric: AuthenticityRubric) -> str:
    """Format the rubric markers as numbered text for the prompt."""
    lines: list[str] = []
    for i, marker in enumerate(rubric.markers, 1):
        lines.append(f"\n### Marker {i}: {marker.name} [{marker.weight.value}]")
        lines.append(f"Description: {marker.description}")
        if marker.authentic_tells:
            lines.append(f"Authentic tells: {'; '.join(marker.authentic_tells)}")
        if marker.counterfeit_tells:
            lines.append(f"Counterfeit tells: {'; '.join(marker.counterfeit_tells)}")

    if rubric.general_notes:
        lines.append(f"\n### General Notes\n{rubric.general_notes}")

    return "\n".join(lines)


async def _prepare_images(photo_urls: list[str]) -> list[dict]:
    """Download all images for auth analysis (needs every angle)."""
    image_parts: list[dict] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        for url in photo_urls:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                content_type = resp.headers.get("content-type", "image/jpeg")

                image_data = resp.content
                try:
                    from PIL import Image
                    img = Image.open(BytesIO(image_data))
                    if img.width > 1024 or img.height > 1024:
                        img.thumbnail((1024, 1024), Image.LANCZOS)
                        buf = BytesIO()
                        img.save(buf, format="JPEG", quality=85)
                        image_data = buf.getvalue()
                        content_type = "image/jpeg"
                except ImportError:
                    pass

                b64 = base64.b64encode(image_data).decode("utf-8")
                image_parts.append({
                    "inline_data": {
                        "mime_type": content_type.split(";")[0],
                        "data": b64,
                    }
                })
            except Exception:
                continue

    return image_parts


async def _call_gemini_pro(
    prompt: str,
    image_parts: list[dict],
    api_key: str,
) -> str:
    """Call Gemini 3.1 Pro for deep vision analysis."""
    parts: list[dict] = []
    for img in image_parts:
        parts.append(img)
    parts.append({"text": prompt})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 4096,
            "responseMimeType": "application/json",
        },
    }

    # Use the most capable vision model
    model = "gemini-3.1-pro-preview"
    url = f"{GEMINI_API_BASE}/{model}:generateContent?key={api_key}"

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()

    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini Pro returned no candidates")

    content = candidates[0].get("content", {})
    parts = content.get("parts", [])
    if not parts:
        raise ValueError("Gemini Pro returned no content parts")

    return parts[0].get("text", "")


def _parse_response(
    response_text: str,
    rubric: AuthenticityRubric,
    photos_analyzed: int,
) -> AuthenticityEvaluationOutput:
    """Parse Gemini's JSON response into structured evaluations."""
    text = response_text.strip()

    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        json_start = text.find("{")
        json_end = text.rfind("}") + 1
        data = json.loads(text[json_start:json_end])
    except (json.JSONDecodeError, ValueError):
        # If we can't parse, return all markers as UNVERIFIABLE
        return AuthenticityEvaluationOutput(
            evaluations=[
                AuthenticityMarkerEvaluation(
                    marker_name=m.name,
                    weight=m.weight,
                    result=MarkerResult.UNVERIFIABLE,
                    observation="Vision model response could not be parsed",
                    vision_confidence=0.0,
                )
                for m in rubric.markers
            ],
            general_observations=["Vision model response parsing failed"],
            photos_analyzed=photos_analyzed,
            model_used="gemini-3.1-pro-preview",
        )

    raw_evals = data.get("evaluations", [])

    # Build fuzzy matcher: for each rubric marker, find the best-matching
    # evaluation from Gemini's response (Gemini often returns slightly
    # different marker names like "Case Back Engravings" instead of
    # "Case Back Engravings and Screws")
    rubric_markers = {m.name: m for m in rubric.markers}

    def _fuzzy_match_rubric(gemini_name: str) -> str | None:
        """Find the best rubric marker name matching Gemini's returned name."""
        gn = gemini_name.lower().strip()

        # 1. Exact match
        for rname in rubric_markers:
            if rname.lower() == gn:
                return rname

        # 2. Substring containment (either direction)
        for rname in rubric_markers:
            rn = rname.lower()
            if rn in gn or gn in rn:
                return rname

        # 3. Word overlap — score by how many words match
        gn_words = set(gn.replace("-", " ").split())
        best_match = None
        best_score = 0.0
        for rname in rubric_markers:
            rn_words = set(rname.lower().replace("-", " ").split())
            if not rn_words:
                continue
            overlap = len(gn_words & rn_words)
            score = overlap / max(len(rn_words), 1)
            if score > best_score:
                best_score = score
                best_match = rname

        # Require at least 70% word overlap
        if best_score >= 0.7 and best_match:
            return best_match

        return None

    evaluations: list[AuthenticityMarkerEvaluation] = []
    matched_rubric_names: set[str] = set()

    result_map = {
        "PASS": MarkerResult.PASS,
        "FAIL": MarkerResult.FAIL,
        "UNVERIFIABLE": MarkerResult.UNVERIFIABLE,
    }

    for ev in raw_evals:
        gemini_name = ev.get("marker_name", "Unknown")
        weight_str = ev.get("weight", "SUPPORTING").upper()
        result_str = ev.get("result", "UNVERIFIABLE").upper()

        # Try to match Gemini's marker name back to the rubric
        matched = _fuzzy_match_rubric(gemini_name)
        if matched:
            marker = rubric_markers[matched]
            matched_rubric_names.add(matched)
            evaluations.append(AuthenticityMarkerEvaluation(
                marker_name=marker.name,  # Use canonical rubric name
                weight=marker.weight,     # Use rubric weight
                result=result_map.get(result_str, MarkerResult.UNVERIFIABLE),
                observation=ev.get("observation", ""),
                vision_confidence=float(ev.get("vision_confidence", 0.5)),
                image_index=ev.get("image_index"),
            ))
        else:
            # Gemini returned a marker not in the rubric — keep it but
            # mark with the weight Gemini assigned
            weight = MarkerWeight.CRITICAL if weight_str == "CRITICAL" else MarkerWeight.SUPPORTING
            evaluations.append(AuthenticityMarkerEvaluation(
                marker_name=gemini_name,
                weight=weight,
                result=result_map.get(result_str, MarkerResult.UNVERIFIABLE),
                observation=ev.get("observation", ""),
                vision_confidence=float(ev.get("vision_confidence", 0.5)),
                image_index=ev.get("image_index"),
            ))

    # Ensure all rubric markers are covered (only truly missing ones)
    for rname, marker in rubric_markers.items():
        if rname not in matched_rubric_names:
            evaluations.append(AuthenticityMarkerEvaluation(
                marker_name=marker.name,
                weight=marker.weight,
                result=MarkerResult.UNVERIFIABLE,
                observation="Marker was not evaluated by the vision model",
                vision_confidence=0.0,
            ))

    return AuthenticityEvaluationOutput(
        evaluations=evaluations,
        general_observations=data.get("general_observations", []),
        photos_analyzed=photos_analyzed,
        model_used="gemini-3.1-pro-preview",
    )

