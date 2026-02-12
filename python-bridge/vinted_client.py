"""
Vinted UK Sniper — Stealth HTTP client using curl_cffi.
Bypasses Cloudflare/Datadome via TLS fingerprint impersonation.
"""

import random
import time
from urllib.parse import urlencode, urlparse, parse_qs

from curl_cffi import requests

# Impersonate Chrome for JA3/JA4 fingerprint (chrome = latest available)
IMPOSTOR = "chrome110"  # Stable; alternatives: "chrome", "chrome131"

BASE_URL = "https://www.vinted.co.uk"


class VintedError(Exception):
    """Structured error for Electron consumption."""

    def __init__(self, code: str, message: str, status_code: int | None = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _parse_catalog_url(url: str) -> dict:
    """Extract search params from a Vinted catalog URL."""
    parsed = urlparse(url)
    if "vinted.co.uk" not in parsed.netloc:
        raise VintedError("INVALID_URL", f"Not a Vinted catalog URL: {url}")
    query = parse_qs(parsed.query)
    return {
        "search_text": query.get("search_text", [""])[0],
        "search_id": query.get("search_id", [None])[0],
        "order": query.get("order", ["newest_first"])[0],
        "page": int(query.get("page", ["1"])[0]),
        "per_page": int(query.get("per_page", ["96"])[0]),
    }


def _build_search_params(params: dict) -> dict:
    """Build query params for catalog/items endpoint."""
    out = {
        "page": params.get("page", 1),
        "per_page": params.get("per_page", 96),
        "order": params.get("order", "newest_first"),
    }
    if params.get("search_text"):
        out["search_text"] = params["search_text"]
    if params.get("search_id"):
        out["search_id"] = params["search_id"]
    return out


def _build_headers(cookie: str, referer: str | None = None) -> dict:
    """Build request headers matching browser fingerprint."""
    headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-GB,en;q=0.9",
        "Origin": BASE_URL,
        "Referer": referer or f"{BASE_URL}/catalog",
    }
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _extract_csrf_from_cookie(cookie: str) -> str | None:
    """Extract x-csrf-token from cookie string if present (Vinted may send it in Set-Cookie)."""
    # Vinted often expects x-csrf-token in headers; it may be in a cookie or set by JS.
    # For now we rely on cookie bundle; add explicit csrf header if needed.
    return None


def search(
    url: str,
    cookie: str,
    proxy: str | None = None,
    page: int = 1,
) -> dict:
    """
    Fetch catalog items from a Vinted search/catalog URL.
    Uses /api/v2/catalog/items with params parsed from URL.
    """
    params = _parse_catalog_url(url)
    params["page"] = page
    qs = urlencode(_build_search_params(params))
    api_url = f"{BASE_URL}/api/v2/catalog/items?{qs}"
    referer = url if url.startswith("http") else f"{BASE_URL}/catalog"

    session = requests.Session(impersonate=IMPOSTOR)
    req_kwargs: dict = {
        "url": api_url,
        "headers": _build_headers(cookie, referer),
        "timeout": 30,
    }
    if proxy:
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        msg = str(e)
        if "cloudflare" in msg.lower() or "cf-" in msg.lower():
            raise VintedError("CF_CHALLENGE", f"Cloudflare challenge: {msg}", None)
        if "blocked" in msg.lower() or "captcha" in msg.lower():
            raise VintedError("CF_CHALLENGE", msg, None)
        raise VintedError("UNKNOWN", msg)

    if resp.status_code == 401:
        raise VintedError("SESSION_EXPIRED", "Session expired or invalid cookie", 401)
    if resp.status_code == 403:
        raise VintedError("FORBIDDEN", "Access forbidden (bot detection?)", 403)
    if resp.status_code == 429:
        raise VintedError("RATE_LIMITED", "Too many requests", 429)
    if resp.status_code != 200:
        raise VintedError(
            "HTTP_ERROR",
            f"HTTP {resp.status_code}: {resp.text[:200]}",
            resp.status_code,
        )

    try:
        return resp.json()
    except Exception as e:
        raise VintedError("PARSE_ERROR", f"Invalid JSON: {e}")


