"""
Vinted UK Sniper — Stealth HTTP client using curl_cffi.
Bypasses Cloudflare/Datadome via TLS fingerprint impersonation.
"""

import json
import random
import re
import time
import uuid
from urllib.parse import urlencode, urlparse, parse_qs

from curl_cffi import requests

from image_mutator import mutate_image, jitter_text

# Impersonate Chrome for JA3/JA4 fingerprint ("chrome" = latest available target)
IMPOSTOR = "chrome"

# Keep UA version and Client Hints aligned with the impersonation target.
# Update these together when changing IMPOSTOR.
CHROME_VERSION = "136"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    f"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{CHROME_VERSION}.0.0.0 Safari/537.36"
)
SEC_CH_UA = f'"Chromium";v="{CHROME_VERSION}", "Google Chrome";v="{CHROME_VERSION}", "Not.A/Brand";v="24"'

# DIRECT mode: Chrome 110 Android mobile — aligned with impersonate="chrome110"
# TLS fingerprint and header versions MUST match to avoid DataDome mismatch flags.
DIRECT_IMPOSTOR = "chrome110"
DIRECT_USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36"
)
DIRECT_SEC_CH_UA = '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"'

BASE_URL = "https://www.vinted.co.uk"


# ─── Session Pool ────────────────────────────────────────────────────────────
# Reuse HTTP sessions per proxy to enable HTTP/2 connection reuse and avoid
# creating a new TLS handshake for every request (a detectable pattern).

_session_pool: dict[tuple[str | None, str | None], requests.Session] = {}


def _get_session(proxy: str | None = None, transport_mode: str | None = None) -> requests.Session:
    """Get or create a reusable session for the given proxy and transport mode.
    Different modes use different impersonate targets (PROXY=chrome, DIRECT=chrome110),
    so the pool key is (proxy, transport_mode) to prevent session collisions."""
    imp = DIRECT_IMPOSTOR if transport_mode == "DIRECT" else IMPOSTOR
    key = (proxy, transport_mode)
    if key not in _session_pool:
        _session_pool[key] = requests.Session(impersonate=imp)
    return _session_pool[key]


def reset_session(proxy: str | None = None, transport_mode: str | None = None) -> None:
    """Drop a cached session (e.g. after a Datadome challenge).
    The next call to _get_session will create a fresh one."""
    key = (proxy, transport_mode)
    _session_pool.pop(key, None)


class VintedError(Exception):
    """Structured error for Electron consumption."""

    def __init__(self, code: str, message: str, status_code: int | None = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _parse_catalog_url(url: str) -> dict:
    """Extract ALL query params from a Vinted catalog URL.
    Preserves filter parameters (catalog[], color_ids[], brand_ids[], etc.)."""
    parsed = urlparse(url)
    if "vinted.co.uk" not in parsed.netloc:
        raise VintedError("INVALID_URL", f"Not a Vinted catalog URL: {url}")
    query = parse_qs(parsed.query)
    # Return the full parsed query dict plus defaults for paging
    return {
        "_raw_query": query,
        "order": query.get("order", ["newest_first"])[0],
        "page": int(query.get("page", ["1"])[0]),
        "per_page": int(query.get("per_page", ["96"])[0]),
    }


def _build_search_params(params: dict) -> str:
    """Build the full query string for catalog/items endpoint.
    Passes through ALL filter parameters from the original URL.
    Maps frontend URL param names to Vinted API param names where they differ."""

    # Frontend URL → API endpoint parameter name mapping.
    # The Vinted website uses 'catalog[]' in browser URLs but the API
    # endpoint /api/v2/catalog/items expects 'catalog_ids[]'.
    PARAM_REMAP: dict[str, str] = {
        "catalog[]": "catalog_ids[]",
    }

    raw_query = params.get("_raw_query", {})
    # Start with the raw query params (preserves color_ids[], brand_ids[], etc.)
    parts: list[tuple[str, str]] = []
    for key, values in raw_query.items():
        # Skip page/per_page/order — we set them explicitly below
        if key in ("page", "per_page", "order"):
            continue
        # Remap parameter names where frontend and API differ
        api_key = PARAM_REMAP.get(key, key)
        for val in values:
            parts.append((api_key, val))
    # Add our controlled paging/ordering params
    parts.append(("page", str(params.get("page", 1))))
    parts.append(("per_page", str(params.get("per_page", 96))))
    parts.append(("order", params.get("order", "newest_first")))
    # urlencode encodes [] as %5B%5D; replace back to raw brackets
    # since Vinted's API expects unencoded brackets in array params
    qs = urlencode(parts)
    qs = qs.replace("%5B%5D", "[]")
    return qs


def _build_headers(cookie: str, referer: str | None = None, transport_mode: str | None = None) -> dict:
    """Build request headers matching a real Chrome browser fingerprint.
    In DIRECT mode, overlays Chrome 110 mobile headers while preserving
    Cookie, Accept, Referer, and Sec-Fetch headers."""
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-GB,en;q=0.9",
        "Origin": BASE_URL,
        "Referer": referer or f"{BASE_URL}/catalog",
        "Sec-Ch-Ua": SEC_CH_UA,
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": USER_AGENT,
    }
    if cookie:
        headers["Cookie"] = cookie

    # DIRECT mode: overlay Chrome 110 mobile headers.
    # Merged (not replaced) so Cookie/Accept/Referer/Sec-Fetch are preserved.
    if transport_mode == "DIRECT":
        headers["User-Agent"] = DIRECT_USER_AGENT
        headers["Sec-Ch-Ua"] = DIRECT_SEC_CH_UA
        headers["Sec-Ch-Ua-Mobile"] = "?1"
        headers["Sec-Ch-Ua-Platform"] = '"Android"'

    return headers


