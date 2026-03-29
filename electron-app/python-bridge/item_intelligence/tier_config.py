"""
Centralised tier configuration for the Item Intelligence pipeline.

Maps (AnalysisTier, deep_research) → per-agent settings.
"""

from __future__ import annotations

from dataclasses import dataclass

from .schemas import AnalysisTier


@dataclass(frozen=True)
class TierConfig:
    """Immutable configuration derived from the user's tier + deep_research selection."""

    # ── Stage 1: Identifier ──────────────────────────────────────────────
    identifier_model: str
    """Gemini model for item identification."""

    # ── Stage 2: Research ────────────────────────────────────────────────
    num_search_queries: int
    """Number of search query variations to generate."""

    perplexity_model: str
    """Perplexity model for auth rubric generation."""

    domain_ranking: bool
    """Whether to score rubric markers by source domain authority."""

    # ── Stage 4: Auth Vision ─────────────────────────────────────────────
    reference_images: bool
    """Whether to fetch & inject authenticated reference images for visual comparison."""

    cloud_vision_ocr: bool
    """Whether to extract text from listing photos via Google Cloud Vision."""

    multi_model_consensus: bool
    """Whether to run a second model (Claude) for identification cross-validation."""

    # ── Display ──────────────────────────────────────────────────────────
    tier_label: str
    """Human-readable tier name for UI/logs."""

    estimated_cost_gbp: tuple[float, float]
    """Estimated cost range (min, max) in GBP."""

    estimated_time_seconds: tuple[int, int]
    """Estimated time range (min, max) in seconds."""


# ─── Tier Definitions ───────────────────────────────────────────────────────────

_ESSENTIAL = TierConfig(
    identifier_model="gemini-3-flash-preview",
    num_search_queries=3,
    perplexity_model="sonar-pro",      # upgraded by deep_research toggle
    domain_ranking=True,
    reference_images=False,
    cloud_vision_ocr=True,
    multi_model_consensus=False,
    tier_label="Essential",
    estimated_cost_gbp=(0.14, 0.18),
    estimated_time_seconds=(35, 45),
)

_PRO = TierConfig(
    identifier_model="gemini-3.1-pro-preview",
    num_search_queries=7,
    perplexity_model="sonar-pro",      # upgraded by deep_research toggle
    domain_ranking=True,
    reference_images=True,
    cloud_vision_ocr=True,
    multi_model_consensus=False,
    tier_label="Pro",
    estimated_cost_gbp=(0.22, 0.32),
    estimated_time_seconds=(50, 65),
)

_ULTRA = TierConfig(
    identifier_model="gemini-3.1-pro-preview",
    num_search_queries=10,
    perplexity_model="sonar-pro",      # upgraded by deep_research toggle
    domain_ranking=True,
    reference_images=True,
    cloud_vision_ocr=True,
    multi_model_consensus=True,
    tier_label="Ultra",
    estimated_cost_gbp=(0.38, 0.55),
    estimated_time_seconds=(60, 80),
)

_DEEP_RESEARCH_COST_ADDER = (0.15, 0.35)
_DEEP_RESEARCH_TIME_ADDER = (20, 30)


def get_config(tier: AnalysisTier, deep_research: bool = False) -> TierConfig:
    """Build the pipeline configuration from the user's tier + deep_research selection.

    Deep Research is only allowed on Pro and Ultra — silently ignored for Essential.
    """
    base = {
        AnalysisTier.ESSENTIAL: _ESSENTIAL,
        AnalysisTier.PRO: _PRO,
        AnalysisTier.ULTRA: _ULTRA,
    }[tier]

    # Deep research is locked to Pro/Ultra
    effective_deep_research = deep_research and tier in (AnalysisTier.PRO, AnalysisTier.ULTRA)

    if effective_deep_research:
        return TierConfig(
            identifier_model=base.identifier_model,
            num_search_queries=base.num_search_queries,
            perplexity_model="sonar-deep-research",
            domain_ranking=base.domain_ranking,
            reference_images=base.reference_images,
            cloud_vision_ocr=base.cloud_vision_ocr,
            multi_model_consensus=base.multi_model_consensus,
            tier_label=f"{base.tier_label} + Deep Research",
            estimated_cost_gbp=(
                base.estimated_cost_gbp[0] + _DEEP_RESEARCH_COST_ADDER[0],
                base.estimated_cost_gbp[1] + _DEEP_RESEARCH_COST_ADDER[1],
            ),
            estimated_time_seconds=(
                base.estimated_time_seconds[0] + _DEEP_RESEARCH_TIME_ADDER[0],
                base.estimated_time_seconds[1] + _DEEP_RESEARCH_TIME_ADDER[1],
            ),
        )

    return base
