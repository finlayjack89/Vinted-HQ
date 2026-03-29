"""
Pydantic v2 schemas for all Item Intelligence agent I/O.

Every agent reads from and writes to these strict schemas.
The orchestrator pipes outputs → inputs through the DAG.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ─── Enums ──────────────────────────────────────────────────────────────────────


class AnalysisMode(str, Enum):
    """Top-level mode selection for the pipeline."""
    AUTH_ONLY = "auth_only"
    MARKET_ONLY = "market_only"
    FULL = "full"


class AnalysisTier(str, Enum):
    """Depth of analysis — controls model selection and tool usage.

    ESSENTIAL: Flash model, 2-3 queries, basic auth + OCR + domain ranking
    PRO: 3.1 Pro model, 5-10 queries, reference images, all Essential features
    ULTRA: All Pro features + multi-model consensus
    """
    ESSENTIAL = "essential"
    PRO = "pro"
    ULTRA = "ultra"


class MarkerWeight(str, Enum):
    """How important an authenticity marker is to the verdict."""
    CRITICAL = "CRITICAL"
    SUPPORTING = "SUPPORTING"


class MarkerResult(str, Enum):
    """Agent 4's evaluation of a single authenticity marker."""
    PASS = "PASS"
    FAIL = "FAIL"
    UNVERIFIABLE = "UNVERIFIABLE"


class AuthVerdict(str, Enum):
    """Final deterministic verdict from the Forensic Veto Engine."""
    AUTHENTIC = "Authentic"
    LIKELY_AUTHENTIC = "Likely Authentic"
    SUSPICIOUS = "Suspicious"
    INDETERMINATE = "Indeterminate"
    COUNTERFEIT = "Counterfeit"


class RiskLevel(str, Enum):
    """Human-readable risk level for the UI."""
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"


# ─── Agent 1 Output: Item Identification ────────────────────────────────────────


class ItemIdentification(BaseModel):
    """Structured attributes extracted by Agent 1 (Gemini Flash/Pro)."""
    brand: str = Field(..., description="Brand name, e.g. 'Gucci'")
    model: Optional[str] = Field(None, description="Model name, e.g. 'Marmont'")
    sub_model: Optional[str] = Field(None, description="Sub-model/variant, e.g. 'Small Matelassé'")
    colorway: Optional[str] = Field(None, description="Primary color(s), e.g. 'Black/Gold'")
    size: Optional[str] = Field(None, description="Size label, e.g. 'Small', 'EU 42', '10 UK'")
    material: Optional[str] = Field(None, description="Primary material, e.g. 'Leather', 'Canvas'")
    condition: Optional[str] = Field(None, description="Assessed condition, e.g. 'Good', 'New with tags'")
    category: Optional[str] = Field(None, description="Category, e.g. 'Bags', 'Shoes', 'Jackets'")
    gender: Optional[str] = Field(None, description="Target gender, e.g. 'Women', 'Men', 'Unisex'")
    retail_price_estimate_gbp: Optional[float] = Field(None, description="Estimated original retail price in GBP")
    year_or_season: Optional[str] = Field(None, description="Year/season if identifiable, e.g. '2023 SS'")
    confidence: float = Field(..., ge=0, le=1, description="Overall identification confidence (0-1)")
    reasoning: str = Field(..., description="How the identification was reached")
    google_lens_hints: list[str] = Field(default_factory=list, description="Top text matches from Google Lens")


# ─── Agent 2 Output: Market Data & Authenticity Rubric ──────────────────────────


class MarketDataPoint(BaseModel):
    """A single comparable listing or sold item from any platform."""
    platform: str = Field(..., description="Source platform: 'ebay', 'vinted', 'vestiaire'")
    title: str = Field(..., description="Listing title")
    price: float = Field(..., description="Price in GBP")
    currency: str = Field(default="GBP")
    condition: Optional[str] = Field(None, description="Condition as listed")
    sold: bool = Field(default=False, description="Whether this item has sold")
    sold_date: Optional[str] = Field(None, description="ISO date when sold, if known")
    url: Optional[str] = Field(None, description="Direct URL to listing")
    image_url: Optional[str] = Field(None, description="Primary image URL")


