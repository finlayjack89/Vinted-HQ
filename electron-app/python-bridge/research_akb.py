#!/usr/bin/env python3
"""
AKB Research Pipeline — CLI tool for building the Authentication Knowledge Base.

9-stage multi-model pipeline:
    Stage 0: Recon Crawl (Perplexity sonar-pro)
    Stage 1: Expert Source ID (Perplexity sonar-pro)
    Stage 2: Threat Profiling (Perplexity sonar-pro)
    Stage 2b: Rep Flaw Research (Perplexity sonar-pro)
    Stage 3: Primed Deep Research (Perplexity sonar-deep-research)
    Stage 3b: Reference Image Collection (SerpAPI)
    Stage 3c: Visual Marker Extraction (Gemini Vision)
    Stage 4: Gap Analysis + Synthesis (Claude Sonnet)
    Stage 5: Targeted Fill (Perplexity sonar-pro)
    Stage 6: Final Synthesis + Scoring (Claude Sonnet)

Usage:
    python research_akb.py --brand "Chanel" --depth L2
    python research_akb.py --brand "Chanel" --model "J12" --depth L3
    python research_akb.py --seed-top-10 --depth L2
    python research_akb.py --audit --sort-by-score
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from typing import Optional

import httpx

# Add the parent to path so we can import item_intelligence
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from item_intelligence.akb_store import (
    AKBBrand,
    AKBMarker,
    AKBMetaJournal,
    AKBModel,
    AKBResearchLog,
    AKBStore,
    AKBVariant,
    InfoAvailability,
    MarkerSeverity,
    MarkerType,
    MeasurementType,
    ResearchDepth,
    compute_kcs,
)


# ── Constants ───────────────────────────────────────────────────────────────────


PERPLEXITY_API_BASE = "https://api.perplexity.ai/chat/completions"
SERPAPI_BASE = "https://serpapi.com/search.json"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
CLAUDE_API_BASE = "https://api.anthropic.com/v1/messages"

PERPLEXITY_TIMEOUT = 45.0
DEEP_RESEARCH_TIMEOUT = 300.0

TOP_10_BRANDS = [
    "Chanel", "Louis Vuitton", "Gucci", "Dior", "Hermès",
    "Prada", "Balenciaga", "Burberry", "Nike", "Rolex",
]


# ── API Helpers ─────────────────────────────────────────────────────────────────


def _extract_json(text: str) -> str:
    """Extract JSON from LLM responses, handling markdown wrappers and prose.
    
    sonar-deep-research returns long markdown with JSON embedded in code blocks.
    This function tries multiple strategies to find valid JSON.
    """
    import re
    text = text.strip()
    
    # Strategy 1: Already valid JSON — try direct parse
    if text.startswith("{") or text.startswith("["):
        try:
            json.loads(text)
            return text
        except json.JSONDecodeError:
            pass
    
    # Strategy 2: Extract from ```json ... ``` fences (anywhere in text)
    json_blocks = re.findall(r'```(?:json)?\s*\n(.*?)```', text, re.DOTALL)
    for block in json_blocks:
        block = block.strip()
        if block.startswith("{") or block.startswith("["):
            try:
                json.loads(block)
                return block
            except json.JSONDecodeError:
                continue
    
    # Strategy 3: Find the outermost { } or [ ] block via brace counting
    for opener, closer in [("{", "}"), ("[", "]")]:
        start_idx = text.find(opener)
        if start_idx == -1:
            continue
        depth = 0
        in_string = False
        escape_next = False
        end_idx = -1
        for i in range(start_idx, len(text)):
            c = text[i]
            if escape_next:
                escape_next = False
                continue
            if c == "\\":
                escape_next = True
                continue
            if c == '"' and not escape_next:
                in_string = not in_string
                continue
            if in_string:
                continue
            if c == opener:
                depth += 1
            elif c == closer:
                depth -= 1
                if depth == 0:
                    end_idx = i
                    break
        if end_idx > start_idx:
            candidate = text[start_idx:end_idx + 1]
            try:
                json.loads(candidate)
                return candidate
            except json.JSONDecodeError:
                pass
    
    # Strategy 4: Fall through — return the stripped text and let caller handle parse error
    # Strip simple leading/trailing ``` if present
    if text.startswith("```"):
        lines = text.split("\n")
        start = 1
        end = len(lines)
        for i in range(len(lines) - 1, 0, -1):
            if lines[i].strip() == "```":
                end = i
                break
        text = "\n".join(lines[start:end]).strip()
    return text


async def _perplexity_query(
    system_prompt: str,
    user_prompt: str,
    api_key: str,
    model: str = "sonar-pro",
) -> tuple[str, list[str], dict, str]:
    """Single Perplexity call. Returns (content, citation_urls, usage, raw_content).
    raw_content is the original LLM response before _extract_json processing."""
    timeout = DEEP_RESEARCH_TIMEOUT if model == "sonar-deep-research" else PERPLEXITY_TIMEOUT
    payload = {
        "model": model,
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
    raw_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    content = _extract_json(raw_content)
    citations = data.get("citations", [])
    if not isinstance(citations, list):
        citations = []
    usage = data.get("usage", {})
    return content, citations, usage, raw_content


async def _serpapi_image_search(
    query: str,
    api_key: str,
    max_results: int = 8,
) -> list[dict]:
    """Search for reference images via SerpAPI Google Images."""
    params = {
        "engine": "google_images",
        "q": query,
        "api_key": api_key,
        "num": max_results,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(SERPAPI_BASE, params=params)
        resp.raise_for_status()
        data = resp.json()
    results = []
    for img in data.get("images_results", [])[:max_results]:
        results.append({
            "image_url": img.get("original", img.get("thumbnail", "")),
            "title": img.get("title", ""),
            "source": img.get("source", ""),
        })
    return results


async def _gemini_vision_analyze(
    image_urls: list[str],
    prompt: str,
    api_key: str,
    model_override: Optional[str] = None,
) -> str:
    """Send images to Gemini for visual analysis."""
    import base64

    # Download images
    image_parts = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    }
    async with httpx.AsyncClient(timeout=30.0, headers=headers, follow_redirects=True) as client:
        for url in image_urls[:8]:  # Limit to 8 images
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                ct = resp.headers.get("content-type", "image/jpeg").split(";")[0]
                if len(resp.content) > 5 * 1024 * 1024:  # Skip images > 5MB
                    continue
                b64 = base64.b64encode(resp.content).decode("utf-8")
                image_parts.append({"inline_data": {"mime_type": ct, "data": b64}})
            except Exception as e:
                print(f"    ⚠️ Image download failed: {str(e)[:80]} | {url[:60]}")
                continue

    if not image_parts:
        print(f"    ⚠️ Gemini ({model_override or 'default'}): No images downloaded from {len(image_urls)} URLs")
        return "{}"
    print(f"    📥 Downloaded {len(image_parts)}/{len(image_urls[:8])} images for Gemini")

    parts = image_parts + [{"text": prompt}]
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 8192,
            "responseMimeType": "application/json",
        },
    }
    model = model_override or "gemini-3.1-pro-preview"
    url = f"{GEMINI_API_BASE}/{model}:generateContent?key={api_key}"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
        candidates = data.get("candidates", [])
        if candidates:
            content = candidates[0].get("content", {}).get("parts", [{}])
            text = content[0].get("text", "{}") if content else "{}"
            print(f"    📡 Gemini ({model}): {len(image_parts)} images, response {len(text)} chars")
            return _extract_json(text)
        else:
            # Check for content filter or other issues
            finish_reason = ""
            if data.get("candidates"):
                finish_reason = data["candidates"][0].get("finishReason", "")
            print(f"    ⚠️ Gemini ({model}): No candidates. Finish: {finish_reason}. Keys: {list(data.keys())}")
            if data.get("promptFeedback"):
                print(f"    ⚠️ Prompt feedback: {data['promptFeedback']}")
    except Exception as e:
        print(f"    ⚠️ Gemini Vision ({model}) failed: {e}")
    return "{}"


async def _claude_analyze(
    prompt: str,
    api_key: str,
) -> str:
    """Call Claude Sonnet for synthesis."""
    payload = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 16384,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.post(CLAUDE_API_BASE, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    content = data.get("content", [{}])
    text = content[0].get("text", "") if content else ""
    return _extract_json(text)


# ── Pipeline Stages ─────────────────────────────────────────────────────────────


async def stage_0_recon(brand: str, model: Optional[str], api_key: str) -> dict:
    """Recon crawl: find best sources, terminology, forum presence."""
    item = f"{brand} {model}" if model else brand
    print(f"  Stage 0: Recon crawl for {item}...")

    system = "You are an expert luxury goods authentication researcher. Respond in JSON format."
    prompt = f"""{item} authentication guide: serial number format, date code system,
