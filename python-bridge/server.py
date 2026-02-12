#!/usr/bin/env python3
"""
Vinted UK Sniper — Python Bridge
Local HTTP server for Electron to call. Uses curl_cffi for stealth requests.
"""

from typing import Optional

import uvicorn
from fastapi import FastAPI, Header, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from vinted_client import (
    VintedError,
    search as vinted_search,
    checkout_build as vinted_checkout_build,
    checkout_put as vinted_checkout_put,
    nearby_pickup_points as vinted_nearby_pickup_points,
    apply_rate_limit,
)

app = FastAPI(
    title="Vinted UK Sniper Bridge",
    version="0.2.0",
)

# Allow Electron renderer to call this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configurable from Electron via query/header
DEFAULT_BASE_INTERVAL = 0.0  # No delay by default; Electron controls polling
DEFAULT_JITTER = 1.0


def _error_response(code: str, message: str, status_code: int = 500) -> JSONResponse:
    """Structured error for Electron: { ok: false, code, message }"""
    return JSONResponse(
        status_code=status_code,
        content={"ok": False, "code": code, "message": message},
    )


def _rate_limit_if_needed(base_interval: float, jitter: float) -> None:
    """Apply delay when base_interval > 0."""
    if base_interval > 0:
        apply_rate_limit(base_interval, jitter)


@app.get("/health")
def health():
    """Health check for Electron to verify bridge is running."""
    return {"ok": True, "service": "vinted-sniper-bridge"}


@app.get("/search")
def search(
    url: str = Query(..., description="Vinted catalog URL (e.g. https://www.vinted.co.uk/catalog?search_text=...)"),
    page: int = Query(1, ge=1, le=100),
    proxy: Optional[str] = Query(None, description="Proxy URL (http:// or socks5://)"),
    base_interval: float = Query(0, ge=0, description="Base delay in seconds before request"),
    jitter: float = Query(1, ge=0, description="Max random jitter in seconds"),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
):
    """
    Fetch catalog items from a Vinted search URL.
    Cookie required in X-Vinted-Cookie header.
    """
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    _rate_limit_if_needed(base_interval, jitter)

    try:
        data = vinted_search(url=url, cookie=x_vinted_cookie, proxy=proxy, page=page)
        return {"ok": True, "data": data}
    except VintedError as e:
        status = e.status_code or 500
        return _error_response(e.code, e.message, status)


@app.post("/checkout/build")
def checkout_build(
    body: dict = Body(...),
    proxy: Optional[str] = Query(None),
    base_interval: float = Query(0, ge=0),
    jitter: float = Query(1, ge=0),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
):
    """
    Initiate checkout: POST /api/v2/purchases/checkout/build
    Body: { "order_id": 18034809253 }
    """
    order_id = body.get("order_id")
    if order_id is None:
        return _error_response("INVALID_BODY", "order_id required", 400)
    try:
        order_id = int(order_id)
    except (TypeError, ValueError):
        return _error_response("INVALID_BODY", "order_id must be an integer", 400)

    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    _rate_limit_if_needed(base_interval, jitter)

    try:
        data = vinted_checkout_build(
            order_id=order_id,
            cookie=x_vinted_cookie,
            proxy=proxy,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        status = e.status_code or 500
        return _error_response(e.code, e.message, status)


@app.put("/checkout/{purchase_id}")
def checkout_put(
    purchase_id: str,
    body: dict = Body(...),
    proxy: Optional[str] = Query(None),
    base_interval: float = Query(0, ge=0),
    jitter: float = Query(1, ge=0),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
):
    """
    PUT checkout step: components (verification, pickup, payment, etc.)
    Body: { "components": { "additional_service": {...}, ... } }
    """
    components = body.get("components", body)
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    _rate_limit_if_needed(base_interval, jitter)

    try:
        data = vinted_checkout_put(
            purchase_id=purchase_id,
            components=components,
            cookie=x_vinted_cookie,
            proxy=proxy,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        status = e.status_code or 500
        return _error_response(e.code, e.message, status)


@app.get("/checkout/nearby_pickup_points")
def nearby_pickup_points(
    shipping_order_id: int = Query(...),
    latitude: float = Query(...),
    longitude: float = Query(...),
    country_code: str = Query("GB"),
    proxy: Optional[str] = Query(None),
    base_interval: float = Query(0, ge=0),
    jitter: float = Query(1, ge=0),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
):
    """
    Fetch nearby pickup points for drop-off delivery.
    """
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    _rate_limit_if_needed(base_interval, jitter)

    try:
        data = vinted_nearby_pickup_points(
            shipping_order_id=shipping_order_id,
            latitude=latitude,
            longitude=longitude,
            cookie=x_vinted_cookie,
            proxy=proxy,
            country_code=country_code,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        status = e.status_code or 500
        return _error_response(e.code, e.message, status)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=37421, log_level="info")
