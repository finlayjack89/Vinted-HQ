"""
Vinted UK Sniper — Stealth HTTP client using curl_cffi.
Bypasses Cloudflare/Datadome via TLS fingerprint impersonation.
"""

import random
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

BASE_URL = "https://www.vinted.co.uk"


# ─── Session Pool ────────────────────────────────────────────────────────────
# Reuse HTTP sessions per proxy to enable HTTP/2 connection reuse and avoid
# creating a new TLS handshake for every request (a detectable pattern).

_session_pool: dict[str | None, requests.Session] = {}


def _get_session(proxy: str | None = None) -> requests.Session:
    """Get or create a reusable session for the given proxy."""
    if proxy not in _session_pool:
        _session_pool[proxy] = requests.Session(impersonate=IMPOSTOR)
    return _session_pool[proxy]


def reset_session(proxy: str | None = None) -> None:
    """Drop a cached session (e.g. after a Datadome challenge).
    The next call to _get_session will create a fresh one."""
    _session_pool.pop(proxy, None)


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
    Passes through ALL filter parameters from the original URL."""
    raw_query = params.get("_raw_query", {})
    # Start with the raw query params (preserves catalog[], color_ids[], etc.)
    parts: list[tuple[str, str]] = []
    for key, values in raw_query.items():
        # Skip page/per_page/order — we set them explicitly below
        if key in ("page", "per_page", "order"):
            continue
        for val in values:
            parts.append((key, val))
    # Add our controlled paging/ordering params
    parts.append(("page", str(params.get("page", 1))))
    parts.append(("per_page", str(params.get("per_page", 96))))
    parts.append(("order", params.get("order", "newest_first")))
    return urlencode(parts)


def _build_headers(cookie: str, referer: str | None = None) -> dict:
    """Build request headers matching a real Chrome browser fingerprint."""
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
) -> dict:
    """Build headers for write operations (POST/PUT/DELETE) that require CSRF."""
    headers = _build_headers(cookie, referer)
    headers["Content-Type"] = "application/json"
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id
    if upload_form:
        headers["x-upload-form"] = "true"
    return headers


def _detect_challenge(resp, proxy: str | None = None) -> None:
    """Detect Datadome/Cloudflare HTML challenge pages returned instead of JSON.
    These often come back as HTTP 200 with text/html content, so status-code
    checks alone miss them.  Resets the cached session for the proxy so the
    next request after a browser refresh gets a clean TLS connection."""
    content_type = resp.headers.get("content-type", "")
    if "text/html" in content_type:
        body_start = resp.text[:500].lower()
        if "datadome" in body_start or "<!doctype" in body_start or "<html" in body_start:
            reset_session(proxy)
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
        with open(_log_path, "a") as _f:
            _f.write(_json.dumps({"location":"vinted_client.py:search","message":"Built API URL","data":{"api_url_len":len(api_url),"has_catalog":("catalog" in qs),"has_color_ids":("color_ids" in qs),"has_brand_ids":("brand_ids" in qs),"has_size_ids":("size_ids" in qs),"page":page,"proxy_provided":bool(proxy)},"timestamp":int(time.time()*1000),"hypothesisId":"H6,H9"}) + "\n")
    except Exception:
        pass
    # endregion

    session = _get_session(proxy)
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

    _detect_challenge(resp, proxy)
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

    session = _get_session(proxy)
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

    _detect_challenge(resp, proxy)
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

    session = _get_session(proxy)
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

    _detect_challenge(resp, proxy)
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

    session = _get_session(proxy)
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

    _detect_challenge(resp, proxy)
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
) -> dict:
    """GET /api/v2/wardrobe/{user_id}/items — fetch user's own listings."""
    qs = urlencode({"page": page, "per_page": per_page, "order": "relevance"})
    api_url = f"{BASE_URL}/api/v2/wardrobe/{user_id}/items?{qs}"

    session = _get_session(proxy)
    headers = _build_headers(cookie, f"{BASE_URL}/member/{user_id}")
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy:
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
) -> dict:
    """GET /api/v2/item_upload/catalogs — fetch full category tree."""
    api_url = f"{BASE_URL}/api/v2/item_upload/catalogs"

    session = _get_session(proxy)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new")
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy:
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

    session = _get_session(proxy)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new")
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy:
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
) -> dict:
    """GET /api/v2/item_upload/colors — fetch all color options."""
    api_url = f"{BASE_URL}/api/v2/item_upload/colors"

    session = _get_session(proxy)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new")
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy:
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
) -> dict:
    """GET /api/v2/item_upload/conditions?catalog_id={id} — conditions for category."""
    qs = urlencode({"catalog_id": catalog_id})
    api_url = f"{BASE_URL}/api/v2/item_upload/conditions?{qs}"

    session = _get_session(proxy)
    headers = _build_headers(cookie, f"{BASE_URL}/items/new")
    if csrf_token:
        headers["x-csrf-token"] = csrf_token
    if anon_id:
        headers["x-anon-id"] = anon_id

    req_kwargs: dict = {"url": api_url, "headers": headers, "timeout": 30}
    if proxy:
        req_kwargs["proxy"] = proxy

    try:
        resp = session.get(**req_kwargs)
    except requests.errors.RequestsError as e:
        raise VintedError("REQUEST_FAILED", str(e))
    except Exception as e:
        raise VintedError("UNKNOWN", str(e))

    return _handle_response(resp, allow_statuses=(200, 304), proxy=proxy)