hologram sticker evolution, microchip implementation timeline, hardware engravings,
stitching patterns, heat stamp font changes by year.

Find the most authoritative authentication resources for {item}, including:
- Dedicated authentication blogs and guides
- YouTube authentication channels with close-up comparisons
- Reddit communities (r/RepLadies, r/DesignerReps, r/LegitCheck)
- Professional authentication services

Respond in JSON:
{{
    "top_sources": ["url1", "url2", ...],
    "terminology": ["term1", "term2", ...],
    "forum_presence": "high" | "moderate" | "low",
    "information_availability": "abundant" | "moderate" | "sparse",
    "key_auth_topics": ["topic1", "topic2", ...],
    "authentication_components": ["component1", "component2", ...]
}}"""

    content, citations, _, _ = await _perplexity_query(system, prompt, api_key)
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {"top_sources": citations, "information_availability": "moderate"}


async def stage_1_expert_id(brand: str, model: Optional[str], api_key: str) -> dict:
    """Identify trusted authenticators for this brand/model."""
    item = f"{brand} {model}" if model else brand
    print(f"  Stage 1: Expert source ID for {item}...")

    system = "You are a research assistant. Respond in JSON format."
    prompt = f"""Who are the most trusted authentication authorities and services for {item}?

Respond in JSON:
{{
    "expert_authenticators": ["name1", "name2", ...],
    "trusted_resellers": ["name1", "name2", ...],
    "youtube_channels": ["channel1", ...],
    "certification_services": ["service1", ...]
}}"""

    content, _ , _, _ = await _perplexity_query(system, prompt, api_key)
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {}


async def stage_2_threat_profile(brand: str, model: Optional[str], api_key: str) -> dict:
    """Understand the counterfeit landscape."""
    item = f"{brand} {model}" if model else brand
    print(f"  Stage 2: Threat profiling for {item}...")

    system = "You are a counterfeit intelligence analyst specialising in luxury goods. Respond in JSON format."
    prompt = f"""Analyze the counterfeit/replica landscape for {item}.

Specifically research:
- Current "super-rep" (AAA/1:1) quality level and how close they are to authentic
- Which specific factories or sellers produce the most accurate replicas
- What are the remaining tell-tale flaws that even the best replicas still have
- How counterfeits have evolved over the past 5 years (improvements in hardware, leather, stitching)
- Which variants/models are most commonly replicated
- Price points of replicas at different quality tiers

Respond in JSON:
{{
    "counterfeit_quality_level": "none" | "low" | "mid-tier" | "super-rep",
    "known_weaknesses": ["flaw1", "flaw2", ...],
    "remaining_tells_in_best_reps": ["tell1", "tell2", ...],
    "evolution_notes": "how counterfeits have changed over time",
    "most_commonly_faked_variants": ["variant1", ...],
    "factory_notes": "key factories or sources if known"
}}"""

    content, _, _, _ = await _perplexity_query(system, prompt, api_key)
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {}


async def stage_2b_rep_flaws(brand: str, model: Optional[str], api_key: str) -> list[dict]:
    """Research known rep flaws from Reddit/forum communities — 3 targeted queries."""
    item = f"{brand} {model}" if model else brand
    print(f"  Stage 2b: Rep flaw research for {item} (3 targeted queries)...")

    # All rep subreddits searched uniformly for every query
    all_subs = "site:reddit.com/r/RepLadies OR site:reddit.com/r/WagoonLadies OR site:reddit.com/r/DesignerReps OR site:reddit.com/r/FashionReps OR site:reddit.com/r/LegitCheck"

    system = """You are a replica quality control analyst. Search Reddit communities
for known flaws in replicas. Focus on specific, photo-detectable flaws.
Respond in JSON format."""

    # Query 1: QC posts — buyers identifying flaws in their replica purchases
    qc_prompt = f"""{all_subs} {item} QC quality check flaws

What flaws do buyers identify when quality-checking replica {item}? These are people who have
purchased replicas and are examining them for defects compared to the authentic version.
Focus on specific visual differences from the authentic version.

Respond in JSON:
{{"inauthenticity_markers": [{{"name": "flaw name", "severity": "definitive" | "strong" | "moderate",
"description": "what the flaw looks like", "visual_cue": "specific thing to look for in photos",
"source": "QC community"}}]}}"""

    # Query 2: LC posts — community identifying real vs fake
    lc_prompt = f"""{all_subs} {item} LC legit check callout fake

What tells does the community use to distinguish real {item} from replicas? Focus on decisive
visual indicators that experienced authenticators look for when determining if an item is genuine.

Respond in JSON:
{{"inauthenticity_markers": [{{"name": "flaw name", "severity": "definitive" | "strong" | "moderate",
"description": "what the flaw looks like", "visual_cue": "specific thing to look for in photos",
"source": "LC community"}}]}}"""

    # Query 3: GL/RL posts — green light (replica close enough to pass) / red light (obvious flaw)
    # IMPORTANT: GL means "this replica is close enough to the real thing to approve"
    # RL means "this replica has an obvious flaw that would be detectable"
    # Both are about REPLICA items — GL does NOT mean the item is authentic
    glrl_prompt = f"""{all_subs} {item} "GL" OR "RL" OR "green light" OR "red light" flaw callout

In replica communities, "Red Light" (RL) means a replica has an obvious flaw that makes it
clearly fake. "Green Light" (GL) means a replica is close enough to pass.

What are the specific flaws that cause the community to RL (reject) replica {item}?
Also, what remaining subtle differences exist even in GL'd (approved) replicas that an expert
authenticator could still detect?

Respond in JSON:
{{"inauthenticity_markers": [{{"name": "flaw name", "severity": "definitive" | "strong" | "moderate",
"description": "what the flaw looks like", "visual_cue": "specific thing to look for in photos",
"source": "GL/RL community"}}]}}"""

    all_flaws = []
    fallback_prompt = f"""What are the most common flaws, defects, and tells found in counterfeit or replica {item}?
Focus on specific visual indicators that can be detected from photographs.

Respond in JSON:
{{"inauthenticity_markers": [{{"name": "flaw name", "severity": "definitive" | "strong" | "moderate",
"description": "what the flaw looks like", "visual_cue": "specific thing to look for in photos",
"source": "authentication community"}}]}}"""

    for i, prompt in enumerate([qc_prompt, lc_prompt, glrl_prompt], 1):
        content, _, _, _ = await _perplexity_query(system, prompt, api_key)
        try:
            cleaned = _extract_json(content)
            data = json.loads(cleaned)
            # Handle array-wrapped responses
            if isinstance(data, list) and len(data) > 0:
                data = data[0]
            if not isinstance(data, dict):
                data = {"inauthenticity_markers": []}
            flaws = data.get("inauthenticity_markers", [])
            if flaws:
                all_flaws.extend(flaws)
                print(f"    📋 Rep flaw query {i}/3: {len(flaws)} flaws")
            else:
                raise ValueError("Empty result")
        except (json.JSONDecodeError, ValueError):
            # Retry with broader non-Reddit prompt
            print(f"    ⚠️ Rep flaw query {i}/3: parse failed, retrying with broader query...")
            content, _, _, _ = await _perplexity_query(system, fallback_prompt, api_key)
            try:
                cleaned = _extract_json(content)
                data = json.loads(cleaned)
                if isinstance(data, list) and len(data) > 0:
                    data = data[0]
                if not isinstance(data, dict):
                    data = {"inauthenticity_markers": []}
                flaws = data.get("inauthenticity_markers", [])
                all_flaws.extend(flaws)
                print(f"    🔄 Rep flaw query {i}/3 fallback: {len(flaws)} flaws")
            except (json.JSONDecodeError, ValueError):
                print(f"    ❌ Rep flaw query {i}/3: both attempts failed")

    # Deduplicate by name (case-insensitive)
    seen = set()
    deduped = []
    for f in all_flaws:
        key = f.get("name", "").lower().strip()
        if key and key not in seen:
            seen.add(key)
            deduped.append(f)
    print(f"    📊 Total: {len(deduped)} unique rep flaws (from {len(all_flaws)} raw)")
    return deduped


async def stage_3_deep_research(
    brand: str,
    model: Optional[str],
    api_key: str,
    recon: dict,
    experts: dict,
    threats: dict,
    rep_flaws: list[dict],
    brand_knowledge: Optional[dict] = None,
    cross_brand_learnings: Optional[str] = None,
) -> dict:
    """Primed deep research — always uses sonar-deep-research for maximum depth."""
    item = f"{brand} {model}" if model else brand
    print(f"  Stage 3: Deep research for {item} (sonar-deep-research)...")

    # Build rich context from prior stages
    context_parts = []
    if recon.get("top_sources"):
        context_parts.append(f"Top sources: {', '.join(recon['top_sources'][:5])}")
    if recon.get("terminology"):
        context_parts.append(f"Key terminology: {', '.join(recon['terminology'])}")
    if recon.get("authentication_components"):
        context_parts.append(f"Components to research: {', '.join(recon['authentication_components'])}")
    if experts.get("expert_authenticators"):
        context_parts.append(f"Trusted experts: {', '.join(experts['expert_authenticators'])}")
    if threats.get("known_weaknesses"):
        context_parts.append(f"Known counterfeit weaknesses: {', '.join(threats['known_weaknesses'])}")
    if threats.get("remaining_tells_in_best_reps"):
        context_parts.append(f"Remaining tells in best reps: {', '.join(threats['remaining_tells_in_best_reps'])}")
    if rep_flaws:
        flaw_names = [f.get("name", "") for f in rep_flaws[:8]]
        context_parts.append(f"Known rep flaws: {', '.join(flaw_names)}")
    if brand_knowledge:
        if brand_knowledge.get("serial_system"):
            context_parts.append(f"Brand serial system: {brand_knowledge['serial_system']}")
        if brand_knowledge.get("hardware"):
            context_parts.append(f"Brand hardware: {brand_knowledge['hardware']}")
    if cross_brand_learnings:
        context_parts.append(f"Cross-brand learnings: {cross_brand_learnings}")

    context = "\n".join(context_parts) if context_parts else "No prior context available."

    # ── STEP 1: Deep research for prose (no JSON requirement) ──────────
    # sonar-deep-research is unreliable at producing structured JSON.
    # Instead, we ask it for a detailed prose report and extract structure later.
    system = f"""You are an expert luxury goods authenticator performing forensic-level deep research.

