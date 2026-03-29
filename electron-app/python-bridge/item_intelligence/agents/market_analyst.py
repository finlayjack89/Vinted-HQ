"""
Agent 3: Market Valuation Analyst — Reasoning over cleaned price data.

Uses Claude Sonnet 4.6 to analyze IQR-cleaned price distributions
and produce profit estimates with platform fee calculations.

IMPORTANT: The Python backend runs IQR trimming BEFORE this agent
sees the data. The LLM never processes raw outlier prices.
"""

from __future__ import annotations

import json
from typing import Optional

import httpx

from ..schemas import (
    CleanedPriceData,
    ItemIdentification,
    MarketValuationReport,
    PriceStats,
    ProfitEstimate,
)


ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages"
TIMEOUT = 45.0


# UK platform fee schedules (hardcoded, updated manually)
PLATFORM_FEES = {
    "vinted": {"seller_fee_pct": 5.0, "flat_fee_gbp": 0.0, "shipping_gbp": 2.90},
    "ebay": {"seller_fee_pct": 12.8, "flat_fee_gbp": 0.30, "shipping_gbp": 3.50},
    "vestiaire": {"seller_fee_pct": 15.0, "flat_fee_gbp": 0.0, "shipping_gbp": 0.0},
}


async def run(
    identification: ItemIdentification,
    cleaned_prices: CleanedPriceData,
    listing_price_gbp: float,
    api_keys: dict[str, str],
) -> MarketValuationReport:
    """Run Agent 3: analyze price data and produce valuation.

    Args:
        identification: Item attributes from Agent 1.
        cleaned_prices: IQR-trimmed price data from the pre-processor.
        listing_price_gbp: The target listing's price.
        api_keys: API keys dict (needs 'anthropic').

    Returns:
        MarketValuationReport with profit estimates and market positioning.
    """
    anthropic_key = api_keys.get("anthropic")
    if not anthropic_key:
        raise ValueError("Anthropic API key required for Agent 3")

    # Build the analysis prompt with all price data
    prompt = _build_prompt(identification, cleaned_prices, listing_price_gbp)

    # Call Claude Sonnet
    response = await _call_claude(prompt, anthropic_key)

    # Parse and enrich with deterministic profit calculations
    report = _parse_response(response, identification, cleaned_prices, listing_price_gbp)

    return report


def _build_prompt(
    identification: ItemIdentification,
    prices: CleanedPriceData,
    listing_price: float,
) -> str:
    """Build the valuation analysis prompt."""
    item_desc = f"{identification.brand}"
    if identification.model:
        item_desc += f" {identification.model}"
    if identification.colorway:
        item_desc += f" in {identification.colorway}"
    if identification.size:
        item_desc += f", size {identification.size}"
    if identification.condition:
        item_desc += f" ({identification.condition} condition)"

    # Format price stats
    listed_stats = _format_stats(prices.listed_prices, "Currently Listed")
    sold_stats = _format_stats(prices.sold_prices, "Recently Sold") if prices.sold_prices else "No sold data available."

    platform_breakdown = ""
    for platform, stats in prices.platform_breakdown.items():
        platform_breakdown += f"\n{platform.upper()}: {_format_stats(stats, platform)}"

    return f"""You are a UK fashion resale market analyst. Analyze the following 
price data for a {item_desc} listed at £{listing_price:.2f}.

## Price Data (IQR-cleaned, outliers removed)

### Currently Listed Items:
{listed_stats}

### Recently Sold Items:
{sold_stats}

### Platform Breakdown:
{platform_breakdown if platform_breakdown else "Not available."}

## UK Platform Fee Schedules:
- Vinted: 5% seller fee, ~£2.90 shipping
- eBay: 12.8% + £0.30 per sale, ~£3.50 shipping
- Vestiaire Collective: 15% commission, shipping covered

## Task:
Analyze this data and respond in this exact JSON format:
{{
  "item_summary": "One-line summary of the item",
  "price_position": "Below Market" or "At Market" or "Above Market",
  "price_percentile": 0-100 (where this item sits in the price range),
  "market_velocity": "How fast these items sell",
  "confidence": 0.0 to 1.0,
  "reasoning": "Detailed analysis (2-3 paragraphs)",
  "data_limitations": ["list of caveats"]
}}

Be precise with numbers. Base your analysis solely on the provided data.
If the data is limited, reflect that in a lower confidence score."""