class AuthenticityMarkerDefinition(BaseModel):
    """A single authenticity marker from Perplexity research (Agent 2 output).

    This is the RUBRIC — what to look for. Agent 4 then evaluates each
    marker against the actual item images.
    """
    name: str = Field(..., description="Marker name, e.g. 'Stitching Pattern'")
    weight: MarkerWeight = Field(..., description="CRITICAL or SUPPORTING")
    description: str = Field(..., description="What to look for")
    authentic_tells: list[str] = Field(default_factory=list, description="Signs of authenticity")
    counterfeit_tells: list[str] = Field(default_factory=list, description="Signs of counterfeit")
    source_url: Optional[str] = Field(None, description="Citation URL from Perplexity")
    source_trust_score: float = Field(
        default=0.5, ge=0, le=1,
        description="Trust score based on domain authority of the source (0-1). "
                    "Tier 1 (entrupy.com etc) = 1.0, Tier 4 (generic media) = 0.4"
    )


class AuthenticityRubric(BaseModel):
    """Complete authenticity rubric assembled by Agent 2."""
    brand: str
    model: Optional[str] = None
    markers: list[AuthenticityMarkerDefinition] = Field(default_factory=list)
    general_notes: Optional[str] = Field(None, description="General auth notes from research")
    source_urls: list[str] = Field(default_factory=list, description="All cited URLs")


class ResearchOutput(BaseModel):
    """Complete output from Agent 2 (Researcher/Scraper)."""
    market_data: list[MarketDataPoint] = Field(default_factory=list)
    authenticity_rubric: Optional[AuthenticityRubric] = None
    search_queries_used: list[str] = Field(default_factory=list)
    platforms_searched: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list, description="Non-fatal errors during research")


# ─── IQR Pre-Processor Output ──────────────────────────────────────────────────


class PriceStats(BaseModel):
    """Statistical summary of price data after IQR outlier trimming."""
    count: int = Field(..., description="Number of data points after trimming")
    original_count: int = Field(..., description="Number of data points before trimming")
    min: float
    p25: float = Field(..., description="25th percentile")
    median: float
    p75: float = Field(..., description="75th percentile")
    max: float
    mean: float
    std_dev: float = Field(default=0.0, description="Standard deviation")
    trimmed_count: int = Field(default=0, description="Number of outliers removed")


class CleanedPriceData(BaseModel):
    """IQR-cleaned price data passed to Agent 3."""
    listed_prices: PriceStats = Field(..., description="Stats for currently-listed items")
    sold_prices: Optional[PriceStats] = Field(None, description="Stats for sold items (stronger signal)")
    all_data_points: list[MarketDataPoint] = Field(default_factory=list, description="Cleaned data points")
    platform_breakdown: dict[str, PriceStats] = Field(
        default_factory=dict,
        description="Per-platform price stats, e.g. {'ebay': ..., 'vinted': ...}"
    )


# ─── Agent 3 Output: Market Valuation ──────────────────────────────────────────


class PlatformFees(BaseModel):
    """Fee schedule for a selling platform."""
    platform: str
    seller_fee_pct: float = Field(..., description="Seller fee as percentage, e.g. 5.0 for 5%")
    flat_fee_gbp: float = Field(default=0.0, description="Flat fee per sale in GBP")
    estimated_shipping_gbp: float = Field(default=0.0, description="Estimated shipping cost")


class ProfitEstimate(BaseModel):
    """Profit calculation for a specific selling scenario."""
    platform: str
    sell_price_gbp: float = Field(..., description="Expected sell price")
    fees_gbp: float = Field(..., description="Total platform fees")
    shipping_gbp: float = Field(..., description="Estimated shipping cost")
    net_revenue_gbp: float = Field(..., description="Revenue after fees + shipping")
    purchase_price_gbp: float = Field(..., description="What the user would pay for this item")
    profit_gbp: float = Field(..., description="Net profit in GBP")
    profit_margin_pct: float = Field(..., description="Profit margin as percentage")
    roi_pct: float = Field(..., description="Return on investment as percentage")