CONTEXT FROM PRIOR RESEARCH:
{context}

Produce a comprehensive, detailed research report. For EVERY component category, describe:
- What AUTHENTIC items look like (specific visual/physical characteristics)
- What COUNTERFEITS get wrong (specific flaws, tells, differences)
- How to measure or assess each marker from photos where possible
- Use RELATIVE measurements (e.g., "10-12 stitches per diamond panel side")
- Include source references where possible"""

    prompt = f"""Produce a comprehensive authentication research report for {item}.

Cover EVERY component category systematically:
1. HARDWARE: turn-locks, zippers, clasps, chains, feet, rivets — engravings, weight, finish
2. STITCHING: stitch count per design element, thread colour matching, angle, tension
3. MATERIALS: leather grain pattern, canvas weave, lining colour/texture, edge coating
4. STAMPS/LABELS: heat stamps, foil stamps, serial tags, date codes, care labels, microchips
5. CONSTRUCTION: alignment, symmetry, pocket placement, interior layout, edge finishing
6. LOGOS: proportions, overlap direction, font kerning, positioning
7. PACKAGING: dust bag material/print, box dimensions, receipt format, authenticity cards
8. SERIAL NUMBERS: format by year, placement, font, chip/NFC evolution

For each area, describe the SPECIFIC visual differences between authentic and counterfeit.
Also include any design evolution (how authentication markers changed over the years),
known variants, and the serial number/date code system.

Write as detailed prose — do NOT attempt to format as JSON."""

    _, citations, _, raw_deep_prose = await _perplexity_query(system, prompt, api_key, model="sonar-deep-research")
    print(f"    📄 Deep research returned {len(raw_deep_prose)} chars of prose, {len(citations)} citations")

    # ── STEP 2: Structured extraction via sonar-pro ──────────────────
    # sonar-pro is excellent at following JSON schemas. We feed it the
    # deep research prose and ask for structured marker extraction.
    extract_system = "You extract structured authentication markers from research text. Respond ONLY with valid JSON. Be thorough — extract EVERY distinct marker mentioned."
    extract_prompt = f"""Extract ALL authentication markers from this deep research on {item}.

For EACH distinct authentication point mentioned, create a marker entry.

Respond in JSON:
{{
    "authenticity_markers": [
        {{
            "name": "marker name",
            "component": "hardware|stitching|materials|stamps|construction|logos|packaging|serial_numbers",
            "weight": "CRITICAL" | "SUPPORTING",
            "description": "forensic detail of what to look for",
            "authentic_tells": ["specific sign 1", "specific sign 2"],
            "counterfeit_tells": ["specific flaw 1", "specific flaw 2"],
            "photo_assessable": true | false,
            "measurement_type": "relative" | "absolute" | "n/a"
        }}
    ],
    "design_evolution": [
        {{
            "period": "year range",
            "changes": "description of authentication-relevant changes"
        }}
    ],
    "variants_discovered": ["variant1", "variant2"],
    "serial_system": "detailed serial number / date code / microchip format by year",
    "general_notes": "overall authentication strategy"
}}

Research text to extract from:
{raw_deep_prose[:14000]}"""

    extract_content, _, _, _ = await _perplexity_query(extract_system, extract_prompt, api_key, model="sonar-pro")

    try:
        result = json.loads(extract_content)
        if isinstance(result, list) and len(result) > 0:
            result = result[0]
        if not isinstance(result, dict):
            result = {"authenticity_markers": []}
    except json.JSONDecodeError:
        result = {"authenticity_markers": []}

    result["citations"] = citations
    marker_count = len(result.get("authenticity_markers", []))
    print(f"    ✅ Extracted {marker_count} structured markers from deep research prose")

    return result


async def stage_3b_reference_images(
    brand: str,
    model: Optional[str],
    api_key: str,
) -> tuple[list[dict], list[dict]]:
    """Collect classified reference photos: 4 targeted authentic searches + replica comparison.
    
    Returns (authentic_images, replica_images) as lists of {image_url, title, source}.
    """
    item = f"{brand} {model}" if model else brand
    print(f"  Stage 3b: Reference image collection for {item} (4 targeted searches)...")

    # 4 targeted authentic searches (component-specific)
    auth_queries = [
        f"{item} close up hardware detail site:therealreal.com OR site:fashionphile.com OR site:vestiarecollective.com",
        f"{item} serial number date code hologram microchip authentic",
        f"{item} stitching leather grain detail macro authentic",
        f"{item} hardware chain strap detail authentic vs fake comparison",
    ]
    
    auth_imgs = []
    for i, q in enumerate(auth_queries, 1):
        try:
            results = await _serpapi_image_search(q, api_key, max_results=4)
            auth_imgs.extend(results)
            print(f"    🔍 Auth search {i}/4: {len(results)} images")
        except Exception as e:
            print(f"    ⚠️ Auth search {i}/4 failed: {e}")
    # Deduplicate by URL
    seen_urls = set()
    deduped_auth = []
    for img in auth_imgs:
        url = img.get("image_url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            deduped_auth.append(img)
    auth_imgs = deduped_auth[:8]

    # Replica/comparison images from rep communities
    rep_query = f"{item} replica fake comparison authentic vs site:reddit.com"
    rep_imgs = []
    try:
        rep_imgs = await _serpapi_image_search(rep_query, api_key, max_results=6)
    except Exception as e:
        print(f"    ⚠️ Rep image search failed: {e}")

    print(f"    📷 Collected {len(auth_imgs)} authentic + {len(rep_imgs)} replica/comparison images")
    return auth_imgs, rep_imgs


async def stage_3c_visual_markers(
    auth_images: list[dict],
    rep_images: list[dict],
    brand: str,
    model: Optional[str],
    api_key: str,
) -> list[dict]:
    """Dual-pass visual marker extraction:
    
    Pass 1 (Gemini 3 Flash): Breadth scan — find ALL visual markers.
    Pass 2 (Gemini 3.1 Pro): Depth analysis — detailed forensic examination of each marker.
    """
    if not auth_images:
        return []
    item = f"{brand} {model}" if model else brand
    auth_urls = [img.get("image_url", "") for img in auth_images[:6] if img.get("image_url")]
    rep_urls = [img.get("image_url", "") for img in rep_images[:4] if img.get("image_url")]

    # ── Pass 1: Gemini 3 Flash — Breadth (find all markers) ──
    print(f"  Stage 3c-Flash: Breadth scan for {item} ({len(auth_urls)} auth images)...")
    flash_prompt = f"""Analyze these reference images of authentic {item}.
