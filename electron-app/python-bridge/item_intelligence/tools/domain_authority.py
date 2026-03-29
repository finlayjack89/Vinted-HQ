"""
Domain authority scoring for authenticity research sources.

Ranks citation URLs by trustworthiness to weight the veto engine's decisions.
"""

from __future__ import annotations

from urllib.parse import urlparse


# ─── Domain Tier Definitions ────────────────────────────────────────────────────

DOMAIN_TIERS: dict[str, dict] = {
    "tier_1": {
        "description": "Gold-standard authentication authorities",
        "trust_score": 1.0,
        "domains": [
            "entrupy.com",
            "realauthentication.com",
            "lollipuff.com",
            "thepursequeen.com",
            "closetfullofcash.com",
            "authenticatethis.com",
        ],
    },
    "tier_2": {
        "description": "Established resale platforms with authentication teams",
        "trust_score": 0.8,
        "domains": [
            "vestiairecollective.com",
            "therealreal.com",
            "rebag.com",
            "fashionphile.com",
            "yoogiscloset.com",
            "truefacet.com",
        ],
    },
    "tier_3": {
        "description": "Expert blogs and community forums",
        "trust_score": 0.6,
        "domains": [
            "purseforum.com",
            "reddit.com",
            "byvanie.co",
            "bagista.co.uk",
            "designerbags.com",
        ],
    },
    "tier_4": {
        "description": "General fashion and luxury media",
        "trust_score": 0.4,
        "domains": [
            "purseblog.com",
            "bagaholicboy.com",
            "buro247.com",
            "vogue.com",
            "harpersbazaar.com",
        ],
    },
}

# Precompute a flat lookup: domain → trust_score
_DOMAIN_LOOKUP: dict[str, float] = {}
for tier_info in DOMAIN_TIERS.values():
    for domain in tier_info["domains"]:
        _DOMAIN_LOOKUP[domain] = tier_info["trust_score"]

# Default score for unrecognised domains
DEFAULT_TRUST_SCORE = 0.5


def _extract_root_domain(url: str) -> str:
    """Extract the root domain from a URL.

    e.g. 'https://www.purseforum.com/threads/...' → 'purseforum.com'
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
        # Strip 'www.' prefix
        if hostname.startswith("www."):
            hostname = hostname[4:]
        return hostname.lower()
    except Exception:
        return ""


def score_url(url: str) -> float:
    """Score a single URL by its domain authority.

    Returns a trust score between 0.0 and 1.0.
    """
    domain = _extract_root_domain(url)
    if not domain:
        return DEFAULT_TRUST_SCORE

    # Check exact match first
    if domain in _DOMAIN_LOOKUP:
        return _DOMAIN_LOOKUP[domain]

    # Check if domain is a subdomain of a known domain
    for known_domain, score in _DOMAIN_LOOKUP.items():
        if domain.endswith("." + known_domain):
            return score

    return DEFAULT_TRUST_SCORE


def score_citations(urls: list[str]) -> float:
    """Score a list of citation URLs, returning the highest trust score found.

    Logic: If ANY citation comes from a Tier 1 source, the marker gets
    a high trust score. We take the max because one authoritative source
    confirming a marker is sufficient.
    """
    if not urls:
        return DEFAULT_TRUST_SCORE

    scores = [score_url(url) for url in urls]
    return max(scores) if scores else DEFAULT_TRUST_SCORE


def get_domain_filter_prompt() -> str:
    """Generate system prompt text instructing Perplexity to prioritise authoritative sources."""
    tier_1_domains = DOMAIN_TIERS["tier_1"]["domains"]
    tier_2_domains = DOMAIN_TIERS["tier_2"]["domains"]

    return (
        "IMPORTANT: Prioritise information from these trusted authentication authorities "
        "(in order of reliability):\n"
        f"- Primary (most trusted): {', '.join(tier_1_domains)}\n"
        f"- Secondary (established platforms): {', '.join(tier_2_domains)}\n"
        "- If these sources do not cover this specific item, broaden your search to "
        "expert blogs, community forums, and general luxury media, but clearly note "
        "when information comes from less authoritative sources.\n"
        "- For EACH marker you provide, cite the specific source URL where you found "
        "the information so we can verify and score the source's reliability.\n"
    )