class VariantComparison(BaseModel):
    """How this specific item variant compares to other versions."""
    variant_description: str = Field(..., description="e.g. 'This is the Small size in Black'")
    price_premium_or_discount: Optional[str] = Field(
        None, description="e.g. 'Black commands a 15% premium over other colors'"
    )
    demand_assessment: Optional[str] = Field(
        None, description="e.g. 'High demand — sells within 7 days on average'"
    )


class MarketValuationReport(BaseModel):
    """Complete output from Agent 3 (Market Analyst)."""
    item_summary: str = Field(..., description="One-line summary of the item being valued")
    price_position: str = Field(
        ..., description="Where this item sits: 'Below Market', 'At Market', 'Above Market'"
    )
    price_percentile: Optional[float] = Field(
        None, ge=0, le=100, description="Percentile within the market (0-100)"
    )
    listed_price_stats: PriceStats = Field(..., description="Stats from currently listed comparables")
    sold_price_stats: Optional[PriceStats] = Field(None, description="Stats from sold comparables")
    profit_estimates: list[ProfitEstimate] = Field(default_factory=list)
    variant_comparison: Optional[VariantComparison] = None
    market_velocity: Optional[str] = Field(
        None, description="How fast items sell, e.g. 'Avg 5-10 days on eBay'"
    )
    confidence: float = Field(..., ge=0, le=1, description="Valuation confidence (0-1)")
    reasoning: str = Field(..., description="Detailed reasoning for the valuation")
    data_limitations: list[str] = Field(
        default_factory=list,
        description="Caveats about the data, e.g. 'Only 3 sold comps found'"
    )


# ─── Agent 4 Output: Authenticity Evaluation ────────────────────────────────────


class AuthenticityMarkerEvaluation(BaseModel):
    """Agent 4's evaluation of a SINGLE marker from the rubric against actual images."""
    marker_name: str = Field(..., description="Matches AuthenticityMarkerDefinition.name")
    weight: MarkerWeight
    result: MarkerResult = Field(..., description="PASS, FAIL, or UNVERIFIABLE")
    observation: str = Field(..., description="What Agent 4 observed in the images")
    vision_confidence: float = Field(
        ..., ge=0, le=1, description="How confident the vision model is in this assessment"
    )
    image_index: Optional[int] = Field(
        None, description="Which image (0-indexed) was most relevant for this check"
    )


class AuthenticityEvaluationOutput(BaseModel):
    """Complete output from Agent 4 — fed into the Forensic Veto Engine."""
    evaluations: list[AuthenticityMarkerEvaluation] = Field(default_factory=list)
    general_observations: list[str] = Field(
        default_factory=list,
        description="Broader observations not tied to specific markers"
    )
    photos_analyzed: int = Field(default=0, description="Number of photos analyzed")
    model_used: str = Field(default="gemini-3.1-pro-preview", description="Vision model that performed the analysis")
    reference_images_used: int = Field(default=0, description="Number of authenticated reference images used for comparison")
    ocr_text_extracted: list[str] = Field(
        default_factory=list,
        description="Text extracted from photos via Cloud Vision OCR (serial numbers, labels, etc.)"
    )


# ─── Forensic Veto Engine Output ───────────────────────────────────────────────