def _extract_csrf_from_cookie(cookie: str) -> str | None:
    """Extract x-csrf-token from cookie string if present (Vinted may send it in Set-Cookie)."""
    # Vinted often expects x-csrf-token in headers; it may be in a cookie or set by JS.
    # For now we rely on cookie bundle; add explicit csrf header if needed.
    return None


def _build_write_headers(
    cookie: str,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    referer: str | None = None,
    upload_form: bool = False,
    transport_mode: str | None = None,
) -> dict:
    """Build headers for write operations (POST/PUT/DELETE) that require CSRF."""
    headers = _build_headers(cookie, referer, transport_mode=transport_mode)
    headers["Content-Type"] = "application/json"
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id
    if upload_form:
        headers["x-upload-form"] = "true"
    return headers


def _detect_challenge(resp, proxy: str | None = None, transport_mode: str | None = None) -> None:
    """Detect Datadome/Cloudflare HTML challenge pages returned instead of JSON.
    These often come back as HTTP 200 with text/html content, so status-code
    checks alone miss them.  Resets the cached session for the proxy so the
    next request after a browser refresh gets a clean TLS connection."""
    content_type = resp.headers.get("content-type", "")
    if "text/html" in content_type:
        body_start = resp.text[:500].lower()
        if "datadome" in body_start or "<!doctype" in body_start or "<html" in body_start:
            reset_session(proxy, transport_mode)
            raise VintedError(
                "DATADOME_CHALLENGE",
                "Bot challenge detected -- refresh session in browser",
                403,
            )


def _handle_response(resp, allow_statuses: tuple = (200,), proxy: str | None = None) -> dict:
    """Common response status handling. Raises VintedError on failure."""
    if resp.status_code == 401:
        raise VintedError("SESSION_EXPIRED", "Session expired or invalid cookie", 401)
    if resp.status_code == 403:
        raise VintedError("FORBIDDEN", "Access forbidden (bot detection?)", 403)
    if resp.status_code == 429:
        raise VintedError("RATE_LIMITED", "Too many requests", 429)
    if resp.status_code not in allow_statuses:
        raise VintedError(
            "HTTP_ERROR",
            f"HTTP {resp.status_code}: {resp.text[:300]}",
            resp.status_code,
        )
    # Detect HTML challenge pages that slip through with a 200 status
    _detect_challenge(resp, proxy)
    try:
        return resp.json()
    except Exception as e:
        raise VintedError("PARSE_ERROR", f"Invalid JSON: {e}")


