"""
Perplexity API tool client — structured search with citation grounding.

Uses Sonar Pro or Sonar Deep Research for two distinct research tasks:
1. Authenticity markers research (what to look for to verify authenticity)
2. Market context research (general pricing intelligence)
"""

from __future__ import annotations

from typing import Optional

import httpx

from ..schemas import (
    AuthenticityMarkerDefinition,
    AuthenticityRubric,
    MarkerWeight,
)


PERPLEXITY_API_BASE = "https://api.perplexity.ai/chat/completions"
TIMEOUT = 45.0


async def search_auth_markers(
    brand: str,
    model: Optional[str],
    api_key: str,
    perplexity_model: str = "sonar-pro",
    domain_ranking: bool = True,
) -> AuthenticityRubric:
    """Search for known authenticity markers using Perplexity Sonar.

    Produces a structured rubric of CRITICAL and SUPPORTING markers
    that Agent 4 (Vision) will evaluate against actual photos.

    Args:
        brand: Brand name (e.g. "Gucci").
        model: Model name (e.g. "Marmont") — optional.
        api_key: Perplexity API key.
        perplexity_model: "sonar-pro" or "sonar-deep-research".
        domain_ranking: Whether to inject domain authority prompt.

    Returns:
        AuthenticityRubric with categorized markers and trust scores.
    """
    item_desc = brand
    if model:
        item_desc += f" {model}"

    # Build system prompt with optional domain authority ranking
    domain_prompt = ""
    if domain_ranking:
        from .domain_authority import get_domain_filter_prompt
        domain_prompt = "\n\n" + get_domain_filter_prompt()

    system_prompt = f"""You are an expert fashion authenticator. Given a brand and model, 
provide a detailed authenticity guide with specific markers to check.

Respond in this exact JSON format:
{{
  "markers": [
    {{
      "name": "marker name",
      "weight": "CRITICAL" or "SUPPORTING",
      "description": "what to look for",
      "authentic_tells": ["list of signs of authenticity"],
      "counterfeit_tells": ["list of signs of counterfeit"],
      "source_url": "URL where you found this information"
    }}
  ],
  "general_notes": "any general authentication tips"
}}

CRITICAL markers are those that definitively prove or disprove authenticity
(e.g., serial number format, specific hardware engravings, unique stitching patterns).

SUPPORTING markers are secondary indicators that strengthen or weaken the case
(e.g., dust bag quality, box details, general leather texture).

Include at least 3 CRITICAL and 3 SUPPORTING markers when possible.
Base your response only on well-documented, reliable authentication methods.
For each marker, include the source_url where you found this specific information.{domain_prompt}"""

    user_prompt = (
        f"What are the key authenticity markers for a {item_desc}? "
        f"Include both critical and supporting markers that can be verified "
        f"from photos. Focus on visual indicators."
    )

    # Use longer timeout for deep research (it performs many searches)
    timeout = 90.0 if perplexity_model == "sonar-deep-research" else TIMEOUT

    payload = {
        "model": perplexity_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "return_related_questions": False,
        "return_citations": True,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(PERPLEXITY_API_BASE, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    # Extract response content
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    citations = data.get("citations", [])

    # Parse markers from response
    markers = _parse_markers_from_response(content)

    # Score each marker's source trust from citations
    if domain_ranking:
        from .domain_authority import score_url, score_citations
        source_urls = citations if isinstance(citations, list) else []
        overall_trust = score_citations(source_urls)

        for marker in markers:
            if marker.source_url:
                marker.source_trust_score = score_url(marker.source_url)
            else:
                # Fall back to the overall citation trust score
                marker.source_trust_score = overall_trust

    # Extract citation URLs
    source_urls_list = citations if isinstance(citations, list) else []

    return AuthenticityRubric(
        brand=brand,
        model=model,
        markers=markers,
        source_urls=source_urls_list,
    )


async def search_market_context(
    brand: str,
    model: Optional[str],
    size: Optional[str],
    color: Optional[str],
    condition: Optional[str],
    api_key: str,
) -> dict:
    """Search for market pricing context using Perplexity Sonar Pro.

    Returns general market intelligence — retail price, resale trends,
    demand indicators, and platform-specific pricing.

    Args:
        brand: Brand name.
        model: Model name (optional).
        size: Size (optional).
        color: Color (optional).
        condition: Condition (optional).
        api_key: Perplexity API key.

    Returns:
        Dict with market context data.
    """
    item_parts = [brand]
    if model:
        item_parts.append(model)
    if size:
        item_parts.append(f"size {size}")
    if color:
        item_parts.append(color)
    item_desc = " ".join(item_parts)

    condition_context = f" in {condition} condition" if condition else ""

    system_prompt = """You are a fashion resale market analyst specializing in UK markets.
Provide factual, data-driven market intelligence. Respond in this JSON format:
{
  "retail_price_gbp": null or number,
  "typical_resale_range_gbp": {"low": number, "high": number},
  "demand_level": "low" | "medium" | "high",
  "avg_days_to_sell": null or number,
  "price_trend": "rising" | "stable" | "declining",
  "key_factors": ["list of factors affecting price"],
  "variant_notes": "how this specific variant compares to others"
}

Be conservative with estimates. If unsure, use null rather than guessing."""

    user_prompt = (
        f"What is the current UK resale market value for a {item_desc}"
        f"{condition_context}? "
        f"Include typical prices on Vinted UK, eBay UK, and Vestiaire Collective. "
        f"How does this specific variant compare to other versions?"
    )

    payload = {
        "model": "sonar-pro",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "return_related_questions": False,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(PERPLEXITY_API_BASE, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    citations = data.get("citations", [])

    # Try to parse JSON from the response
    import json
    try:
        # Find JSON block in the response
        json_start = content.find("{")
        json_end = content.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            market_data = json.loads(content[json_start:json_end])
        else:
            market_data = {"raw_response": content}
    except json.JSONDecodeError:
        market_data = {"raw_response": content}

    market_data["citation_urls"] = citations if isinstance(citations, list) else []
    return market_data


def _parse_markers_from_response(content: str) -> list[AuthenticityMarkerDefinition]:
    """Parse authenticity markers from Perplexity's response text.

    Handles both clean JSON responses and JSON embedded in markdown.
    """
    import json

    markers: list[AuthenticityMarkerDefinition] = []

    try:
        # Try to find JSON block in the response
        json_start = content.find("{")
        json_end = content.rfind("}") + 1

        if json_start < 0 or json_end <= json_start:
            return _fallback_parse(content)

        parsed = json.loads(content[json_start:json_end])
        raw_markers = parsed.get("markers", [])

        for m in raw_markers:
            weight_str = m.get("weight", "SUPPORTING").upper()
            weight = MarkerWeight.CRITICAL if weight_str == "CRITICAL" else MarkerWeight.SUPPORTING

            markers.append(AuthenticityMarkerDefinition(
                name=m.get("name", "Unknown marker"),
                weight=weight,
                description=m.get("description", ""),
                authentic_tells=m.get("authentic_tells", []),
                counterfeit_tells=m.get("counterfeit_tells", []),
                source_url=m.get("source_url"),
            ))

    except (json.JSONDecodeError, KeyError, TypeError):
        return _fallback_parse(content)

    return markers


def _fallback_parse(content: str) -> list[AuthenticityMarkerDefinition]:
    """Fallback parser when JSON extraction fails.

    Creates basic markers from the text content.
    """
    # If we can't parse structured data, create a single catch-all marker
    return [
        AuthenticityMarkerDefinition(
            name="General Authentication Assessment",
            weight=MarkerWeight.SUPPORTING,
            description=content[:500] if content else "No authentication data available",
            authentic_tells=[],
            counterfeit_tells=[],
        )
    ]