def checkout_build(
    order_id: int,
    cookie: str,
    proxy: str | None = None,
) -> dict:
    """
    Initiate checkout: POST /api/v2/purchases/checkout/build
    """
    api_url = f"{BASE_URL}/api/v2/purchases/checkout/build"
    payload = {"purchase_items": [{"id": order_id, "type": "transaction"}]}

    session = requests.Session(impersonate=IMPOSTOR)
    headers = _build_headers(cookie)
    headers["Content-Type"] = "application/json"

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "json": payload,
        "timeout": 30,
    }
    if proxy:
        req_kwargs["proxy"] = proxy

    try:
        resp = session.post(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        msg = str(e)
        if "cloudflare" in msg.lower() or "cf-" in msg.lower():
            raise VintedError("CF_CHALLENGE", f"Cloudflare challenge: {msg}", None)
        raise VintedError("UNKNOWN", msg)

    if resp.status_code == 401:
        raise VintedError("SESSION_EXPIRED", "Session expired or invalid cookie", 401)
    if resp.status_code == 403:
        raise VintedError("FORBIDDEN", "Access forbidden", 403)
    if resp.status_code == 429:
        raise VintedError("RATE_LIMITED", "Too many requests", 429)
    if resp.status_code not in (200, 201):
        raise VintedError(
            "HTTP_ERROR",
            f"HTTP {resp.status_code}: {resp.text[:200]}",
            resp.status_code,
        )

    try:
        return resp.json()
    except Exception as e:
        raise VintedError("PARSE_ERROR", f"Invalid JSON: {e}")


def checkout_put(
    purchase_id: str,
    components: dict,
    cookie: str,
    proxy: str | None = None,
) -> dict:
    """
    PUT checkout step: components (verification, pickup, payment, etc.)
    """
    api_url = f"{BASE_URL}/api/v2/purchases/{purchase_id}/checkout"
    payload = {"components": components}

    session = requests.Session(impersonate=IMPOSTOR)
    headers = _build_headers(cookie)
    headers["Content-Type"] = "application/json"

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "json": payload,
        "timeout": 30,
    }
    if proxy:
        req_kwargs["proxy"] = proxy

    try:
        resp = session.put(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        msg = str(e)
        if "cloudflare" in msg.lower():
            raise VintedError("CF_CHALLENGE", f"Cloudflare challenge: {msg}", None)
        raise VintedError("UNKNOWN", msg)

    if resp.status_code == 401:
        raise VintedError("SESSION_EXPIRED", "Session expired or invalid cookie", 401)
    if resp.status_code == 403:
        raise VintedError("FORBIDDEN", "Access forbidden", 403)
    if resp.status_code == 429:
        raise VintedError("RATE_LIMITED", "Too many requests", 429)
    if resp.status_code != 200:
        raise VintedError(
            "HTTP_ERROR",
            f"HTTP {resp.status_code}: {resp.text[:200]}",
            resp.status_code,
        )

    try:
        return resp.json()
    except Exception as e:
        raise VintedError("PARSE_ERROR", f"Invalid JSON: {e}")


def nearby_pickup_points(
    shipping_order_id: int,
    latitude: float,
    longitude: float,
    cookie: str,
    proxy: str | None = None,
    country_code: str = "GB",
) -> dict:
    """
    GET nearby pickup points for drop-off delivery.
    """
    api_url = f"{BASE_URL}/api/v2/shipping_orders/{shipping_order_id}/nearby_pickup_points"
    params = {
        "country_code": country_code,
        "latitude": latitude,
        "longitude": longitude,
    }
    qs = urlencode(params)
    full_url = f"{api_url}?{qs}"

    session = requests.Session(impersonate=IMPOSTOR)
    req_kwargs: dict = {
        "url": full_url,
        "headers": _build_headers(cookie),
        "timeout": 30,
    }
    if proxy:
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    if resp.status_code == 401:
        raise VintedError("SESSION_EXPIRED", "Session expired", 401)
    if resp.status_code != 200:
        raise VintedError(
            "HTTP_ERROR",
            f"HTTP {resp.status_code}: {resp.text[:200]}",
            resp.status_code,
        )

    try:
        return resp.json()
    except Exception as e:
        raise VintedError("PARSE_ERROR", f"Invalid JSON: {e}")


def apply_rate_limit(
    base_interval_seconds: float,
    jitter_max_seconds: float = 1.0,
) -> None:
    """Apply per-request delay: base + random jitter. Configurable from Electron."""
    delay = base_interval_seconds + random.uniform(0, jitter_max_seconds)
    time.sleep(delay)