def search(
    url: str,
    cookie: str,
    proxy: str | None = None,
    page: int = 1,
    transport_mode: str | None = None,
) -> dict:
    """
    Fetch catalog items from a Vinted search/catalog URL.
    Uses /api/v2/catalog/items with params parsed from URL.
    """
    params = _parse_catalog_url(url)
    params["page"] = page
    qs = _build_search_params(params)
    api_url = f"{BASE_URL}/api/v2/catalog/items?{qs}"
    referer = url if url.startswith("http") else f"{BASE_URL}/catalog"

    # region agent log
    import json as _json, os as _os
    _log_path = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), ".cursor", "debug.log")
    try:
        # Log the full query string (first 800 chars) so we can verify exact parameter names and encoding
        _qs_keys = [k for k, v in (p.split("=", 1) for p in qs.split("&") if "=" in p)]
        _unique_keys = list(dict.fromkeys(_qs_keys))
        with open(_log_path, "a") as _f:
            _f.write(_json.dumps({"location":"vinted_client.py:search","message":"Built API URL","data":{"api_url_first800":api_url[:800],"qs_param_keys":_unique_keys,"has_catalog_bracket":("catalog%5B%5D" in qs or "catalog[]" in qs),"has_catalog_ids":("catalog_ids" in qs),"has_color_ids":("color_ids" in qs),"has_brand_ids":("brand_ids" in qs),"has_size_ids":("size_ids" in qs),"order_value":params.get("order","?"),"page":page,"proxy_provided":bool(proxy)},"timestamp":int(time.time()*1000),"hypothesisId":"H14,H15,H16"}) + "\n")
    except Exception:
        pass
    # endregion

    session = _get_session(proxy, transport_mode)
    req_kwargs: dict = {
        "url": api_url,
        "headers": _build_headers(cookie, referer, transport_mode),
        "timeout": 30,
    }
    # Safety: DIRECT mode must never use a proxy, regardless of what was passed.
    if proxy and transport_mode != "DIRECT":
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

    _detect_challenge(resp, proxy, transport_mode)
    try:
        _resp_data = resp.json()
    except Exception as e:
        raise VintedError("PARSE_ERROR", f"Invalid JSON: {e}")

    # region agent log
    try:
        _items = _resp_data.get("items", [])[:2]
        _sample = []
        for _it in _items:
            _sample.append({
                "id": _it.get("id"),
                "title": str(_it.get("title", ""))[:40],
                "catalog_id": _it.get("catalog_id"),
                "color1": str(_it.get("color1", "")),
                "color2": str(_it.get("color2", "")),
                "brand_title": str(_it.get("brand_title", "")),
                "size_title": str(_it.get("size_title", "")),
            })
        with open(_log_path, "a") as _f:
            _f.write(_json.dumps({"location":"vinted_client.py:search:response","message":"Search response sample","data":{"total_items":len(_resp_data.get("items",[])),"sample_items":_sample,"page":page},"timestamp":int(time.time()*1000),"hypothesisId":"H14,H15,H16"}) + "\n")
    except Exception:
        pass
    # endregion

    return _resp_data


def checkout_build(
    order_id: int,
    cookie: str,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """
    Initiate checkout: POST /api/v2/purchases/checkout/build
    """
    api_url = f"{BASE_URL}/api/v2/purchases/checkout/build"
    payload = {"purchase_items": [{"id": order_id, "type": "transaction"}]}

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, transport_mode=transport_mode)
    headers["Content-Type"] = "application/json"

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "json": payload,
        "timeout": 30,
    }
    if proxy and transport_mode != "DIRECT":
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

    _detect_challenge(resp, proxy, transport_mode)
    try:
        return resp.json()
    except Exception as e:
        raise VintedError("PARSE_ERROR", f"Invalid JSON: {e}")


def checkout_put(
    purchase_id: str,
    components: dict,
    cookie: str,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """
    PUT checkout step: components (verification, pickup, payment, etc.)
    """
    api_url = f"{BASE_URL}/api/v2/purchases/{purchase_id}/checkout"
    payload = {"components": components}

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, transport_mode=transport_mode)
    headers["Content-Type"] = "application/json"

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "json": payload,
        "timeout": 30,
    }
    if proxy and transport_mode != "DIRECT":
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

    _detect_challenge(resp, proxy, transport_mode)
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
    transport_mode: str | None = None,
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

    session = _get_session(proxy, transport_mode)
    req_kwargs: dict = {
        "url": full_url,
        "headers": _build_headers(cookie, transport_mode=transport_mode),
        "timeout": 30,
    }
    if proxy and transport_mode != "DIRECT":
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

    _detect_challenge(resp, proxy, transport_mode)
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


# ─── Wardrobe & Inventory Management ────────────────────────────────────────


def fetch_wardrobe(
    cookie: str,
    user_id: int,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    page: int = 1,
    per_page: int = 20,
    transport_mode: str | None = None,
) -> dict:
    """GET /api/v2/wardrobe/{user_id}/items — fetch user's own listings."""
    qs = urlencode({"page": page, "per_page": per_page, "order": "relevance"})
    api_url = f"{BASE_URL}/api/v2/wardrobe/{user_id}/items?{qs}"

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/member/{user_id}", transport_mode)
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304), proxy=proxy)


# ─── Ontology Endpoints ─────────────────────────────────────────────────────


def fetch_ontology_categories(
    cookie: str,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """GET /api/v2/item_upload/catalogs — fetch full category tree."""
    api_url = f"{BASE_URL}/api/v2/item_upload/catalogs"

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new", transport_mode)
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304), proxy=proxy)


def fetch_ontology_brands(
    cookie: str,
    category_id: int | None = None,
    keyword: str | None = None,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """GET /api/v2/item_upload/brands — fetch brands, optionally filtered."""
    params: dict = {}
    if category_id is not None:
        params["category_id"] = category_id
    if keyword:
        params["keyword"] = keyword
    qs = urlencode(params) if params else ""
    api_url = f"{BASE_URL}/api/v2/item_upload/brands"
    if qs:
        api_url += f"?{qs}"

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new", transport_mode)
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304), proxy=proxy)


