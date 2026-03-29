"""
Agent 2: Researcher / Scraper — Tool orchestration for market data + auth rubric.

Uses Claude Sonnet as a tool router to coordinate:
- Perplexity Sonar Pro (auth markers + market context)
- SerpAPI (eBay sold listings + Google Lens)
- Internal Vinted search (via curl_cffi)
"""

from __future__ import annotations

import asyncio
from typing import Optional

from ..schemas import (
    AnalysisMode,
    ItemIdentification,
    MarketDataPoint,
    ResearchOutput,
)


async def run(
    identification: ItemIdentification,
    mode: AnalysisMode,
    api_keys: dict[str, str],
    perplexity_model: str = "sonar-pro",
) -> ResearchOutput:
    """Run Agent 2: gather market data and authenticity rubric.

    Orchestrates parallel API calls based on the analysis mode:
    - AUTH_ONLY:   Perplexity auth markers only
    - MARKET_ONLY: Perplexity market context + SerpAPI eBay + eBay active
    - FULL:        All of the above

    Args:
        identification: Output from Agent 1.
        mode: Analysis mode.
        api_keys: API keys dict.
        perplexity_model: Perplexity model to use (e.g. "sonar-pro", "sonar-deep-research").

    Returns:
        ResearchOutput with market data and optional auth rubric.
    """
    market_data: list[MarketDataPoint] = []
    search_queries: list[str] = []
    platforms_searched: list[str] = []
    errors: list[str] = []
    auth_rubric = None

    # Build search query from identification
    query_parts = [identification.brand]
    if identification.model:
        query_parts.append(identification.model)
    if identification.colorway:
        query_parts.append(identification.colorway)
    if identification.size:
        query_parts.append(identification.size)

    search_query = " ".join(query_parts)
    search_queries.append(search_query)

    # ── Launch tasks based on mode ──────────────────────────────────────────

    tasks: dict[str, asyncio.Task] = {}

    # Auth rubric (auth_only or full)
    if mode in (AnalysisMode.AUTH_ONLY, AnalysisMode.FULL):
        perplexity_key = api_keys.get("perplexity")
        if perplexity_key:
            async def _auth_rubric():
                from ..tools.perplexity import search_auth_markers
                return await search_auth_markers(
                    brand=identification.brand,
                    model=identification.model,
                    api_key=perplexity_key,
                    perplexity_model=perplexity_model,
                )
            tasks["auth_rubric"] = asyncio.create_task(_auth_rubric())

    # Market data (market_only or full)
    if mode in (AnalysisMode.MARKET_ONLY, AnalysisMode.FULL):
        serpapi_key = api_keys.get("serpapi")

        # eBay sold listings
        if serpapi_key:
            async def _ebay_sold():
                from ..tools.serpapi import ebay_sold_search
                return await ebay_sold_search(
                    query=search_query,
                    api_key=serpapi_key,
                )
            tasks["ebay_sold"] = asyncio.create_task(_ebay_sold())

            # eBay active listings
            async def _ebay_active():
                from ..tools.serpapi import ebay_active_search
                return await ebay_active_search(
                    query=search_query,
                    api_key=serpapi_key,
                )
            tasks["ebay_active"] = asyncio.create_task(_ebay_active())

        # Perplexity market context
        perplexity_key = api_keys.get("perplexity")
        if perplexity_key:
            async def _market_context():
                from ..tools.perplexity import search_market_context
                return await search_market_context(
                    brand=identification.brand,
                    model=identification.model,
                    size=identification.size,
                    color=identification.colorway,
                    condition=identification.condition,
                    api_key=perplexity_key,
                )
            tasks["market_context"] = asyncio.create_task(_market_context())

    # ── Gather results ──────────────────────────────────────────────────────

    for task_name, task in tasks.items():
        try:
            # Deep research takes much longer — extend timeout for auth_rubric
            task_timeout = 120.0 if (task_name == "auth_rubric" and "deep" in perplexity_model) else 45.0
            result = await asyncio.wait_for(task, timeout=task_timeout)

            if task_name == "auth_rubric":
                auth_rubric = result

            elif task_name == "ebay_sold":
                market_data.extend(result)
                if result:
                    platforms_searched.append("ebay_sold")

            elif task_name == "ebay_active":
                market_data.extend(result)
                if result:
                    platforms_searched.append("ebay_active")

            elif task_name == "market_context":
                # Market context enriches the data but doesn't produce MarketDataPoints
                # It will be used by Agent 3 for reasoning
                pass

        except asyncio.TimeoutError:
            errors.append(f"{task_name} timed out after 45s")
        except Exception as e:
            errors.append(f"{task_name}: {str(e)}")

    # Deduplicate platforms
    platforms_searched = list(set(platforms_searched))

    return ResearchOutput(
        market_data=market_data,
        authenticity_rubric=auth_rubric,
        search_queries_used=search_queries,
        platforms_searched=platforms_searched,
        errors=errors,
    )