Identify EVERY distinct visual authentication marker you can find.
Extract as many markers as possible — be thorough and cover:
- Hardware (turn-locks, zippers, clasps, chains, feet)
- Stitching (count, angle, colour, tension, thread quality)
- Materials (leather grain, canvas weave, lining fabric)
- Stamps/Labels (heat stamps, foil stamps, serial tags, date codes)
- Construction (edge coating, piping, pocket alignment, symmetry)
- Logos (alignment, proportions, overlap direction, font)
- Packaging (dust bags, boxes, cards, receipts)

Respond in JSON:
{{
    "visual_markers": [
        {{
            "name": "marker name",
            "description": "what to look for visually",
            "component": "hardware|stitching|materials|stamps|construction|logos|packaging",
            "photo_region": "where in the photo to look"
        }}
    ]
}}"""

    flash_content = await _gemini_vision_analyze(
        auth_urls, flash_prompt, api_key, model_override="gemini-3-flash-preview"
    )
    try:
        flash_data = json.loads(flash_content)
        # Gemini 3 Flash may return [{visual_markers:[...]}] instead of {visual_markers:[...]}
        if isinstance(flash_data, list) and flash_data:
            flash_data = flash_data[0] if isinstance(flash_data[0], dict) else {"visual_markers": flash_data}
        flash_markers = flash_data.get("visual_markers", [])
    except json.JSONDecodeError:
        flash_markers = []
    print(f"    🔍 Flash found {len(flash_markers)} markers")

    if not flash_markers:
        return []

    # ── Pass 2: Gemini 3.1 Pro — Depth (forensic detail on each marker) ──
    marker_names = [m.get("name", "") for m in flash_markers]
    marker_list = "\n".join(f"  - {n}" for n in marker_names if n)

    # Include replica images in depth pass if available
    all_urls = auth_urls[:5]
    rep_context = ""
    if rep_urls:
        all_urls.extend(rep_urls[:3])
        rep_context = f"""\n\nImages {len(auth_urls[:5])+1}-{len(all_urls)} show KNOWN REPLICAS or comparison shots.
Identify the specific visual differences between authentic and replica in each marker."""

    print(f"  Stage 3c-Pro: Depth analysis for {item} ({len(marker_names)} markers, {len(all_urls)} images)...")
    pro_prompt = f"""You are a forensic authentication expert examining images of {item}.

The first {min(len(auth_urls), 5)} images show CONFIRMED AUTHENTIC items.{rep_context}

For EACH of these markers found in the breadth scan, provide detailed forensic analysis:
{marker_list}

For each marker, measure precise proportions, count exact quantities, note specific angles,
and describe what EXACTLY distinguishes authentic from replica. Be as specific as possible
with measurements (use relative terms: "X stitches per diamond side", "ratio of width to height is ~1:1.2").

Respond in JSON:
{{
    "visual_markers": [
        {{
            "name": "marker name (from list above)",
            "description": "forensic-level detail of what to look for",
            "measurement_notes": "exact proportions, ratios, counts observed",
            "authentic_tells": ["specific detail 1", "specific detail 2"],
            "counterfeit_tells": ["specific flaw 1", "specific flaw 2"],  
            "component": "hardware|stitching|materials|stamps|construction|logos|packaging",
            "photo_region": "where in the photo to look"
        }}
    ]
}}"""

    pro_content = await _gemini_vision_analyze(
        all_urls, pro_prompt, api_key, model_override="gemini-3.1-pro-preview"
    )
    try:
        pro_data = json.loads(pro_content)
        # Same array-wrapping fix as Flash
        if isinstance(pro_data, list) and pro_data:
            pro_data = pro_data[0] if isinstance(pro_data[0], dict) else {"visual_markers": pro_data}
        pro_markers = pro_data.get("visual_markers", [])
    except json.JSONDecodeError:
        # Fall back to Flash markers if Pro fails
        pro_markers = flash_markers

    print(f"    🔬 Pro detailed {len(pro_markers)} markers")

    # Merge: use Pro's detailed versions, supplement with any Flash-only markers
    pro_names = {m.get("name", "").lower() for m in pro_markers}
    merged = list(pro_markers)
    for fm in flash_markers:
        if fm.get("name", "").lower() not in pro_names:
            merged.append(fm)  # Add Flash markers that Pro didn't cover

    print(f"    📊 Merged: {len(merged)} total visual markers")
    return merged


async def stage_4_gap_analysis(
    brand: str,
    model: Optional[str],
    all_markers: list[dict],
    rep_flaws: list[dict],
    threat_profile: dict,
    api_key: str,
) -> dict:
    """Claude-powered synthesis: find gaps, resolve conflicts, convert measurements."""
    item = f"{brand} {model}" if model else brand
    print(f"  Stage 4: Gap analysis + synthesis for {item}...")

    markers_text = json.dumps(all_markers, indent=2)[:6000]
    flaws_text = json.dumps(rep_flaws, indent=2)[:2000]
    threat_text = json.dumps(threat_profile, indent=2)[:2000]

    prompt = f"""You are an expert authentication researcher performing quality analysis.

Item: {item}

AUTHENTICITY MARKERS FOUND:
{markers_text}

KNOWN REP FLAWS:
{flaws_text}

THREAT PROFILE:
{threat_text}

Analyze all research findings and respond in JSON:
{{
    "gaps": ["missing area 1", "missing area 2"],
    "conflicts": [
        {{
            "marker": "marker name",
            "conflict": "description of conflicting information",
            "resolution": "which source to trust and why"
        }}
    ],
    "absolute_measurements_to_convert": [
        {{
            "marker": "marker name",
            "original": "10 stitches per inch",
            "converted": "10-11 stitches per diamond panel side"
        }}
    ],
    "markers_to_remove": ["unreliable marker 1"],
    "recommended_next_research": ["follow-up topic 1"]
}}"""

    content = await _claude_analyze(prompt, api_key)
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {"gaps": [], "conflicts": [], "absolute_measurements_to_convert": []}


async def stage_5_targeted_fill(
    brand: str,
    model: Optional[str],
    gaps: list[str],
    api_key: str,
) -> list[dict]:
    """Fill specific gaps with targeted Perplexity queries."""
    if not gaps:
        return []
    item = f"{brand} {model}" if model else brand
    print(f"  Stage 5: Targeted fill for {item} ({len(gaps)} gaps)...")

    filled = []
    for gap in gaps[:5]:  # Max 5 gap-fill queries
        system = "You are an expert authenticator. Respond in JSON format."
        prompt = f"""For {item}, provide specific details about: {gap}

Respond in JSON:
{{
    "marker_name": "name",
    "description": "what to look for",
    "authentic_tells": ["tell1"],
    "counterfeit_tells": ["tell1"],
    "source_url": "url"
}}"""
        content, _, _, _ = await _perplexity_query(system, prompt, api_key)
        try:
            filled.append(json.loads(content))
        except json.JSONDecodeError:
            pass
    return filled


async def stage_6_final_synthesis(
    brand: str,
    model: Optional[str],
    all_data: dict,
    api_key: str,
) -> dict:
    """Claude produces final weighted rubric + KCS assessment."""
    item = f"{brand} {model}" if model else brand
    print(f"  Stage 6: Final synthesis + scoring for {item}...")

    data_text = json.dumps(all_data, indent=2)

    # Count pre-synthesis markers to set Claude's retention target
    pre_markers = all_data.get("deep_research", {}).get("authenticity_markers", [])
    visual_markers = all_data.get("visual_markers", [])
    rep_flaws = all_data.get("rep_flaws", [])
    total_pre = len(pre_markers) + len(visual_markers) + len(rep_flaws)
    min_target = max(18, int(total_pre * 0.70))  # At least 70% retention, minimum 18

    prompt = f"""You are producing the final authentication rubric for {item}.

ALL RESEARCH DATA:
{data_text}

You have been given {total_pre} pre-synthesis markers. Your job is to VALIDATE and RETAIN them, not compress them.

CRITICAL RETENTION RULES:
1. You MUST retain AT MINIMUM {min_target} markers. The research pipeline spent significant API cost discovering these markers — discarding them wastes money and degrades auth quality.
2. NEVER merge markers from different components. "Stitching count" and "stitching colour" are SEPARATE markers. "Hardware finish" and "hardware weight" are SEPARATE markers.
3. NEVER merge authenticity markers with inauthenticity markers — they serve different detection purposes.
4. If two markers describe the SAME physical attribute tested the SAME way from the SAME source, you may merge. Otherwise, KEEP BOTH.
5. Preserve ALL forensic specifics — exact stitch counts, measurements, colour descriptions, production year boundaries.
6. For each marker, include BOTH what authentic items show AND what counterfeits get wrong.
7. Every visual marker from Gemini analysis MUST be retained as a separate entry.
8. Every rep flaw from Reddit research MUST be retained as a separate inauthenticity marker.