def fetch_ontology_colors(
    cookie: str,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """GET /api/v2/item_upload/colors — fetch all color options."""
    api_url = f"{BASE_URL}/api/v2/item_upload/colors"

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new", transport_mode)
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304), proxy=proxy)


def fetch_ontology_conditions(
    cookie: str,
    catalog_id: int,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """GET /api/v2/item_upload/conditions?catalog_id={id} — conditions for category."""
    qs = urlencode({"catalog_id": catalog_id})
    api_url = f"{BASE_URL}/api/v2/item_upload/conditions?{qs}"

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new", transport_mode)
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304), proxy=proxy)


def fetch_ontology_models(
    cookie: str,
    catalog_id: int,
    brand_id: int,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """GET /api/v2/item_upload/models?catalog_id={cat}&brand_id={brand} — models for a luxury brand."""
    qs = urlencode({"catalog_id": catalog_id, "brand_id": brand_id})
    api_url = f"{BASE_URL}/api/v2/item_upload/models?{qs}"

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new", transport_mode)
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304, 404), proxy=proxy)


def fetch_ontology_sizes(
    cookie: str,
    catalog_id: int,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """GET /api/v2/item_upload/size_groups?catalog_ids={id} — size groups for a category."""
    qs = urlencode({"catalog_ids": catalog_id})
    api_url = f"{BASE_URL}/api/v2/item_upload/size_groups?{qs}"

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new", transport_mode)
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304), proxy=proxy)


def fetch_ontology_materials(
    cookie: str,
    catalog_id: int,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """POST /api/v2/item_upload/attributes — fetch material options for a category.
    The Vinted API returns materials as part of the attributes endpoint,
    which is a POST with the category value in the request body."""
    api_url = f"{BASE_URL}/api/v2/item_upload/attributes"
    payload = {"attributes": [{"code": "category", "value": [catalog_id]}]}

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new", transport_mode)
    headers["Content-Type"] = "application/json"
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "json": payload, "timeout": 30}
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.post(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304), proxy=proxy)


def fetch_ontology_package_sizes(
    cookie: str,
    catalog_id: int,
    item_id: int | None = None,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """GET /api/v2/catalogs/{catalog_id}/package_sizes — package sizes for a category."""
    api_url = f"{BASE_URL}/api/v2/catalogs/{catalog_id}/package_sizes"
    if item_id:
        api_url += f"?item_id={item_id}"

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new", transport_mode)
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304), proxy=proxy)


