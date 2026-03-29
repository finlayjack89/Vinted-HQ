"""
IQR-based outlier trimming for price data.

Runs BEFORE Agent 3 sees the data — deterministic Python,
no LLM involved. Removes extreme outliers so the LLM
reasons over clean, representative price distributions.
"""

from __future__ import annotations

import math
from typing import Optional

from .schemas import CleanedPriceData, MarketDataPoint, PriceStats


def _compute_stats(prices: list[float]) -> Optional[PriceStats]:
    """Compute statistical summary for a list of prices.

    Returns None if fewer than 2 data points remain after trimming.
    """
    if len(prices) < 2:
        if len(prices) == 1:
            return PriceStats(
                count=1,
                original_count=1,
                min=prices[0],
                p25=prices[0],
                median=prices[0],
                p75=prices[0],
                max=prices[0],
                mean=prices[0],
                std_dev=0.0,
                trimmed_count=0,
            )
        return None

    sorted_prices = sorted(prices)
    n = len(sorted_prices)

    # Percentile calculation (linear interpolation)
    def percentile(data: list[float], p: float) -> float:
        k = (len(data) - 1) * (p / 100)
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return data[int(k)]
        return data[f] * (c - k) + data[c] * (k - f)

    mean = sum(sorted_prices) / n
    variance = sum((x - mean) ** 2 for x in sorted_prices) / n
    std_dev = math.sqrt(variance)

    return PriceStats(
        count=n,
        original_count=n,  # Will be updated by caller
        min=sorted_prices[0],
        p25=percentile(sorted_prices, 25),
        median=percentile(sorted_prices, 50),
        p75=percentile(sorted_prices, 75),
        max=sorted_prices[-1],
        mean=round(mean, 2),
        std_dev=round(std_dev, 2),
        trimmed_count=0,  # Will be updated by caller
    )


def trim_iqr(
    prices: list[float],
    trim_pct: float = 0.10,
) -> tuple[list[float], int]:
    """Remove top and bottom `trim_pct` of prices using IQR method.

    Args:
        prices: Raw price list.
        trim_pct: Fraction to trim from each end (default 10%).

    Returns:
        (trimmed_prices, num_removed)
    """
    if len(prices) < 4:
        return prices, 0  # Not enough data to trim meaningfully

    sorted_prices = sorted(prices)
    n = len(sorted_prices)

    # Calculate IQR bounds
    q1_idx = int(n * 0.25)
    q3_idx = int(n * 0.75)
    q1 = sorted_prices[q1_idx]
    q3 = sorted_prices[q3_idx]
    iqr = q3 - q1

    # Fences: 1.5x IQR beyond Q1/Q3 (standard Tukey fence)
    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr

    # Also apply percentage-based trimming as a secondary filter
    trim_lower = int(n * trim_pct)
    trim_upper = n - int(n * trim_pct)

    # Use the more conservative of the two methods
    trimmed = [
        p for i, p in enumerate(sorted_prices)
        if lower_fence <= p <= upper_fence and trim_lower <= i < trim_upper
    ]

    # If trimming removed too much data, fall back to just IQR
    if len(trimmed) < max(3, n // 3):
        trimmed = [p for p in sorted_prices if lower_fence <= p <= upper_fence]

    # If STILL too aggressive, just return original
    if len(trimmed) < 2:
        return prices, 0

    return trimmed, n - len(trimmed)


def clean_price_data(
    data_points: list[MarketDataPoint],
    listing_price_gbp: Optional[float] = None,
) -> CleanedPriceData:
    """Clean and organize market data for Agent 3.

    1. Separates listed vs. sold items
    2. Applies IQR trimming to both sets
    3. Computes per-platform breakdowns
    4. Returns structured CleanedPriceData

    Args:
        data_points: Raw market data from Agent 2.
        listing_price_gbp: The target item's listed price (for context).

    Returns:
        CleanedPriceData with stats and cleaned data points.
    """
    # Separate listed vs sold
    listed_prices = [dp.price for dp in data_points if not dp.sold]
    sold_prices = [dp.price for dp in data_points if dp.sold]

    # Trim outliers
    listed_trimmed, listed_removed = trim_iqr(listed_prices)
    sold_trimmed, sold_removed = trim_iqr(sold_prices)

    # Compute stats
    listed_stats = _compute_stats(listed_trimmed)
    sold_stats = _compute_stats(sold_trimmed)

    # Fallback: if we have no listed data but have sold data, use sold as primary
    if listed_stats is None and sold_stats is not None:
        listed_stats = sold_stats

    # If we have literally nothing, create a minimal stats object
    if listed_stats is None:
        listed_stats = PriceStats(
            count=0, original_count=0,
            min=0, p25=0, median=0, p75=0, max=0, mean=0, std_dev=0,
            trimmed_count=0,
        )

    # Update original counts and trimmed counts
    listed_stats.original_count = len(listed_prices)
    listed_stats.trimmed_count = listed_removed
    if sold_stats:
        sold_stats.original_count = len(sold_prices)
        sold_stats.trimmed_count = sold_removed

    # Per-platform breakdown
    platform_breakdown: dict[str, PriceStats] = {}
    platforms = set(dp.platform for dp in data_points)
    for platform in platforms:
        platform_prices = [dp.price for dp in data_points if dp.platform == platform]
        trimmed, removed = trim_iqr(platform_prices)
        stats = _compute_stats(trimmed)
        if stats:
            stats.original_count = len(platform_prices)
            stats.trimmed_count = removed
            platform_breakdown[platform] = stats

    # Build cleaned data points (keep only non-outlier items)
    all_valid_prices = set(listed_trimmed + sold_trimmed)
    cleaned_points = [
        dp for dp in data_points
        if dp.price in all_valid_prices
    ]

    return CleanedPriceData(
        listed_prices=listed_stats,
        sold_prices=sold_stats,
        all_data_points=cleaned_points,
        platform_breakdown=platform_breakdown,
    )
