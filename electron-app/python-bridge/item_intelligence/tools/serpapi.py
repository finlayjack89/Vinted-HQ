"""
SerpAPI tool client — Google Lens visual search + eBay UK sold listings.

Uses httpx async client to call SerpAPI endpoints.
"""

from __future__ import annotations

from typing import Optional

import httpx

from ..schemas import MarketDataPoint


SERPAPI_BASE = "https://serpapi.com/search.json"
TIMEOUT = 30.0


async def google_lens_search(
    image_url: str,
    api_key: str,
) -> list[str]:
    """Search Google Lens for visual matches of an item image.

    Args:
        image_url: Public URL of the product image.
        api_key: SerpAPI API key.

    Returns:
        Top 3 text match descriptions from visual search.
    """
    params = {
        "engine": "google_lens",
        "url": image_url,
        "api_key": api_key,
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(SERPAPI_BASE, params=params)
        resp.raise_for_status()
        data = resp.json()

    # Extract visual matches — SerpAPI returns them under "visual_matches"
    visual_matches = data.get("visual_matches", [])
    hints: list[str] = []
    for match in visual_matches[:5]:
        title = match.get("title", "")
        source = match.get("source", "")
        if title:
            hint = title
            if source:
                hint += f" ({source})"
            hints.append(hint)

    return hints[:3]


async def google_lens_reference_images(
    image_url: str,
    api_key: str,
    max_results: int = 5,
) -> list[dict]:
    """Search Google Lens for reference images of authenticated items.

    Used by Stage 4 (Pro/Ultra tiers) to fetch confirmed authentic images
    for side-by-side visual comparison with listing photos.

    Args:
        image_url: Public URL of the listing photo to reverse-search.
        api_key: SerpAPI API key.
        max_results: Maximum number of reference images to return.

    Returns:
        List of dicts: [
            {
                "image_url": "https://...",
                "title": "Chanel Wild Stitch Boston Bag",
                "source": "therealreal.com",
                "source_domain": "therealreal.com",
            }
        ]
    """
    params = {
        "engine": "google_lens",
        "url": image_url,
        "api_key": api_key,
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(SERPAPI_BASE, params=params)
        resp.raise_for_status()
        data = resp.json()

    # Extract visual matches with image URLs
    visual_matches = data.get("visual_matches", [])
    reference_images: list[dict] = []

    # Trusted domains for reference images (authenticated sources)
    trusted_domains = {
        "therealreal.com", "vestiairecollective.com", "fashionphile.com",
        "rebag.com", "yoogiscloset.com", "entrupy.com",
        "realauthentication.com", "lollipuff.com",
    }

    for match in visual_matches:
        link = match.get("link", "")
        thumbnail = match.get("thumbnail", "")
        title = match.get("title", "")
        source = match.get("source", "")

        # Get image URL (prefer full-size link, fall back to thumbnail)
        img_url = thumbnail  # Google Lens always provides thumbnails

        if img_url and title:
            from urllib.parse import urlparse
            source_domain = ""
            try:
                parsed = urlparse(link or "")
                source_domain = (parsed.hostname or "").replace("www.", "")
            except Exception:
                pass

            reference_images.append({
                "image_url": img_url,
                "title": title,
                "source": source,
                "source_domain": source_domain,
                "is_trusted": source_domain in trusted_domains,
            })

    # Sort: trusted sources first, then by position
    reference_images.sort(key=lambda x: (not x.get("is_trusted", False),))

    return reference_images[:max_results]



async def ebay_sold_search(
    query: str,
    api_key: str,
    country: str = "gb",
    max_results: int = 30,
) -> list[MarketDataPoint]:
    """Search eBay UK for sold/completed listings via SerpAPI.

    Uses `LH_Sold=1&LH_Complete=1` to filter for sold items only.

    Args:
        query: Search query (e.g. "Gucci Marmont Small Black Leather").
        api_key: SerpAPI API key.
        country: Country code for eBay domain.
        max_results: Maximum results to return.

    Returns:
        List of MarketDataPoint objects for sold items.
    """
    # Map country codes to eBay domain IDs
    ebay_domains = {
        "gb": "ebay.co.uk",
        "us": "ebay.com",
        "de": "ebay.de",
        "fr": "ebay.fr",
    }
    domain = ebay_domains.get(country, "ebay.co.uk")

    params = {
        "engine": "ebay",
        "ebay_domain": domain,
        "_nkw": query,
        "LH_Sold": "1",
        "LH_Complete": "1",
        "LH_PrefLoc": "1",  # UK only
        "_sop": "13",  # Sort by price + shipping: lowest first
        "api_key": api_key,
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(SERPAPI_BASE, params=params)
        resp.raise_for_status()
        data = resp.json()

    results: list[MarketDataPoint] = []
    organic = data.get("organic_results", [])

    for item in organic[:max_results]:
        price_raw = item.get("price", {})
        # Handle SerpAPI price formats
        if isinstance(price_raw, dict):
            price_str = price_raw.get("raw", price_raw.get("extracted", "0"))
        elif isinstance(price_raw, (int, float)):
            price_str = str(price_raw)
        else:
            price_str = str(price_raw)

        # Parse GBP price
        price = _parse_gbp_price(price_str)
        if price is None or price <= 0:
            continue

        results.append(MarketDataPoint(
            platform="ebay",
            title=item.get("title", "Unknown"),
            price=price,
            currency="GBP",
            condition=item.get("condition", None),
            sold=True,
            sold_date=item.get("sold_date", None),
            url=item.get("link", None),
            image_url=item.get("thumbnail", None),
        ))

    return results


async def ebay_active_search(
    query: str,
    api_key: str,
    country: str = "gb",
    max_results: int = 20,
) -> list[MarketDataPoint]:
    """Search eBay UK for currently active listings via SerpAPI.

    Args:
        query: Search query.
        api_key: SerpAPI API key.

    Returns:
        List of MarketDataPoint objects for active listings.
    """
    ebay_domains = {"gb": "ebay.co.uk", "us": "ebay.com"}
    domain = ebay_domains.get(country, "ebay.co.uk")

    params = {
        "engine": "ebay",
        "ebay_domain": domain,
        "_nkw": query,
        "LH_PrefLoc": "1",
        "api_key": api_key,
    }

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(SERPAPI_BASE, params=params)
        resp.raise_for_status()
        data = resp.json()

    results: list[MarketDataPoint] = []
    for item in data.get("organic_results", [])[:max_results]:
        price_raw = item.get("price", {})
        if isinstance(price_raw, dict):
            price_str = price_raw.get("raw", price_raw.get("extracted", "0"))
        elif isinstance(price_raw, (int, float)):
            price_str = str(price_raw)
        else:
            price_str = str(price_raw)

        price = _parse_gbp_price(price_str)
        if price is None or price <= 0:
            continue

        results.append(MarketDataPoint(
            platform="ebay",
            title=item.get("title", "Unknown"),
            price=price,
            currency="GBP",
            condition=item.get("condition", None),
            sold=False,
            url=item.get("link", None),
            image_url=item.get("thumbnail", None),
        ))

    return results


def _parse_gbp_price(price_str: str) -> Optional[float]:
    """Parse a price string like '£143.65' or '143.65 GBP' into a float."""
    if not price_str:
        return None
    # Remove currency symbols and whitespace
    cleaned = price_str.replace("£", "").replace("GBP", "").replace(",", "").strip()
    # Handle ranges like "£50.00 to £100.00" — take the midpoint
    if " to " in cleaned:
        parts = cleaned.split(" to ")
        try:
            low = float(parts[0].strip())
            high = float(parts[1].strip())
            return round((low + high) / 2, 2)
        except (ValueError, IndexError):
            pass
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None