def fetch_item_detail(
    cookie: str,
    item_id: int,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """Fetch full item details by scraping the item page HTML.

    The API endpoint /api/v2/items/{id} does not exist as a public endpoint
    on Vinted. Item data is delivered via Nuxt.js SSR, embedded in the HTML
    page as __NUXT_DATA__. We fetch the page and extract it.
    """
    page_url = f"{BASE_URL}/items/{item_id}"

    session = _get_session(proxy, transport_mode)
    headers = _build_headers(cookie, f"{BASE_URL}/catalog", transport_mode)
    # Request HTML (normal page navigation, not API)
    headers["Accept"] = (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    )
    headers["Sec-Fetch-Dest"] = "document"
    headers["Sec-Fetch-Mode"] = "navigate"
    headers["Sec-Fetch-Site"] = "same-origin"
    headers["Sec-Fetch-User"] = "?1"
    headers["Upgrade-Insecure-Requests"] = "1"

    req_kwargs: dict = {
        "url": page_url,
        "headers": headers,
        "timeout": 30,
        "allow_redirects": True,
    }
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    if resp.status_code == 429:
        raise VintedError("RATE_LIMITED", "Too many requests", 429)
    if resp.status_code == 403:
        raise VintedError("FORBIDDEN", "Access forbidden", 403)
    if resp.status_code == 404:
        raise VintedError("NOT_FOUND", f"Item {item_id} not found", 404)
    if resp.status_code not in (200,):
        raise VintedError("HTTP_ERROR", f"HTTP {resp.status_code}", resp.status_code)

    html = resp.text

    # Check for DataDome/bot challenge (but NOT regular HTML since we expect HTML)
    body_lower = html[:2000].lower()
    if "datadome" in body_lower and "captcha" in body_lower:
        reset_session(proxy, transport_mode)
        raise VintedError("DATADOME_CHALLENGE", "Bot challenge on item page", 403)

    item_data = _extract_item_from_html(html, item_id)
    if not item_data:
        raise VintedError(
            "PARSE_ERROR",
            f"Could not extract item data for {item_id} from page HTML (len={len(html)})",
        )

    # Normalize SSR field names to canonical Vinted API field names
    normalized = _normalize_ssr_item(item_data)
    return {"item": normalized}


# ─── SSR Data Normalisation ──────────────────────────────────────────────────


def _normalize_ssr_item(raw: dict) -> dict:
    """Normalize Vinted SSR/Nuxt item data to canonical API field names.

    The Nuxt SSR payload uses nested objects and different key names than the
    Vinted API (PUT /api/v2/item_upload/items/{id}).  This function flattens
    nested objects and remaps keys so the TypeScript consumer always receives
    a consistent shape: {catalog_id, brand_id, brand_title, size_id, status_id,
    color_ids, package_size_id, price, ...}.

    Also logs the raw SSR key set for diagnostics (visible in the Python bridge
    console) so field-name mismatches can be diagnosed.
    """
    import sys
    _keys = sorted(raw.keys()) if isinstance(raw, dict) else []
    print(f"[normalize_ssr_item] raw keys ({len(_keys)}): {_keys}", file=sys.stderr)

    out: dict = {}

    # ── Pass-through simple scalar fields ────────────────────────────────
    for key in (
        "id", "title", "description", "is_unisex", "isbn",
        "measurement_length", "measurement_width",
        "manufacturer", "manufacturer_labelling",
        "video_game_rating_id", "model_metadata",
    ):
        if key in raw and raw[key] is not None:
            out[key] = raw[key]

    # ── Price — number, string, or {amount, currency_code} ───────────────
    price_raw = raw.get("price")
    if isinstance(price_raw, dict):
        out["price"] = price_raw.get("amount", price_raw.get("price"))
        out["currency"] = price_raw.get("currency_code", "GBP")
    elif price_raw is not None:
        out["price"] = price_raw

    # ── catalog_id (category) ────────────────────────────────────────────
    out["catalog_id"] = (
        raw.get("catalog_id")
        or raw.get("category_id")
        or raw.get("catalogId")
        or raw.get("categoryId")
    )
    for nested_key in ("category", "catalog", "catalogue"):
        obj = raw.get(nested_key)
        if isinstance(obj, dict) and not out.get("catalog_id"):
            out["catalog_id"] = obj.get("id")

    # ── brand_id / brand_title ───────────────────────────────────────────
    out["brand_id"] = raw.get("brand_id") or raw.get("brandId")
    brand_title = None
    for bkey in ("brand_dto", "brand"):
        bval = raw.get(bkey)
        if isinstance(bval, dict):
            if not out.get("brand_id"):
                out["brand_id"] = bval.get("id")
            brand_title = bval.get("title") or bval.get("name") or brand_title
        elif isinstance(bval, str) and bval:
            brand_title = bval
    out["brand_title"] = brand_title or raw.get("brand_title") or raw.get("brandTitle")

    # ── size_id ──────────────────────────────────────────────────────────
    out["size_id"] = raw.get("size_id") or raw.get("sizeId")
    size_val = raw.get("size")
    if isinstance(size_val, dict) and not out.get("size_id"):
        out["size_id"] = size_val.get("id")
    out["size_title"] = (
        raw.get("size_title")
        or (size_val.get("title") if isinstance(size_val, dict) else None)
        or (size_val if isinstance(size_val, str) else None)
    )

    # ── status_id (condition) ────────────────────────────────────────────
    out["status_id"] = raw.get("status_id") or raw.get("statusId")
    status_val = raw.get("status")
    if isinstance(status_val, dict) and not out.get("status_id"):
        out["status_id"] = status_val.get("id")
    elif isinstance(status_val, str) and not out.get("status_id"):
        _cond_map = {
            "New with tags": 6, "new_with_tags": 6,
            "New without tags": 1, "new_without_tags": 1,
            "Very good": 2, "very_good": 2,
            "Good": 3, "good": 3,
            "Satisfactory": 4, "satisfactory": 4,
            "Not fully functional": 5,
        }
        out["status_id"] = _cond_map.get(status_val)

    # ── package_size_id ──────────────────────────────────────────────────
    out["package_size_id"] = raw.get("package_size_id") or raw.get("packageSizeId")
    pkg_val = raw.get("package_size")
    if isinstance(pkg_val, dict) and not out.get("package_size_id"):
        out["package_size_id"] = pkg_val.get("id")

    # ── color_ids ────────────────────────────────────────────────────────
    cids = raw.get("color_ids") or raw.get("colorIds")
    if isinstance(cids, list):
        out["color_ids"] = cids
    else:
        colors_arr = raw.get("colors")
        if isinstance(colors_arr, list):
            out["color_ids"] = [
                c.get("id") if isinstance(c, dict) else c
                for c in colors_arr
                if (c.get("id") if isinstance(c, dict) else c) is not None
            ]
        else:
            ids = []
            c1 = raw.get("color1_id") or raw.get("color1Id")
            c2 = raw.get("color2_id") or raw.get("color2Id")
            if c1:
                ids.append(c1)
            if c2:
                ids.append(c2)
            if ids:
                out["color_ids"] = ids

    # ── item_attributes (materials, etc.) ────────────────────────────────
    attrs = raw.get("item_attributes") or raw.get("itemAttributes") or raw.get("attributes")
    if attrs is not None:
        out["item_attributes"] = attrs

    # ── shipment_prices ──────────────────────────────────────────────────
    sp = raw.get("shipment_prices") or raw.get("shipmentPrices")
    if sp is not None:
        out["shipment_prices"] = sp

    # ── is_hidden / is_closed / is_reserved / is_draft flags ─────────────
    for flag in ("is_hidden", "is_closed", "is_reserved", "is_draft"):
        if flag in raw:
            out[flag] = raw[flag]

    # ── photos (preserve for downstream) ─────────────────────────────────
    photos = raw.get("photos")
    if isinstance(photos, list):
        out["photos"] = photos

    # Strip None values to keep the output clean
    return {k: v for k, v in out.items() if v is not None}


# ─── Nuxt SSR Data Extraction ────────────────────────────────────────────────


def _extract_item_from_html(html: str, item_id: int) -> dict | None:
    """Extract item data from Vinted page HTML.
    Tries Nuxt __NUXT_DATA__ first, then Schema.org JSON-LD."""

    # Strategy 1: Nuxt 3 __NUXT_DATA__ payload
    nuxt_matches = re.findall(
        r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    for raw in nuxt_matches:
        data = _parse_nuxt_payload(raw.strip())
        if data:
            item = _find_item_in_data(data, item_id)
            if item:
                return item

    # Strategy 2: Schema.org JSON-LD
    ld_matches = re.findall(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    for raw in ld_matches:
        try:
            ld = json.loads(raw.strip())
            items = ld if isinstance(ld, list) else [ld]
            for entry in items:
                if isinstance(entry, dict) and entry.get("@type") == "Product":
                    return _schema_org_to_item(entry, item_id)
        except (json.JSONDecodeError, ValueError):
            pass

    # Strategy 3: window.__NUXT__ (older Nuxt 2 format)
    nuxt2_match = re.search(
        r"window\.__NUXT__\s*=\s*(\{.+?\})\s*;?\s*</script>",
        html,
        re.DOTALL,
    )
    if nuxt2_match:
        try:
            data = json.loads(nuxt2_match.group(1))
            item = _find_item_in_data(data, item_id)
            if item:
                return item
        except (json.JSONDecodeError, ValueError):
            pass

    return None


def _parse_nuxt_payload(raw_json: str) -> dict | None:
    """Parse Nuxt 3 __NUXT_DATA__ compressed array format into a dict."""
    try:
        arr = json.loads(raw_json)
    except (json.JSONDecodeError, ValueError):
        return None

    if not isinstance(arr, list) or len(arr) <= 1:
        return None

    header = arr[0]
    if not isinstance(header, list) or len(header) < 2:
        return None
    if header[0] not in ("Reactive", "ShallowReactive"):
        return None

    return _resolve_nuxt_node(arr, 1, depth=0)


def _resolve_nuxt_node(arr: list, idx: int, depth: int = 0) -> object:
    """Recursively resolve a Nuxt compressed-array reference."""
    if depth > 40 or idx < 0 or idx >= len(arr):
        return None

    node = arr[idx]

    if isinstance(node, dict):
        result = {}
        for k, v in node.items():
            if isinstance(v, int):
                result[k] = _resolve_nuxt_node(arr, v, depth + 1)
            else:
                result[k] = v
        return result

    if isinstance(node, list):
        if not node:
            return []
        first = node[0]
        if isinstance(first, str):
            if first in ("Ref", "EmptyRef", "EmptyShallowRef", "ShallowReactive", "Reactive"):
                return _resolve_nuxt_node(arr, node[1], depth + 1) if len(node) > 1 else None
            if first == "Set":
                return [_resolve_nuxt_node(arr, v, depth + 1) for v in node[1:]]
            if first == "null":
                # dict-as-list: ["null", key1, val_idx1, key2, val_idx2, ...]
                result = {}
                for i in range(1, len(node) - 1, 2):
                    k = node[i]
                    v = node[i + 1]
                    result[k] = _resolve_nuxt_node(arr, v, depth + 1) if isinstance(v, int) else v
                return result
        # Regular list — resolve each element
        return [
            _resolve_nuxt_node(arr, v, depth + 1) if isinstance(v, int) else v
            for v in node
        ]

    # Leaf value (string, number, bool, null)
    return node


def _find_item_in_data(data: object, item_id: int, depth: int = 0) -> dict | None:
    """Recursively search for the item object matching item_id."""
    if depth > 25:
        return None

    if isinstance(data, dict):
        if data.get("id") == item_id and ("title" in data or "description" in data):
            return data
        for v in data.values():
            found = _find_item_in_data(v, item_id, depth + 1)
            if found:
                return found

    elif isinstance(data, list):
        for v in data:
            found = _find_item_in_data(v, item_id, depth + 1)
            if found:
                return found

    return None


def _schema_org_to_item(schema: dict, item_id: int) -> dict:
    """Convert Schema.org Product markup into Vinted-like item dict."""
    item: dict = {"id": item_id, "title": schema.get("name", "")}

    if schema.get("description"):
        item["description"] = schema["description"]

    offers = schema.get("offers")
    if isinstance(offers, dict):
        if offers.get("price"):
            item["price"] = offers["price"]
        item["currency"] = offers.get("priceCurrency", "GBP")

    brand = schema.get("brand")
    if isinstance(brand, dict):
        item["brand"] = brand.get("name", "")

    condition_map = {
        "https://schema.org/NewCondition": 6,
        "https://schema.org/UsedCondition": 3,
        "https://schema.org/RefurbishedCondition": 2,
    }
    item_condition = schema.get("itemCondition", "")
    if item_condition in condition_map:
        item["status_id"] = condition_map[item_condition]

    images = schema.get("image", [])
    if isinstance(images, list):
        item["photos"] = [
            {"url": img} if isinstance(img, str) else img for img in images
        ]

    return item


# ─── Photo Upload ────────────────────────────────────────────────────────────


def upload_photo(
    cookie: str,
    image_bytes: bytes,
    temp_uuid: str | None = None,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    session: requests.Session | None = None,
    transport_mode: str | None = None,
) -> dict:
    """
    POST /api/v2/photos — upload image as multipart/form-data.
    Fields: photo[type]="item", photo[file]=(binary), photo[temp_uuid]=(uuid)
    Returns photo object with id, url, thumbnails, etc.
    """
    api_url = f"{BASE_URL}/api/v2/photos"
    photo_uuid = temp_uuid or str(uuid.uuid4())

    if session is None:
        session = _get_session(proxy, transport_mode)

    headers = _build_headers(cookie, f"{BASE_URL}/items/new", transport_mode)
    # Remove Content-Type — curl_cffi sets it with boundary for multipart
    headers.pop("Content-Type", None)
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    # multipart fields matching Vinted's expected format
    multipart = [
        ("photo[type]", (None, "item")),
        ("photo[file]", ("photo.jpg", image_bytes, "image/jpeg")),
        ("photo[temp_uuid]", (None, photo_uuid)),
    ]

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "multipart": multipart,
        "timeout": 60,
    }
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.post(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 201), proxy=proxy)


# ─── Listing CRUD ────────────────────────────────────────────────────────────


def create_listing(
    cookie: str,
    item_data: dict,
    upload_session_id: str | None = None,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    session: requests.Session | None = None,
    transport_mode: str | None = None,
) -> dict:
    """
    POST /api/v2/item_upload/items — create and publish a new listing.
    item_data should contain all listing fields (title, description, price, etc.).
    """
    api_url = f"{BASE_URL}/api/v2/item_upload/items"
    session_id = upload_session_id or str(uuid.uuid4())

    if session is None:
        session = _get_session(proxy, transport_mode)

    headers = _build_write_headers(
        cookie, csrf_token, anon_id,
        referer=f"{BASE_URL}/items/new",
        upload_form=True,
        transport_mode=transport_mode,
    )

    payload = {
        "item": {
            "id": None,
            **item_data,
        },
        "feedback_id": None,
        "push_up": False,
        "parcel": None,
        "upload_session_id": session_id,
    }

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "json": payload,
        "timeout": 30,
    }
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.post(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 201), proxy=proxy)