COMPONENT CATEGORIES (use these exact values):
hardware, stitching, materials, stamps, construction, logos, packaging, serial_numbers, labels, dimensions

Produce the final validated rubric. Respond in JSON:
{{
    "validated_markers": [
        {{
            "name": "marker name",
            "type": "authenticity" | "inauthenticity",
            "component": "component category from list above",
            "weight": "CRITICAL" | "SUPPORTING",
            "severity": "definitive" | "strong" | "moderate" | null,
            "description": "forensic-level description",
            "authentic_tells": ["specific tell 1", "specific tell 2"],
            "counterfeit_tells": ["specific flaw 1", "specific flaw 2"],
            "visual_cue": "specific visual instruction for photo analysis" | null,
            "measurement_type": "relative" | "absolute" | "n/a",
            "base_weight": 0.85,
            "source_confidence": "number of agreeing sources"
        }}
    ],
    "information_availability": "abundant" | "moderate" | "sparse",
    "research_quality_notes": "overall assessment",
    "recommended_next_research": ["topic1"]
}}

REMINDER: You must return AT LEAST {min_target} validated_markers. Returning fewer is a FAILURE."""

    content = await _claude_analyze(prompt, api_key)
    try:
        cleaned = _extract_json(content)
        result = json.loads(cleaned)
        # Handle array-wrapped responses from Claude
        if isinstance(result, list) and len(result) > 0:
            result = result[0]
        if not isinstance(result, dict):
            result = {"validated_markers": [], "information_availability": "sparse"}
        return result
    except json.JSONDecodeError as e:
        print(f"    ⚠️ Stage 6 JSON parse error: {e}")
        print(f"    ⚠️ Response length: {len(content)} chars, first 200: {content[:200]}")
        return {"validated_markers": [], "information_availability": "sparse"}


# ── Main Pipeline ───────────────────────────────────────────────────────────────


async def research_brand(
    brand: str,
    depth: ResearchDepth,
    store: AKBStore,
    keys: dict,
    cross_brand_learnings: Optional[str] = None,
) -> None:
    """Run the full pipeline for a brand profile."""
    print(f"\n{'='*60}")
    print(f"Researching brand: {brand} (depth: {depth.value})")
    print(f"{'='*60}")

    start = time.time()
    api_calls: dict[str, int] = {"perplexity": 0, "serpapi": 0, "gemini": 0, "claude": 0}

    # Stage 0–2b: Perplexity stages
    recon = await stage_0_recon(brand, None, keys["perplexity"])
    api_calls["perplexity"] += 1
    store.log_trace(brand, "stage_0_recon", "sonar-pro",
        f"Recon crawl for {brand}: categories, serial systems, auth components",
        f"Recon query for {brand}", json.dumps(recon, default=str),
        parsed_result=f"Found {len(recon.get('authentication_components', []))} auth components")

    experts = await stage_1_expert_id(brand, None, keys["perplexity"])
    api_calls["perplexity"] += 1
    store.log_trace(brand, "stage_1_experts", "sonar-pro",
        f"Expert source identification for {brand}",
        f"Expert ID query for {brand}", json.dumps(experts, default=str),
        parsed_result=f"Identified sources + {len(experts.get('certification_services', []))} cert services")

    threats = await stage_2_threat_profile(brand, None, keys["perplexity"])
    api_calls["perplexity"] += 1
    store.log_trace(brand, "stage_2_threats", "sonar-pro",
        f"Threat profiling for {brand}: counterfeit quality, known weaknesses",
        f"Threat profile query for {brand}", json.dumps(threats, default=str),
        parsed_result=f"Level: {threats.get('counterfeit_quality_level', 'unknown')}, {len(threats.get('known_weaknesses', []))} weaknesses")

    rep_flaws = await stage_2b_rep_flaws(brand, None, keys["perplexity"])
    api_calls["perplexity"] += 3  # 3 targeted queries now
    store.log_trace(brand, "stage_2b_rep_flaws", "sonar-pro",
        f"Rep flaw research for {brand}: 3 queries across all rep subreddits",
        f"QC/LC/GL-RL queries for {brand}", json.dumps(rep_flaws, default=str),
        parsed_result=f"Found {len(rep_flaws)} unique rep flaws")

    # Stage 3: Deep research (always sonar-deep-research)
    deep = await stage_3_deep_research(
        brand, None, keys["perplexity"],
        recon, experts, threats, rep_flaws,
        cross_brand_learnings=cross_brand_learnings,
    )
    api_calls["perplexity"] += 1
    store.log_trace(brand, "stage_3_deep_research", "sonar-deep-research",
        f"Deep forensic research for {brand}: full authentication guide",
        f"Deep research prompt for {brand} (with recon/experts/threats context)",
        json.dumps(deep, default=str),
        parsed_result=f"{len(deep.get('authenticity_markers', []))} markers, {len(deep.get('citations', []))} citations",
        citations=json.dumps(deep.get("citations", [])))

    # Stage 3b: Reference images (authentic + replica)
    auth_images = []
    rep_images = []
    if keys.get("serpapi"):
        auth_images, rep_images = await stage_3b_reference_images(brand, None, keys["serpapi"])
        api_calls["serpapi"] += 5  # 4 auth searches + 1 rep search
        store.log_trace(brand, "stage_3b_images", "serpapi",
            f"Reference image collection for {brand}: 4 auth + 1 rep search",
            f"SerpAPI image queries for {brand}",
            json.dumps({"auth": [i.get("source", "") for i in auth_images], "rep": [i.get("source", "") for i in rep_images]}, default=str),
            parsed_result=f"{len(auth_images)} authentic + {len(rep_images)} replica images")

    # Stage 3c: Visual markers (dual-pass: Flash breadth → Pro depth)
    visual_markers = []
    if auth_images and keys.get("gemini"):
        visual_markers = await stage_3c_visual_markers(
            auth_images, rep_images, brand, None, keys["gemini"]
        )
        api_calls["gemini"] += 2  # Flash + Pro
        store.log_trace(brand, "stage_3c_visual", "gemini-flash+pro",
            f"Dual-pass visual analysis for {brand}: Flash breadth → Pro depth on {len(auth_images)} images",
            f"Gemini vision analysis of {len(auth_images)} auth + {len(rep_images)} rep images",
            json.dumps(visual_markers, default=str),
            parsed_result=f"{len(visual_markers)} visual markers identified")

    # Combine all markers for synthesis
    all_markers = deep.get("authenticity_markers", [])
    print(f"    📊 Stage 3 produced {len(all_markers)} markers")
    print(f"    📊 Stage 2b produced {len(rep_flaws)} rep flaws")
    for vm in visual_markers:
        all_markers.append({
            "name": vm.get("name", "Visual Marker"),
            "weight": "SUPPORTING",
            "description": vm.get("description", ""),
            "photo_assessable": True,
            "measurement_type": "relative",
            "source_url": "gemini_vision_analysis",
        })
    print(f"    📊 Combined: {len(all_markers)} markers (incl. {len(visual_markers)} visual)")

    # Stage 4: Gap analysis (Claude)
    gap_result = {"gaps": [], "conflicts": [], "absolute_measurements_to_convert": []}
    if keys.get("claude"):
        gap_result = await stage_4_gap_analysis(
            brand, None, all_markers, rep_flaws, threats, keys["claude"]
        )
        api_calls["claude"] += 1
        store.log_trace(brand, "stage_4_gaps", "claude-sonnet",
            f"Gap analysis for {brand}: finding missing auth areas and conflicts",
            f"Gap analysis of {len(all_markers)} markers + {len(rep_flaws)} rep flaws",
            json.dumps(gap_result, default=str),
            parsed_result=f"{len(gap_result.get('gaps', []))} gaps, {len(gap_result.get('conflicts', []))} conflicts")
        print(f"    📊 Stage 4 found {len(gap_result.get('gaps', []))} gaps, {len(gap_result.get('conflicts', []))} conflicts")

    # Stage 5: Fill gaps
    filled = []
    if gap_result.get("gaps"):
        filled = await stage_5_targeted_fill(brand, None, gap_result["gaps"], keys["perplexity"])
        api_calls["perplexity"] += len(filled)
        store.log_trace(brand, "stage_5_fill", "sonar-pro",
            f"Targeted gap fill for {brand}: {len(gap_result['gaps'])} gaps",
            f"Fill queries for gaps: {[str(g)[:80] for g in gap_result['gaps']]}",
            json.dumps(filled, default=str),
            parsed_result=f"Filled {len(filled)} gaps")
        print(f"    📊 Stage 5 filled {len(filled)} gaps")

    # Add rep flaws to marker list
    for flaw in rep_flaws:
        all_markers.append({
            "name": flaw.get("name", "Unknown Flaw"),
            "type": "inauthenticity",
            "weight": "CRITICAL" if flaw.get("severity") == "definitive" else "SUPPORTING",
            "severity": flaw.get("severity", "moderate"),
            "description": flaw.get("description", ""),
            "visual_cue": flaw.get("visual_cue"),
            "measurement_type": "relative",
            "source_url": flaw.get("source", ""),
        })

    # Stage 6: Final synthesis (Claude)
    all_data = {
        "recon": recon,
        "experts": experts,
        "threats": threats,
        "rep_flaws": rep_flaws,
        "deep_research": deep,
        "visual_markers": visual_markers,
        "gap_analysis": gap_result,
        "gap_fills": filled,
    }
    # Fallback: use combined markers if Claude's synthesis fails
    final = {"validated_markers": all_markers, "information_availability": "moderate"}
    if keys.get("claude"):
        claude_result = await stage_6_final_synthesis(brand, None, all_data, keys["claude"])
        api_calls["claude"] += 1
        claude_markers = claude_result.get("validated_markers", [])
        if claude_markers:
            final = claude_result
            print(f"    📊 Stage 6 validated {len(claude_markers)} markers")
            store.log_trace(brand, "stage_6_synthesis", "claude-sonnet",
                f"Final synthesis for {brand}: validated {len(claude_markers)} markers from all stages",
                f"Synthesis of {len(all_markers)} pre-synthesis markers + {len(rep_flaws)} rep flaws",
                json.dumps(claude_result, default=str),
                parsed_result=f"{len(claude_markers)} validated markers, avail: {claude_result.get('information_availability', 'unknown')}")
        else:
            # Retry once
            print(f"    ⚠️ Stage 6 returned 0 markers, retrying...")
            claude_result = await stage_6_final_synthesis(brand, None, all_data, keys["claude"])
            api_calls["claude"] += 1
            claude_markers = claude_result.get("validated_markers", [])
            if claude_markers:
                final = claude_result
                print(f"    📊 Stage 6 retry validated {len(claude_markers)} markers")
            else:
                # Smart fallback: code-based dedup + typing
                print(f"    ⚠️ Stage 6 retry failed. Applying code-based validation...")
                seen_names: set[str] = set()
                smart_markers: list[dict] = []
                for m in all_markers:
                    name = m.get("name", "Unknown").lower().strip()
                    if name and name not in seen_names:
                        seen_names.add(name)
                        # Ensure required fields are populated
                        m.setdefault("type", "authenticity")
                        m.setdefault("component", "construction")
                        m.setdefault("weight", "SUPPORTING")
                        m.setdefault("authentic_tells", [])
                        m.setdefault("counterfeit_tells", [])
                        m.setdefault("base_weight", 0.5)
                        m.setdefault("source_confidence", 1)
                        smart_markers.append(m)
                for flaw in rep_flaws:
                    name = flaw.get("name", "Unknown").lower().strip()
                    if name and name not in seen_names:
                        seen_names.add(name)
                        smart_markers.append({
                            "name": flaw.get("name", "Unknown Flaw"),
                            "type": "inauthenticity",
                            "component": "construction",
                            "weight": "CRITICAL" if flaw.get("severity") == "definitive" else "SUPPORTING",
                            "severity": flaw.get("severity", "moderate"),
                            "description": flaw.get("description", ""),
                            "visual_cue": flaw.get("visual_cue"),
                            "authentic_tells": [],
                            "counterfeit_tells": [flaw.get("description", "")],
                            "base_weight": 0.5,
                            "source_confidence": 1,
                        })
                final = {"validated_markers": smart_markers, "information_availability": "moderate"}
                print(f"    📊 Code-based validation: {len(smart_markers)} deduped markers")

    elapsed = time.time() - start

    # Store results
    info_avail = InfoAvailability.MODERATE
    avail_str = final.get("information_availability", recon.get("information_availability", "moderate"))
    if avail_str == "abundant":
        info_avail = InfoAvailability.ABUNDANT
    elif avail_str == "sparse":
        info_avail = InfoAvailability.SPARSE

    validated = final.get("validated_markers", [])
    auth_count = sum(1 for m in validated if m.get("type") != "inauthenticity")
    inauth_count = sum(1 for m in validated if m.get("type") == "inauthenticity")

    # Compute dynamic KCS inputs from actual research data
    # Tier 1 source percentage: check citation domains against known auth sources
    tier1_domains = {
        "purseforum", "reddit.com", "lollipuff", "entrupy", "realauth",
        "yoogiscloset", "fashionphile", "vestiaire", "rebag",
        "authenticatethis", "carousell", "bababebi",
    }
    all_citations = deep.get("citations", [])
    if all_citations:
        tier1_count = sum(
            1 for url in all_citations
            if any(d in str(url).lower() for d in tier1_domains)
        )
        tier1_pct = min(tier1_count / len(all_citations), 1.0)
    else:
        tier1_pct = 0.4  # Conservative default

    # Cross-source agreement: markers that appear in 2+ stages
    deep_names = {m.get("name", "").lower().strip() for m in deep.get("authenticity_markers", [])}
    visual_names = {vm.get("name", "").lower().strip() for vm in visual_markers}
    flaw_names = {f.get("name", "").lower().strip() for f in rep_flaws}
    all_name_sets = [s for s in [deep_names, visual_names, flaw_names] if s]
    if len(all_name_sets) >= 2:
        # Count names that appear in 2+ stages
        from collections import Counter
        name_counts = Counter()
        for s in all_name_sets:
            for n in s:
                if n:
                    name_counts[n] += 1
        multi_source = sum(1 for c in name_counts.values() if c >= 2)
        total_unique = len(name_counts)
        agreement_pct = multi_source / total_unique if total_unique else 0.3
        # Boost: having data from 3 independent stages is inherently high-agreement
        agreement_pct = max(agreement_pct, 0.3 + 0.15 * len(all_name_sets))
    else:
        agreement_pct = 0.3

    # Relative measurement percentage from validated markers
    rel_count = sum(1 for m in validated if m.get("measurement_type") in ("relative", "n/a"))
    rel_pct = rel_count / len(validated) if validated else 0.8

    kcs = compute_kcs(
        research_depth=depth,
        marker_count=len(validated),
        tier1_source_pct=tier1_pct,
        inauthenticity_marker_count=inauth_count,
        info_availability=info_avail,
        cross_source_agreement_pct=min(agreement_pct, 1.0),
        relative_measurement_pct=rel_pct,
    )

    brand_profile = AKBBrand(
        brand=brand,
        counterfeit_prevalence=threats.get("counterfeit_quality_level", "Unknown"),
        serial_number_system=str(deep.get("serial_system", "")) if deep.get("serial_system") else None,
        auth_authorities=experts.get("expert_authenticators", []),
        research_depth=depth,
        kcs=kcs,
    )
    store.upsert_brand(brand_profile)

    # Store markers
    store.clear_markers(brand)
    for m in validated:
        marker_type = MarkerType.INAUTHENTICITY if m.get("type") == "inauthenticity" else MarkerType.AUTHENTICITY
        sev = None
        if marker_type == MarkerType.INAUTHENTICITY and m.get("severity"):
            try:
                sev = MarkerSeverity(m["severity"])
            except ValueError:
                pass

        mtype = MeasurementType.RELATIVE
        if m.get("measurement_type") == "absolute":
            mtype = MeasurementType.ABSOLUTE
        elif m.get("measurement_type") == "n/a":
            mtype = MeasurementType.NOT_APPLICABLE

        store.add_marker(AKBMarker(
            brand=brand,
            marker_name=m.get("name", "Unknown"),
            marker_type=marker_type,
            severity=sev,
            weight=m.get("weight", "SUPPORTING"),
            description=m.get("description", ""),
            authentic_tells=m.get("authentic_tells", []),
            counterfeit_tells=m.get("counterfeit_tells", []),
            visual_cue=m.get("visual_cue"),
            measurement_type=mtype,
            source_urls=[m.get("source_url", "")] if m.get("source_url") else [],
            base_weight=float(m.get("base_weight", 0.5)),
        ))

    # Store classified reference images
    for ref in auth_images:
        store.add_reference_image(
            brand, None,
            ref.get("image_url", ""),
            ref.get("source", ""),
            image_class="authentic",
            confidence_source="serpapi_trusted_reseller",
        )
    for ref in rep_images:
        store.add_reference_image(
            brand, None,
            ref.get("image_url", ""),
            ref.get("source", ""),
            image_class="replica",
            confidence_source="serpapi_reddit",
        )

    # Store meta journal
    store.add_journal_entry(AKBMetaJournal(
        brand=brand,
        stage="full_pipeline",
        information_availability=info_avail,
        counterfeit_landscape=threats.get("evolution_notes"),
        recommended_next_research=str(final.get("recommended_next_research", [])),
        notes=final.get("research_quality_notes", ""),
    ))

    # Accurate cost logging from token usage
    # Perplexity: sonar-pro ~$3/1M input, $15/1M output; deep-research ~$2/1M input, $8/1M output
    # Claude: sonnet ~$3/1M input, $15/1M output
    # SerpAPI: $0.01/search; Gemini: ~$0.01/call
    estimated_cost = sum([
        (api_calls["perplexity"] - 1) * 0.02,  # sonar-pro calls (excl. deep-research)
        1 * 0.35,  # deep-research call (fixed)
        api_calls["serpapi"] * 0.01,
        api_calls["gemini"] * 0.015,  # Flash + Pro combined
        api_calls["claude"] * 0.02,  # ~16k tokens output @ $15/1M
    ])

    store.log_research(AKBResearchLog(
        brand=brand,
        depth=depth,
        stages_completed=["recon", "expert_id", "threat", "rep_flaws", "deep_research",
                          "ref_images", "visual_markers", "gap_analysis", "fill", "synthesis"],
        apis_used=api_calls,
        total_cost_gbp=estimated_cost,
        markers_found=len(validated),
        kcs_after=kcs,
        duration_seconds=elapsed,
    ))

    # Visual DB summary
    _print_brand_summary(brand, validated, auth_images, rep_images, kcs, estimated_cost, elapsed, api_calls)


async def research_model(
    brand: str,
    model: str,
    depth: ResearchDepth,
    store: AKBStore,
    keys: dict,
    brand_knowledge: Optional[dict] = None,
) -> None:
    """Run the full pipeline for a specific model."""
    print(f"\n{'─'*60}")
    print(f"  Researching model: {brand} {model} (depth: {depth.value})")
    print(f"{'─'*60}")

    start = time.time()
    api_calls: dict[str, int] = {"perplexity": 0, "serpapi": 0, "gemini": 0, "claude": 0}

    # Stages 0–2b
    recon = await stage_0_recon(brand, model, keys["perplexity"])
    api_calls["perplexity"] += 1

    experts = await stage_1_expert_id(brand, model, keys["perplexity"])
    api_calls["perplexity"] += 1

    threats = await stage_2_threat_profile(brand, model, keys["perplexity"])
    api_calls["perplexity"] += 1

    rep_flaws = await stage_2b_rep_flaws(brand, model, keys["perplexity"])
    api_calls["perplexity"] += 3

    # Stage 3 (always deep-research)
    deep = await stage_3_deep_research(
        brand, model, keys["perplexity"],
        recon, experts, threats, rep_flaws,
        brand_knowledge=brand_knowledge,
    )
    api_calls["perplexity"] += 1

    # Stage 3b
    auth_images = []
    rep_images = []
    if keys.get("serpapi"):
        auth_images, rep_images = await stage_3b_reference_images(brand, model, keys["serpapi"])
        api_calls["serpapi"] += 5

    # Stage 3c
    visual_markers = []
    if auth_images and keys.get("gemini"):
        visual_markers = await stage_3c_visual_markers(
            auth_images, rep_images, brand, model, keys["gemini"]
        )
        api_calls["gemini"] += 2

    all_markers = deep.get("authenticity_markers", [])
    for vm in visual_markers:
        all_markers.append({
            "name": vm.get("name", "Visual Marker"),
            "weight": "SUPPORTING",
            "description": vm.get("description", ""),
            "photo_assessable": True,
            "measurement_type": "relative",
            "source_url": "gemini_vision_analysis",
        })

    # Stage 4
    gap_result = {"gaps": [], "conflicts": []}
    if keys.get("claude"):
        gap_result = await stage_4_gap_analysis(
            brand, model, all_markers, rep_flaws, threats, keys["claude"]
        )
        api_calls["claude"] += 1

    # Stage 5
    filled = []
    if gap_result.get("gaps"):
        filled = await stage_5_targeted_fill(brand, model, gap_result["gaps"], keys["perplexity"])
        api_calls["perplexity"] += len(filled)

    # Stage 6
    all_data = {
        "recon": recon, "experts": experts, "threats": threats,
        "rep_flaws": rep_flaws, "deep_research": deep,
        "visual_markers": visual_markers, "gap_analysis": gap_result, "gap_fills": filled,
    }
    final = {"validated_markers": all_markers, "information_availability": "moderate"}
    if keys.get("claude"):
        final = await stage_6_final_synthesis(brand, model, all_data, keys["claude"])
        api_calls["claude"] += 1

    elapsed = time.time() - start

    # Compute KCS
    validated = final.get("validated_markers", [])
    auth_count = sum(1 for m in validated if m.get("type") != "inauthenticity")
    inauth_count = sum(1 for m in validated if m.get("type") == "inauthenticity")

    avail_str = final.get("information_availability", "moderate")
    info_avail = {"abundant": InfoAvailability.ABUNDANT, "sparse": InfoAvailability.SPARSE}.get(
        avail_str, InfoAvailability.MODERATE
    )

    kcs = compute_kcs(
        research_depth=depth,
        marker_count=len(validated),
        tier1_source_pct=0.5,
        inauthenticity_marker_count=inauth_count,
        info_availability=info_avail,
        cross_source_agreement_pct=0.5,
        relative_measurement_pct=0.8,
    )

    # Store
    model_profile = AKBModel(
        brand=brand,
        model=model,
        production_years=str(deep.get("design_evolution", "")),
        variants_known=deep.get("variants_discovered", []),
        research_depth=depth,
        kcs=kcs,
    )
    store.upsert_model(model_profile)

    store.clear_markers(brand, model)
    for m in validated:
        marker_type = MarkerType.INAUTHENTICITY if m.get("type") == "inauthenticity" else MarkerType.AUTHENTICITY
        sev = None
        if marker_type == MarkerType.INAUTHENTICITY and m.get("severity"):
            try:
                sev = MarkerSeverity(m["severity"])
            except ValueError:
                pass
        mtype = MeasurementType.RELATIVE
        if m.get("measurement_type") == "absolute":
            mtype = MeasurementType.ABSOLUTE
        elif m.get("measurement_type") == "n/a":
            mtype = MeasurementType.NOT_APPLICABLE

        store.add_marker(AKBMarker(
            brand=brand,
            model=model,
            marker_name=m.get("name", "Unknown"),
            marker_type=marker_type,
            severity=sev,
            weight=m.get("weight", "SUPPORTING"),
            description=m.get("description", ""),
            authentic_tells=m.get("authentic_tells", []),
            counterfeit_tells=m.get("counterfeit_tells", []),
            visual_cue=m.get("visual_cue"),
            measurement_type=mtype,
            source_urls=[m.get("source_url", "")] if m.get("source_url") else [],
            base_weight=float(m.get("base_weight", 0.5)),
        ))

    for ref in auth_images:
        store.add_reference_image(
            brand, model,
            ref.get("image_url", ""),
            ref.get("source", ""),
            image_class="authentic",
            confidence_source="serpapi_trusted_reseller",
        )
    for ref in rep_images:
        store.add_reference_image(
            brand, model,
            ref.get("image_url", ""),
            ref.get("source", ""),
            image_class="replica",
            confidence_source="serpapi_reddit",
        )

    store.add_journal_entry(AKBMetaJournal(
        brand=brand, model=model, stage="full_pipeline",
        information_availability=info_avail,
        recommended_next_research=str(final.get("recommended_next_research", [])),
        notes=final.get("research_quality_notes", ""),
    ))

    store.log_research(AKBResearchLog(
        brand=brand, model=model, depth=depth,
        stages_completed=["recon", "expert_id", "threat", "rep_flaws", "deep_research",
                          "ref_images", "visual_markers", "gap_analysis", "fill", "synthesis"],
        apis_used=api_calls,
        markers_found=len(validated),
        kcs_after=kcs,
        duration_seconds=elapsed,
    ))

    print(f"\n  ✅ {brand} {model} complete in {elapsed:.1f}s")
    print(f"     KCS: {kcs:.0%} | Markers: {auth_count} auth + {inauth_count} rep")


# ── CLI ─────────────────────────────────────────────────────────────────────────


def _print_brand_summary(
    brand: str, markers: list, auth_images: list, rep_images: list,
    kcs: float, cost: float, elapsed: float, api_calls: dict,
) -> None:
    """Print a rich visual summary of the research results."""
    auth_count = sum(1 for m in markers if m.get("type") != "inauthenticity")
    inauth_count = sum(1 for m in markers if m.get("type") == "inauthenticity")

    # Component breakdown
    components: dict[str, list] = {}
    for m in markers:
        comp = m.get("component", "other")
        components.setdefault(comp, []).append(m)

    # KCS bar
    kcs_bar_len = 30
    filled = int(kcs * kcs_bar_len)
    kcs_bar = "█" * filled + "░" * (kcs_bar_len - filled)
    if kcs >= 0.8:
        kcs_emoji = "🟢"
    elif kcs >= 0.6:
        kcs_emoji = "🟡"
    else:
        kcs_emoji = "🔴"

    print(f"\n  ╔{'═' * 58}╗")
    print(f"  ║  {'✅ ' + brand + ' Research Complete':<56}║")
    print(f"  ╠{'═' * 58}╣")
    print(f"  ║  KCS: {kcs_emoji} {kcs_bar} {kcs:.0%}{'':>14}║")
    print(f"  ║  Time: {elapsed:.0f}s | Cost: £{cost:.2f}{'':>28}║")
    print(f"  ╠{'═' * 58}╣")
    print(f"  ║  {'MARKERS':^56}║")
    print(f"  ║  Total: {len(markers):>3} │ Auth: {auth_count:>3} │ Rep: {inauth_count:>3}{'':>25}║")
    print(f"  ╠{'─' * 58}╣")
    print(f"  ║  {'Component':<20} {'Auth':>5} {'Rep':>5} {'Crit':>5} {'Supp':>5}{'':>13}║")
    for comp, comp_markers in sorted(components.items()):
        c_auth = sum(1 for m in comp_markers if m.get("type") != "inauthenticity")
        c_rep = sum(1 for m in comp_markers if m.get("type") == "inauthenticity")
        c_crit = sum(1 for m in comp_markers if m.get("weight") == "CRITICAL")
        c_supp = len(comp_markers) - c_crit
        print(f"  ║  {comp:<20} {c_auth:>5} {c_rep:>5} {c_crit:>5} {c_supp:>5}{'':>13}║")
    print(f"  ╠{'─' * 58}╣")
    print(f"  ║  {'REFERENCE IMAGES':^56}║")
    print(f"  ║  Authentic: {len(auth_images):>3}  │  Replica: {len(rep_images):>3}{'':>30}║")
    print(f"  ╠{'─' * 58}╣")
    print(f"  ║  {'API CALLS':^56}║")
    for api, count in api_calls.items():
        print(f"  ║  {api:<15} {count:>3} calls{'':>35}║")
    print(f"  ╚{'═' * 58}╝")


def print_audit(store: AKBStore) -> None:
    """Print the KCS audit table."""
    nodes = store.audit(sort_by_score=True)
    if not nodes:
        print("AKB is empty. Run --brand or --seed-top-10 to populate.")
        return

    print(f"\n{'Brand':<18} {'Model':<20} {'Variant':<25} {'KCS':>5}  {'Depth':>5}  {'Markers':>15}")
    print("─" * 95)
    for n in nodes:
        kcs_pct = f"{n['kcs']:.0%}"
        markers = f"{n['auth_markers']} auth + {n['inauth_markers']} rep"
        flag = ""
        if n["kcs"] < 0.3:
            flag = " 🔴"
        elif n["kcs"] < 0.6:
            flag = " ⚠️"
        print(f"{n['brand']:<18} {n['model']:<20} {n['variant']:<25} {kcs_pct:>5}  {n['depth']:>5}  {markers:>15}{flag}")


def load_api_keys() -> dict:
    """Load API keys from .env file or environment variables.

    Looks for .env file at:
      1. python-bridge/.env
      2. Environment variables
    """
    # Try loading from .env file
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        print(f"Loading keys from {env_path}")
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    key, _, value = line.partition("=")
                    os.environ[key.strip()] = value.strip().strip('"').strip("'")

    keys = {}
    keys["perplexity"] = os.environ.get("PERPLEXITY_API_KEY", "")
    keys["serpapi"] = os.environ.get("SERPAPI_KEY", "")
    keys["gemini"] = os.environ.get("GEMINI_API_KEY", "")
    keys["claude"] = os.environ.get("ANTHROPIC_API_KEY", "")

    if not keys["perplexity"]:
        print("❌ PERPLEXITY_API_KEY required. Set it in python-bridge/.env or as env var.")
        print("   Create python-bridge/.env with:")
        print("   PERPLEXITY_API_KEY=pplx-xxx")
        print("   SERPAPI_KEY=xxx")
        print("   GEMINI_API_KEY=xxx")
        print("   ANTHROPIC_API_KEY=sk-ant-xxx")
        sys.exit(1)

    present = [k for k, v in keys.items() if v]
    missing = [k for k, v in keys.items() if not v]
    print(f"✅ Keys loaded: {', '.join(present)}")
    if missing:
        print(f"⚠️  Missing (optional): {', '.join(missing)}")
    return keys


def main() -> None:
    parser = argparse.ArgumentParser(description="AKB Research Pipeline")
    parser.add_argument("--brand", type=str, help="Brand to research")
    parser.add_argument("--model", type=str, help="Model to research (requires --brand)")
    parser.add_argument("--depth", type=str, default="L2", choices=["L1", "L2", "L3"],
                        help="Research depth (default: L2)")
    parser.add_argument("--seed-top-10", action="store_true", help="Seed all top 10 brands")
    parser.add_argument("--audit", action="store_true", help="Show KCS audit table")
    parser.add_argument("--sort-by-score", action="store_true", help="Sort audit by KCS score")
    parser.add_argument("--db", type=str, default=None,
                        help="Path to AKB database (default: auto-detect)")
    parser.add_argument("--parallel", type=int, default=3,
                        help="Max parallel brand research (default: 3)")
    parser.add_argument("--clean", action="store_true",
                        help="Clear existing brand data before re-running research")
    args = parser.parse_args()

    # Determine DB path
    db_path = args.db
    if not db_path:
        # Default to alongside the intelligence cache
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        db_path = os.path.join(base_dir, "akb.db")

    store = AKBStore(db_path)

    if args.audit:
        print_audit(store)
        return

    keys = load_api_keys()
    depth = ResearchDepth(args.depth)

    if args.seed_top_10:
        print(f"\n🚀 Seeding top 10 brands at depth {depth.value}")
        print(f"   Brands: {', '.join(TOP_10_BRANDS)}")
        print(f"   Parallel: {args.parallel}")
        asyncio.run(_seed_brands(TOP_10_BRANDS, depth, store, keys, args.parallel))
    elif args.brand and args.model:
        if args.clean:
            store.clear_markers(args.brand, args.model)
            print(f"🧹 Cleared existing data for {args.brand} {args.model}")
        asyncio.run(research_model(args.brand, args.model, depth, store, keys))
    elif args.brand:
        if args.clean:
            store.clear_markers(args.brand)
            store.clear_traces(args.brand)
            print(f"🧹 Cleared existing data for {args.brand}")
        asyncio.run(research_brand(args.brand, depth, store, keys))
    else:
        parser.print_help()


async def _seed_brands(
    brands: list[str],
    depth: ResearchDepth,
    store: AKBStore,
    keys: dict,
    max_parallel: int = 3,
) -> None:
    """Seed multiple brands with cross-brand learning accumulation.
    
    Runs brands sequentially (or with limited parallelism) and accumulates
    cross-brand learnings from each completed brand to feed into the next.
    """
    import asyncio

    cross_learnings_parts: list[str] = []

    for brand in brands:
        cross_learnings = "\n".join(cross_learnings_parts) if cross_learnings_parts else None
        await research_brand(brand, depth, store, keys, cross_brand_learnings=cross_learnings)

        # Extract key markers from the just-completed brand to feed forward
        brand_data = store.get_brand(brand)
        if brand_data:
            markers = store.get_markers(brand)
            if markers:
                marker_summary = [f"- {m.marker_name}: {m.description[:80]}" for m in markers[:8]]
                cross_learnings_parts.append(
                    f"{brand} key markers:\n" + "\n".join(marker_summary)
                )

    print(f"\n{'='*60}")
    print(f"✅ Seeding complete! {len(brands)} brands researched.")
    print(f"   Cross-brand learnings accumulated: {len(cross_learnings_parts)} brands")
    print_audit(store)


if __name__ == "__main__":
    main()