class AuthenticityVerdict(BaseModel):
    """Deterministic verdict from the Forensic Veto Engine (veto.py).

    This is NOT produced by an LLM — it's calculated by Python code
    from Agent 4's AuthenticityMarkerEvaluation array.
    """
    verdict: AuthVerdict
    confidence: float = Field(..., ge=0, le=1)
    risk_level: RiskLevel
    veto_triggered: bool = False
    ceiling_applied: bool = False
    contested_applied: bool = False
    critical_markers_summary: list[dict] = Field(
        default_factory=list,
        description="Summary of CRITICAL marker results"
    )
    supporting_markers_summary: list[dict] = Field(
        default_factory=list,
        description="Summary of SUPPORTING marker results"
    )
    veto_triggered: bool = Field(
        default=False, description="Whether the veto rule was triggered (CRITICAL FAIL)"
    )
    ceiling_applied: bool = Field(
        default=False, description="Whether confidence was capped due to UNVERIFIABLE critical markers"
    )
    reasoning: str = Field(..., description="Step-by-step explanation of how the verdict was reached")
    red_flags: list[str] = Field(default_factory=list, description="Specific concerns found")
    positive_indicators: list[str] = Field(default_factory=list, description="Positive authenticity signs")
    limitations: list[str] = Field(
        default_factory=list,
        description="What couldn't be verified and why"
    )


# ─── Top-Level Intelligence Report ─────────────────────────────────────────────


class IntelligenceReport(BaseModel):
    """Complete output from the entire Item Intelligence pipeline.

    Stored in SQLite and rendered in the React UI.
    """
    # Metadata
    report_id: Optional[str] = Field(None, description="UUID for this report")
    mode: AnalysisMode
    tier: AnalysisTier = Field(default=AnalysisTier.ESSENTIAL, description="Analysis depth tier")
    deep_research: bool = Field(default=False, description="Whether sonar-deep-research was used")
    created_at: Optional[str] = Field(None, description="ISO timestamp")
    duration_seconds: Optional[float] = Field(None, description="Total pipeline wall-clock time")
    models_used: list[str] = Field(default_factory=list, description="LLM models invoked")
    total_cost_usd: Optional[float] = Field(None, description="Estimated total API cost")

    # Item info (input)
    listing_title: Optional[str] = None
    listing_price_gbp: Optional[float] = None
    listing_url: Optional[str] = None
    photo_urls: list[str] = Field(default_factory=list)

    # Agent outputs
    identification: Optional[ItemIdentification] = None
    research: Optional[ResearchOutput] = None
    market_valuation: Optional[MarketValuationReport] = None
    authenticity_evaluation: Optional[AuthenticityEvaluationOutput] = None
    authenticity_verdict: Optional[AuthenticityVerdict] = None

    # Errors
    errors: list[str] = Field(default_factory=list, description="Pipeline-level errors")
    partial: bool = Field(default=False, description="True if pipeline completed with partial results")


# ─── SSE Progress Events ───────────────────────────────────────────────────────


class ProgressEvent(BaseModel):
    """SSE event yielded during pipeline execution."""
    step: str = Field(..., description="Agent identifier: 'agent_1', 'agent_2', 'agent_3', 'agent_4', 'veto'")
    status: str = Field(..., description="'pending', 'running', 'complete', 'error', 'skipped'")
    message: str = Field(default="", description="Human-readable status message")
    progress_pct: Optional[float] = Field(None, ge=0, le=100, description="Completion percentage")
    data: Optional[dict] = Field(None, description="Partial data payload for progressive rendering")


# ─── API Request Schema ────────────────────────────────────────────────────────


class AnalyzeRequest(BaseModel):
    """Request body for POST /intelligence/analyze."""
    mode: AnalysisMode = Field(..., description="Analysis mode")
    tier: AnalysisTier = Field(default=AnalysisTier.ESSENTIAL, description="Analysis depth tier")
    deep_research: bool = Field(default=False, description="Enable sonar-deep-research for exhaustive auth rubric")
    listing_title: str = Field(..., description="Vinted listing title")
    listing_description: Optional[str] = Field(None, description="Listing description text")
    listing_price_gbp: float = Field(..., description="Listing price in GBP")
    listing_url: Optional[str] = Field(None, description="Vinted listing URL")
    photo_urls: list[str] = Field(..., min_length=1, description="Photo URLs (at least 1)")
    brand_hint: Optional[str] = Field(None, description="Pre-filled brand from Vinted metadata")
    category_hint: Optional[str] = Field(None, description="Pre-filled category from Vinted metadata")
    condition_hint: Optional[str] = Field(None, description="Pre-filled condition from Vinted metadata")