def edit_listing(
    cookie: str,
    item_id: int,
    item_data: dict,
    upload_session_id: str | None = None,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    session: requests.Session | None = None,
    transport_mode: str | None = None,
) -> dict:
    """
    PUT /api/v2/item_upload/items/{item_id} — edit an existing listing.
    """
    api_url = f"{BASE_URL}/api/v2/item_upload/items/{item_id}"
    session_id = upload_session_id or str(uuid.uuid4())

    if session is None:
        session = _get_session(proxy, transport_mode)

    headers = _build_write_headers(
        cookie, csrf_token, anon_id,
        referer=f"{BASE_URL}/items/{item_id}/edit",
        upload_form=True,
        transport_mode=transport_mode,
    )

    payload = {
        "item": {
            "id": item_id,
            **item_data,
        },
        "feedback_id": None,
        "push_up": False,
        "parcel": None,
        "upload_session_id": session_id,
    }

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "json": payload,
        "timeout": 30,
    }
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.put(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200,), proxy=proxy)


def delete_listing(
    cookie: str,
    item_id: int,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    session: requests.Session | None = None,
    transport_mode: str | None = None,
) -> dict:
    """
    POST /api/v2/items/{item_id}/delete — delete a live listing.
    Empty body; uses POST (not DELETE method).
    """
    api_url = f"{BASE_URL}/api/v2/items/{item_id}/delete"

    if session is None:
        session = _get_session(proxy, transport_mode)

    headers = _build_write_headers(
        cookie, csrf_token, anon_id,
        referer=f"{BASE_URL}/items/{item_id}",
        transport_mode=transport_mode,
    )
    # Delete has empty body — remove Content-Type
    headers.pop("Content-Type", None)
    headers["Content-Length"] = "0"

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "timeout": 30,
    }
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.post(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200,), proxy=proxy)


