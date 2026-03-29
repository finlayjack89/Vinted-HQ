"""
Async DAG Orchestrator for the Item Intelligence pipeline.

Executes agents in a strict Directed Acyclic Graph:

    Agent 1 (Identifier)
         ↓
    Agent 2 (Researcher)
       ↙   ↘
   Agent 3   Agent 4    (parallel, mode-dependent)
  (Market)  (Auth)
              ↓
         Veto Engine

Yields SSE ProgressEvent objects for real-time UI updates.
"""

from __future__ import annotations

import asyncio
import json
import time
import traceback
import uuid
from typing import AsyncGenerator, Optional

from .schemas import (
    AnalysisMode,
    AnalysisTier,
    AnalyzeRequest,
    IntelligenceReport,
    ProgressEvent,
)
from .tier_config import TierConfig, get_config


class OrchestratorError(Exception):
    """Raised when the orchestrator encounters an unrecoverable error."""
    pass


async def run_analysis(
    request: AnalyzeRequest,
    api_keys: dict[str, str],
    cache_db_path: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Run the full Item Intelligence pipeline as a stream of SSE events.

    Args:
        request: Validated AnalyzeRequest with listing data + mode.
        api_keys: Dict of API key name → value.
        cache_db_path: Path to the SQLite cache database (optional).

    Yields:
        SSE-formatted strings: `data: {json}\n\n`
    """
    report_id = str(uuid.uuid4())
    start_time = time.time()
    models_used: list[str] = []
    errors: list[str] = []

    # ── Resolve tier configuration ──────────────────────────────────────────
    tier_config = get_config(request.tier, request.deep_research)
    print(f"[Intelligence] Tier: {tier_config.tier_label} | Model: {tier_config.identifier_model}")

    # Initialize the report shell
    report = IntelligenceReport(
        report_id=report_id,
        mode=request.mode,
        tier=request.tier,
        deep_research=request.deep_research,
        listing_title=request.listing_title,
        listing_price_gbp=request.listing_price_gbp,
        listing_url=request.listing_url,
        photo_urls=request.photo_urls,
    )

    def _sse_event(event: ProgressEvent) -> str:
        """Format a ProgressEvent as an SSE data line."""
        return f"data: {event.model_dump_json()}\n\n"

    # ── Check required API keys ─────────────────────────────────────────────

    missing_keys: list[str] = []
    if "gemini" not in api_keys:
        missing_keys.append("gemini")
    if request.mode in (AnalysisMode.MARKET_ONLY, AnalysisMode.FULL):
        if "anthropic" not in api_keys:
            missing_keys.append("anthropic")
        if "serpapi" not in api_keys:
            missing_keys.append("serpapi")
    if missing_keys:
        yield _sse_event(ProgressEvent(
            step="preflight",
            status="error",
            message=f"Missing API keys: {', '.join(missing_keys)}. Configure them in Settings → API Keys.",
        ))
        return

    # ── Agent 1: Item Identifier ────────────────────────────────────────────

    yield _sse_event(ProgressEvent(
        step="agent_1",
        status="running",
        message=f"Identifying item ({tier_config.tier_label})...",
        progress_pct=10,
    ))

    try:
        from .agents.identifier import run as run_identifier

        identification = await run_identifier(
            photo_urls=request.photo_urls,
            listing_title=request.listing_title,
            listing_description=request.listing_description,
            brand_hint=request.brand_hint,
            category_hint=request.category_hint,
            condition_hint=request.condition_hint,
            api_keys=api_keys,
            model_override=tier_config.identifier_model,
        )
        report.identification = identification
        models_used.append(tier_config.identifier_model)
        if identification.confidence < 0.6 and "flash" in tier_config.identifier_model:
            models_used.append("gemini-3.1-pro-preview")

        yield _sse_event(ProgressEvent(
            step="agent_1",
            status="complete",
            message=f"Identified: {identification.brand} {identification.model or ''}".strip(),
            progress_pct=25,
            data={"brand": identification.brand, "model": identification.model},
        ))
    except Exception as e:
        error_msg = f"Agent 1 (Identifier) failed: {str(e)}"
        errors.append(error_msg)
        yield _sse_event(ProgressEvent(
            step="agent_1",
            status="error",
            message=error_msg,
            progress_pct=25,
        ))
        # Can't proceed without identification
        report.errors = errors
        report.partial = True
        report.duration_seconds = round(time.time() - start_time, 2)
        yield _sse_event(ProgressEvent(
            step="complete",
            status="error",
            message="Pipeline aborted: item identification failed.",
            data={"report": json.loads(report.model_dump_json())},
        ))
        return

    # ── Cache check ─────────────────────────────────────────────────────────

    cached_research = None
    if cache_db_path and identification.brand:
        try:
            from .cache import IntelligenceCache

            cache = IntelligenceCache(cache_db_path)
            cache_type = "market" if request.mode == AnalysisMode.MARKET_ONLY else "full"
            cached_research = cache.get(
                brand=identification.brand,
                model=identification.model,
                cache_type=cache_type,
            )
            if cached_research:
                yield _sse_event(ProgressEvent(
                    step="cache",
                    status="complete",
                    message="Research data loaded from cache (saving API costs)",
                    progress_pct=30,
                ))
        except Exception:
            pass  # Cache miss is non-fatal

    # ── Agent 2: Researcher / Scraper ───────────────────────────────────────

    if cached_research:
        # Reconstruct ResearchOutput from cached data
        from .schemas import ResearchOutput
        research = ResearchOutput.model_validate(cached_research)
        report.research = research
    else:
        yield _sse_event(ProgressEvent(
            step="agent_2",
            status="running",
            message="Researching market data and authenticity markers...",
            progress_pct=30,
        ))

        try:
            from .agents.researcher import run as run_researcher

            research = await run_researcher(
                identification=identification,
                mode=request.mode,
                api_keys=api_keys,
                perplexity_model=tier_config.perplexity_model,
            )
            report.research = research
            models_used.append("claude-sonnet-4.6")

            yield _sse_event(ProgressEvent(
                step="agent_2",
                status="complete",
                message=f"Found {len(research.market_data)} comparables across {', '.join(research.platforms_searched)}",
                progress_pct=50,
                data={"comps_count": len(research.market_data), "platforms": research.platforms_searched},
            ))

            # Cache the research for future use
            if cache_db_path and identification.brand:
                try:
                    cache = IntelligenceCache(cache_db_path)
                    cache_type = "market" if request.mode == AnalysisMode.MARKET_ONLY else "full"
                    cache.set(
                        brand=identification.brand,
                        model=identification.model,
                        data=research.model_dump(),
                        cache_type=cache_type,
                    )
                except Exception:
                    pass  # Cache write failure is non-fatal

        except Exception as e:
            error_msg = f"Agent 2 (Researcher) failed: {str(e)}"
            errors.append(error_msg)
            yield _sse_event(ProgressEvent(
                step="agent_2",
                status="error",
                message=error_msg,
                progress_pct=50,
            ))
            report.errors = errors
            report.partial = True
            # Continue if we're in auth_only mode — Agent 4 can still run without market data
            if request.mode != AnalysisMode.AUTH_ONLY:
                report.duration_seconds = round(time.time() - start_time, 2)
                yield _sse_event(ProgressEvent(
                    step="complete",
                    status="error",
                    message="Pipeline aborted: research failed.",
                    data={"report": json.loads(report.model_dump_json())},
                ))
                return

    # ── Parallel execution: Agent 3 (Market) ∥ Agent 4 (Auth) ───────────────

    tasks: dict[str, asyncio.Task] = {}

    # Agent 3: Market Valuation (market_only or full)
    if request.mode in (AnalysisMode.MARKET_ONLY, AnalysisMode.FULL) and report.research:
        yield _sse_event(ProgressEvent(
            step="agent_3",
            status="running",
            message="Calculating market valuation and profit estimates...",
            progress_pct=55,
        ))

        async def _run_market():
            from .agents.market_analyst import run as run_market
            from .iqr import clean_price_data

            # IQR pre-processing — deterministic, no LLM
            cleaned = clean_price_data(
                report.research.market_data,
                listing_price_gbp=request.listing_price_gbp,
            )
            return await run_market(
                identification=report.identification,
                cleaned_prices=cleaned,
                listing_price_gbp=request.listing_price_gbp,
                api_keys=api_keys,
            )

        tasks["agent_3"] = asyncio.create_task(_run_market())

    # Agent 4: Authenticity Analyst (auth_only or full)
    if request.mode in (AnalysisMode.AUTH_ONLY, AnalysisMode.FULL):
        rubric = report.research.authenticity_rubric if report.research else None
        if rubric and rubric.markers:

            # ── Pre-Agent 4: Cloud Vision OCR (all tiers) ──────────────────
            ocr_text = None
            if tier_config.cloud_vision_ocr and api_keys.get("gemini"):
                yield _sse_event(ProgressEvent(
                    step="ocr",
                    status="running",
                    message="Extracting text from photos (OCR)...",
                    progress_pct=52,
                ))
                try:
                    from .tools.cloud_vision import extract_text_from_images, format_ocr_for_prompt
                    ocr_results = await extract_text_from_images(
                        photo_urls=request.photo_urls,
                        api_key=api_keys["gemini"],  # Cloud Vision uses same GCP key
                    )
                    ocr_text = format_ocr_for_prompt(ocr_results)
                    yield _sse_event(ProgressEvent(
                        step="ocr",
                        status="complete",
                        message=f"OCR complete — extracted text from {len(ocr_results)} photos",
                        progress_pct=54,
                    ))
                except Exception as e:
                    print(f"[Intelligence] OCR failed (non-fatal): {e}")
                    yield _sse_event(ProgressEvent(
                        step="ocr",
                        status="error",
                        message=f"OCR failed (non-fatal): {str(e)}",
                        progress_pct=54,
                    ))

            # ── Pre-Agent 4: Reference Images (Pro/Ultra only) ─────────────
            reference_images = None
            if tier_config.reference_images and api_keys.get("serpapi"):
                yield _sse_event(ProgressEvent(
                    step="reference",
                    status="running",
                    message="Fetching authenticated reference images...",
                    progress_pct=54,
                ))
                try:
                    from .tools.serpapi import google_lens_reference_images
                    # Search 2-3 listing photos for reference images
                    ref_tasks = [
                        google_lens_reference_images(url, api_keys["serpapi"])
                        for url in request.photo_urls[:3]
                    ]
                    ref_results = await asyncio.gather(*ref_tasks, return_exceptions=True)
                    reference_images = []
                    for result in ref_results:
                        if isinstance(result, list):
                            reference_images.extend(result)
                    # Deduplicate and limit to 5
                    seen_urls = set()
                    unique_refs = []
                    for ref in reference_images:
                        url = ref.get("image_url", "")
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            unique_refs.append(ref)
                    reference_images = unique_refs[:5]
                    yield _sse_event(ProgressEvent(
                        step="reference",
                        status="complete",
                        message=f"Found {len(reference_images)} reference images for comparison",
                        progress_pct=56,
                    ))
                except Exception as e:
                    print(f"[Intelligence] Reference image fetch failed (non-fatal): {e}")
                    reference_images = None
                    yield _sse_event(ProgressEvent(
                        step="reference",
                        status="error",
                        message=f"Reference fetch failed (non-fatal): {str(e)}",
                        progress_pct=56,
                    ))

            yield _sse_event(ProgressEvent(
                step="agent_4",
                status="running",
                message=f"Analyzing {len(request.photo_urls)} photos against {len(rubric.markers)} markers...",
                progress_pct=58,
            ))

            async def _run_auth():
                from .agents.auth_analyst import run as run_auth
                return await run_auth(
                    photo_urls=request.photo_urls,
                    rubric=rubric,
                    api_keys=api_keys,
                    reference_images=reference_images,
                    ocr_text=ocr_text,
                )

            tasks["agent_4"] = asyncio.create_task(_run_auth())
        else:
            yield _sse_event(ProgressEvent(
                step="agent_4",
                status="skipped",
                message="No authenticity rubric available — skipping visual analysis",
                progress_pct=60,
            ))

    # Await parallel tasks
    for task_name, task in tasks.items():
        try:
            result = await asyncio.wait_for(task, timeout=90.0)

            if task_name == "agent_3":
                report.market_valuation = result
                models_used.append("claude-sonnet-4.6")
                yield _sse_event(ProgressEvent(
                    step="agent_3",
                    status="complete",
                    message=f"Valuation complete — {result.price_position}",
                    progress_pct=75,
                    data={"price_position": result.price_position},
                ))

            elif task_name == "agent_4":
                report.authenticity_evaluation = result
                models_used.append("gemini-3.1-pro-preview")
                yield _sse_event(ProgressEvent(
                    step="agent_4",
                    status="complete",
                    message=f"Visual analysis complete — {result.photos_analyzed} photos analyzed",
                    progress_pct=80,
                    data={"photos_analyzed": result.photos_analyzed},
                ))

        except asyncio.TimeoutError:
            error_msg = f"{task_name} timed out after 60s"
            errors.append(error_msg)
            yield _sse_event(ProgressEvent(
                step=task_name,
                status="error",
                message=error_msg,
            ))
        except Exception as e:
            error_msg = f"{task_name} failed: {str(e)}"
            errors.append(error_msg)
            yield _sse_event(ProgressEvent(
                step=task_name,
                status="error",
                message=error_msg,
            ))

    # ── Forensic Veto Engine ────────────────────────────────────────────────

    if report.authenticity_evaluation and report.authenticity_evaluation.evaluations:
        yield _sse_event(ProgressEvent(
            step="veto",
            status="running",
            message="Running deterministic verdict engine...",
            progress_pct=90,
        ))

        from .veto import evaluate

        # Build source trust scores from rubric markers
        source_trust_scores = {}
        if report.research and report.research.authenticity_rubric:
            for marker in report.research.authenticity_rubric.markers:
                source_trust_scores[marker.name] = marker.source_trust_score

        verdict = evaluate(
            report.authenticity_evaluation,
            source_trust_scores=source_trust_scores if source_trust_scores else None,
        )
        report.authenticity_verdict = verdict

        yield _sse_event(ProgressEvent(
            step="veto",
            status="complete",
            message=f"Verdict: {verdict.verdict.value} ({verdict.confidence:.0%} confidence)",
            progress_pct=95,
            data={
                "verdict": verdict.verdict.value,
                "confidence": verdict.confidence,
                "risk_level": verdict.risk_level.value,
            },
        ))

    # ── Finalize Report ─────────────────────────────────────────────────────

    report.models_used = list(set(models_used))
    report.errors = errors
    report.partial = len(errors) > 0
    report.duration_seconds = round(time.time() - start_time, 2)
    report.created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    yield _sse_event(ProgressEvent(
        step="complete",
        status="complete",
        message="Analysis complete",
        progress_pct=100,
        data={"report": json.loads(report.model_dump_json())},
    ))