# ─── Photo Upload ────────────────────────────────────────────────────────────


def upload_photo(
    cookie: str,
    image_bytes: bytes,
    temp_uuid: str | None = None,
    csrf_token: str | None = None,
    anon_id: str | None = None,
    proxy: str | None = None,
    session: requests.Session | None = None,
) -> dict:
    """
    POST /api/v2/photos — upload image as multipart/form-data.
    Fields: photo[type]="item", photo[file]=(binary), photo[temp_uuid]=(uuid)
    Returns photo object with id, url, thumbnails, etc.
    """
    api_url = f"{BASE_URL}/api/v2/photos"
    photo_uuid = temp_uuid or str(uuid.uuid4())

    if session is None:
        session = _get_session(proxy)

    headers = _build_headers(cookie, f"{BASE_URL}/items/new")
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
    if proxy:
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
) -> dict:
    """
    POST /api/v2/item_upload/items — create and publish a new listing.
    item_data should contain all listing fields (title, description, price, etc.).
    """
    api_url = f"{BASE_URL}/api/v2/item_upload/items"
    session_id = upload_session_id or str(uuid.uuid4())

    if session is None:
        session = _get_session(proxy)

    headers = _build_write_headers(
        cookie, csrf_token, anon_id,
        referer=f"{BASE_URL}/items/new",
        upload_form=True,
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
    if proxy:
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
) -> dict:
    """
    PUT /api/v2/item_upload/items/{item_id} — edit an existing listing.
    """
    api_url = f"{BASE_URL}/api/v2/item_upload/items/{item_id}"
    session_id = upload_session_id or str(uuid.uuid4())

    if session is None:
        session = _get_session(proxy)

    headers = _build_write_headers(
        cookie, csrf_token, anon_id,
        referer=f"{BASE_URL}/items/{item_id}/edit",
        upload_form=True,
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
    if proxy:
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
) -> dict:
    """
    POST /api/v2/items/{item_id}/delete — delete a live listing.
    Empty body; uses POST (not DELETE method).
    """
    api_url = f"{BASE_URL}/api/v2/items/{item_id}/delete"

    if session is None:
        session = _get_session(proxy)

    headers = _build_write_headers(
        cookie, csrf_token, anon_id,
        referer=f"{BASE_URL}/items/{item_id}",
    )
    # Delete has empty body — remove Content-Type
    headers.pop("Content-Type", None)
    headers["Content-Length"] = "0"

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "timeout": 30,
    }
    if proxy:
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
) -> dict:
    """
    PUT /api/v2/items/{item_id}/is_hidden — hide or unhide a listing.
    """
    api_url = f"{BASE_URL}/api/v2/items/{item_id}/is_hidden"

    session = _get_session(proxy)
    headers = _build_write_headers(
        cookie, csrf_token, anon_id,
        referer=f"{BASE_URL}/items/{item_id}",
    )

    req_kwargs: dict = {
        "url": api_url,
        "headers": headers,
        "json": {"is_hidden": hidden},
        "timeout": 30,
    }
    if proxy:
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

    Returns:
        dict with {new_item_id, photo_ids, upload_session_id}
    """
    # Single session for IP consistency
    sticky_session = requests.Session(impersonate=IMPOSTOR)
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
    )

    return {
        "ok": True,
        "new_item": result,
        "photo_ids": [p["id"] for p in photo_ids],
        "upload_session_id": upload_session_id,
    }