def hide_listing(
    cookie: str,
    item_id: int,
    hidden: bool = True,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """
    PUT /api/v2/items/{item_id}/is_hidden — hide or unhide a listing.
    """
    api_url = f"{BASE_URL}/api/v2/items/{item_id}/is_hidden"

    session = _get_session(proxy, transport_mode)
    headers = _build_write_headers(
        cookie, csrf_token, anon_id,
        referer=f"{BASE_URL}/items/{item_id}",
        transport_mode=transport_mode,
    )

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "json": {"is_hidden": hidden},
        "timeout": 30,
    }
    if proxy and transport_mode != "DIRECT":
        req_kwargs["proxy"] = proxy

    try:
        resp = session.put(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200,), proxy=proxy)


# ─── Stealth Relist Orchestrator ─────────────────────────────────────────────


def relist_item(
    cookie: str,
    old_item_id: int,
    item_data: dict,
    image_bytes_list: list[bytes],
    relist_count: int,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    transport_mode: str | None = None,
) -> dict:
    """
    Full stealth relist sequence under a single sticky proxy session:
      1. Mutate & upload all images
      2. Delete old listing
      3. Wait 10 seconds (delete-post jitter)
      4. Create + publish new listing with mutated text & new photo IDs
      5. Return new item data

    Args:
        cookie: Full Vinted session cookie string.
        old_item_id: The current live Vinted item ID to delete.
        item_data: Listing fields (title, description, price, etc.) from local master.
        image_bytes_list: List of raw image bytes (from local cache).
        relist_count: Current relist count (controls mutation direction).
        csrf_token: CSRF token for write operations.
        anon_id: Anonymous ID header value.
        proxy: Sticky proxy URL for the entire sequence.
        transport_mode: 'PROXY' or 'DIRECT' for hybrid transport.

    Returns:
        dict with {new_item_id, photo_ids, upload_session_id}
    """
    # Single session for IP consistency — use mode-appropriate impersonate target
    imp = DIRECT_IMPOSTOR if transport_mode == "DIRECT" else IMPOSTOR
    sticky_session = requests.Session(impersonate=imp)
    upload_session_id = str(uuid.uuid4())

    # ── Step 1: Mutate and upload all images ──
    photo_ids = []
    for img_bytes in image_bytes_list:
        mutated = mutate_image(img_bytes, relist_count)
        photo_uuid = str(uuid.uuid4())
        result = upload_photo(
            cookie=cookie,
            image_bytes=mutated,
            temp_uuid=photo_uuid,
            csrf_token=csrf_token,
            anon_id=anon_id,
            proxy=proxy,
            session=sticky_session,
            transport_mode=transport_mode,
        )
        photo_id = result.get("id")
        if photo_id:
            photo_ids.append({"id": photo_id, "orientation": 0})
        # Small delay between uploads to mimic human behavior
        time.sleep(random.uniform(0.3, 0.8))

    if not photo_ids:
        raise VintedError("UPLOAD_FAILED", "No photos were uploaded successfully")

    # ── Step 2: Delete old listing ──
    delete_listing(
        cookie=cookie,
        item_id=old_item_id,
        csrf_token=csrf_token,
        anon_id=anon_id,
        proxy=proxy,
        session=sticky_session,
        transport_mode=transport_mode,
    )

    # ── Step 3: Wait 10 seconds (delete-post jitter) ──
    time.sleep(10)

    # ── Step 4: Create + publish new listing with mutated text ──
    # Apply whitespace jitter to title and description
    mutated_data = dict(item_data)
    if "title" in mutated_data:
        mutated_data["title"] = jitter_text(mutated_data["title"], relist_count)
    if "description" in mutated_data:
        mutated_data["description"] = jitter_text(
            mutated_data["description"] or "", relist_count
        )

    # Replace photo references with newly uploaded ones
    mutated_data["assigned_photos"] = photo_ids
    mutated_data["temp_uuid"] = upload_session_id

    result = create_listing(
        cookie=cookie,
        item_data=mutated_data,
        upload_session_id=upload_session_id,
        csrf_token=csrf_token,
        anon_id=anon_id,
        proxy=proxy,
        session=sticky_session,
        transport_mode=transport_mode,
    )

    return {
        "ok": True,
        "new_item": result,
        "photo_ids": [p["id"] for p in photo_ids],
        "upload_session_id": upload_session_id,
    }