def _format_stats(stats: Optional[PriceStats], label: str) -> str:
    """Format PriceStats as readable text for the LLM."""
    if stats is None or stats.count == 0:
        return f"{label}: No data available."

    return (
        f"{label}: {stats.count} items (originally {stats.original_count}, "
        f"{stats.trimmed_count} outliers removed)\n"
        f"  Range: £{stats.min:.2f} – £{stats.max:.2f}\n"
        f"  P25: £{stats.p25:.2f} | Median: £{stats.median:.2f} | P75: £{stats.p75:.2f}\n"
        f"  Mean: £{stats.mean:.2f} | Std Dev: £{stats.std_dev:.2f}"
    )


async def _call_claude(prompt: str, api_key: str) -> str:
    """Call Claude Sonnet via Anthropic API."""
    payload = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 2048,
        "messages": [
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(ANTHROPIC_API_BASE, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    # Extract text content
    content_blocks = data.get("content", [])
    text_parts = [b.get("text", "") for b in content_blocks if b.get("type") == "text"]
    return "\n".join(text_parts)


def _parse_response(
    response_text: str,
    identification: ItemIdentification,
    prices: CleanedPriceData,
    listing_price: float,
) -> MarketValuationReport:
    """Parse Claude's response and calculate deterministic profit estimates."""
    text = response_text.strip()

    # Strip markdown fences
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        json_start = text.find("{")
        json_end = text.rfind("}") + 1
        data = json.loads(text[json_start:json_end])
    except (json.JSONDecodeError, ValueError):
        data = {}

    # Calculate profit estimates deterministically (NOT by the LLM)
    profit_estimates = _calculate_profits(prices, listing_price)

    return MarketValuationReport(
        item_summary=data.get("item_summary", f"{identification.brand} {identification.model or ''}".strip()),
        price_position=data.get("price_position", "Unknown"),
        price_percentile=data.get("price_percentile"),
        listed_price_stats=prices.listed_prices,
        sold_price_stats=prices.sold_prices,
        profit_estimates=profit_estimates,
        market_velocity=data.get("market_velocity"),
        confidence=float(data.get("confidence", 0.5)),
        reasoning=data.get("reasoning", "Insufficient data for detailed analysis."),
        data_limitations=data.get("data_limitations", []),
    )


def _calculate_profits(prices: CleanedPriceData, purchase_price: float) -> list[ProfitEstimate]:
    """Deterministic profit calculation using median sold/listed prices.

    This is pure Python math — the LLM is NOT involved.
    """
    estimates: list[ProfitEstimate] = []

    # Use sold prices if available, otherwise listed prices
    reference_stats = prices.sold_prices if prices.sold_prices and prices.sold_prices.count > 0 else prices.listed_prices

    if reference_stats.count == 0:
        return estimates

    for platform, fees in PLATFORM_FEES.items():
        sell_price = reference_stats.median
        fee_pct = fees["seller_fee_pct"] / 100
        flat_fee = fees["flat_fee_gbp"]
        shipping = fees["shipping_gbp"]

        total_fees = (sell_price * fee_pct) + flat_fee
        net_revenue = sell_price - total_fees - shipping
        profit = net_revenue - purchase_price
        margin = (profit / sell_price * 100) if sell_price > 0 else 0
        roi = (profit / purchase_price * 100) if purchase_price > 0 else 0

        estimates.append(ProfitEstimate(
            platform=platform,
            sell_price_gbp=round(sell_price, 2),
            fees_gbp=round(total_fees, 2),
            shipping_gbp=shipping,
            net_revenue_gbp=round(net_revenue, 2),
            purchase_price_gbp=round(purchase_price, 2),
            profit_gbp=round(profit, 2),
            profit_margin_pct=round(margin, 1),
            roi_pct=round(roi, 1),
        ))

    return estimates
