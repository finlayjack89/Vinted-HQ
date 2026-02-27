#!/usr/bin/env python3
"""
Vinted UK Sniper — Python Bridge
Local HTTP server for Electron to call. Uses curl_cffi for stealth requests.
"""

import io
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, Form, Header, Query, Body, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from vinted_client import (
    VintedError,
    search as vinted_search,
    checkout_build as vinted_checkout_build,
    checkout_put as vinted_checkout_put,
    nearby_pickup_points as vinted_nearby_pickup_points,
    apply_rate_limit,
    fetch_wardrobe as vinted_fetch_wardrobe,
    fetch_ontology_categories as vinted_fetch_categories,
    fetch_ontology_brands as vinted_fetch_brands,
    fetch_ontology_colors as vinted_fetch_colors,
    fetch_ontology_conditions as vinted_fetch_conditions,
    fetch_ontology_sizes as vinted_fetch_sizes,
    fetch_ontology_materials as vinted_fetch_materials,
    fetch_ontology_package_sizes as vinted_fetch_package_sizes,
    fetch_ontology_models as vinted_fetch_models,
    fetch_item_detail as vinted_fetch_item_detail,
    upload_photo as vinted_upload_photo,
    create_listing as vinted_create_listing,
    edit_listing as vinted_edit_listing,
    delete_listing as vinted_delete_listing,
    hide_listing as vinted_hide_listing,
    relist_item as vinted_relist_item,
)
from image_mutator import mutate_image

app = FastAPI(
    title="Vinted UK Sniper Bridge",
    version="0.3.0",
)

# Allow Electron renderer and Chrome Extension content scripts to call this bridge.
# Extension content scripts run under the Vinted origin, so we must include it here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        "app://.",
        "file://",
        "https://www.vinted.co.uk",
        "https://vinted.co.uk",
    ],
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
    transport_mode: Optional[str] = Query(None, description="Transport mode: PROXY or DIRECT"),
    base_interval: float = Query(0, ge=0, description="Base delay in seconds before request"),
    jitter: float = Query(1, ge=0, description="Max random jitter in seconds"),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """
    Fetch catalog items from a Vinted search URL.
    Cookie required in X-Vinted-Cookie header.
    """
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    _rate_limit_if_needed(base_interval, jitter)

    try:
        data = vinted_search(
            url=url,
            cookie=x_vinted_cookie,
            proxy=proxy,
            page=page,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        status = e.status_code or 500
        return _error_response(e.code, e.message, status)


@app.post("/checkout/build")
def checkout_build(
    body: dict = Body(...),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    base_interval: float = Query(0, ge=0),
    jitter: float = Query(1, ge=0),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
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
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
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
    transport_mode: Optional[str] = Query(None),
    base_interval: float = Query(0, ge=0),
    jitter: float = Query(1, ge=0),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
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
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
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
    transport_mode: Optional[str] = Query(None),
    base_interval: float = Query(0, ge=0),
    jitter: float = Query(1, ge=0),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
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
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        status = e.status_code or 500
        return _error_response(e.code, e.message, status)


# ─── Wardrobe & Inventory Endpoints ──────────────────────────────────────────


@app.get("/wardrobe")
def wardrobe(
    user_id: int = Query(..., description="Vinted user ID"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch user's own wardrobe listings."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_wardrobe(
            cookie=x_vinted_cookie,
            user_id=user_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            page=page,
            per_page=per_page,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


# ─── Ontology Endpoints ─────────────────────────────────────────────────────


@app.get("/ontology/categories")
def ontology_categories(
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch Vinted category tree."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_categories(
            cookie=x_vinted_cookie,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.get("/ontology/brands")
def ontology_brands(
    category_id: Optional[int] = Query(None),
    keyword: Optional[str] = Query(None),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch brands, optionally filtered by category or keyword."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_brands(
            cookie=x_vinted_cookie,
            category_id=category_id,
            keyword=keyword,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.get("/ontology/colors")
def ontology_colors(
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch all color options."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_colors(
            cookie=x_vinted_cookie,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.get("/ontology/conditions")
def ontology_conditions(
    catalog_id: int = Query(..., description="Category/catalog ID"),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch conditions for a category."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_conditions(
            cookie=x_vinted_cookie,
            catalog_id=catalog_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.get("/ontology/sizes")
def ontology_sizes(
    catalog_id: int = Query(..., description="Category/catalog ID"),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch sizes for a category."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_sizes(
            cookie=x_vinted_cookie,
            catalog_id=catalog_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.get("/ontology/materials")
def ontology_materials(
    catalog_id: int = Query(..., description="Category/catalog ID"),
    item_id: Optional[int] = Query(None, description="Item ID for context-specific materials"),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch materials for a category."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_materials(
            cookie=x_vinted_cookie,
            catalog_id=catalog_id,
            item_id=item_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.get("/ontology/package_sizes")
def ontology_package_sizes(
    catalog_id: int = Query(..., description="Category/catalog ID"),
    item_id: Optional[int] = Query(None, description="Item ID for context-specific sizes"),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch package sizes for a category."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_package_sizes(
            cookie=x_vinted_cookie,
            catalog_id=catalog_id,
            item_id=item_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.get("/ontology/models")
def ontology_models(
    catalog_id: int = Query(..., description="Category/catalog ID"),
    brand_id: int = Query(..., description="Brand ID"),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch models for a luxury brand + category combination."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_models(
            cookie=x_vinted_cookie,
            catalog_id=catalog_id,
            brand_id=brand_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.get("/item/{item_id}")
def get_item_detail(
    item_id: int,
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Fetch full item detail."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_fetch_item_detail(
            cookie=x_vinted_cookie,
            item_id=item_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


# ─── Photo Upload & Mutation ─────────────────────────────────────────────────


@app.post("/upload")
async def upload_photo(
    file: UploadFile = File(..., description="Image file to upload"),
    relist_count: int = Form(0, description="Current relist count for mutation direction"),
    temp_uuid: Optional[str] = Form(None, description="Photo temp UUID"),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Mutate image via Pillow, then upload to Vinted. Returns photo metadata."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    try:
        raw_bytes = await file.read()
        mutated_bytes = mutate_image(raw_bytes, relist_count)

        data = vinted_upload_photo(
            cookie=x_vinted_cookie,
            image_bytes=mutated_bytes,
            temp_uuid=temp_uuid,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)
    except Exception as e:
        return _error_response("MUTATION_ERROR", f"Image mutation failed: {e}", 500)


@app.post("/upload-raw")
async def upload_photo_raw(
    file: UploadFile = File(..., description="Image file to upload (no mutation)"),
    temp_uuid: Optional[str] = Form(None, description="Photo temp UUID"),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Upload image to Vinted without any mutation. Returns photo metadata."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    try:
        raw_bytes = await file.read()
        data = vinted_upload_photo(
            cookie=x_vinted_cookie,
            image_bytes=raw_bytes,
            temp_uuid=temp_uuid,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)
    except Exception as e:
        return _error_response("UPLOAD_ERROR", f"Photo upload failed: {e}", 500)


@app.post("/preview-mutation")
async def preview_mutation(
    file: UploadFile = File(..., description="Image file to mutate"),
    relist_count: int = Form(0, description="Current relist count for mutation direction"),
):
    """
    Apply Pillow mutation to an image WITHOUT uploading to Vinted.
    Returns the mutated image bytes directly (JPEG).
    Used for generating preview thumbnails in the Waiting Room.
    """
    try:
        raw_bytes = await file.read()
        mutated_bytes = mutate_image(raw_bytes, relist_count)
        return Response(content=mutated_bytes, media_type="image/jpeg")
    except Exception as e:
        return _error_response("MUTATION_ERROR", f"Image mutation failed: {e}", 500)


# ─── Listing CRUD ────────────────────────────────────────────────────────────


@app.post("/listing")
def create_listing(
    body: dict = Body(...),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Create and publish a new listing."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    item_data = body.get("item_data", body)
    upload_session_id = body.get("upload_session_id")

    try:
        data = vinted_create_listing(
            cookie=x_vinted_cookie,
            item_data=item_data,
            upload_session_id=upload_session_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.put("/listing/{item_id}")
def update_listing(
    item_id: int,
    body: dict = Body(...),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """Edit an existing listing."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    item_data = body.get("item_data", body)
    upload_session_id = body.get("upload_session_id")

    try:
        data = vinted_edit_listing(
            cookie=x_vinted_cookie,
            item_id=item_id,
            item_data=item_data,
            upload_session_id=upload_session_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.post("/listing/{item_id}/delete")
def remove_listing(
    item_id: int,
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
):
    """Delete a live listing."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)
    try:
        data = vinted_delete_listing(
            cookie=x_vinted_cookie,
            item_id=item_id,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


@app.put("/listing/{item_id}/visibility")
def toggle_visibility(
    item_id: int,
    body: dict = Body(...),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
):
    """Hide or unhide a listing."""
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    is_hidden = body.get("is_hidden", True)
    try:
        data = vinted_hide_listing(
            cookie=x_vinted_cookie,
            item_id=item_id,
            hidden=is_hidden,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
        )
        return {"ok": True, "data": data}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)


# ─── Stealth Relist ──────────────────────────────────────────────────────────


@app.post("/relist")
async def relist(
    body: dict = Body(...),
    proxy: Optional[str] = Query(None),
    transport_mode: Optional[str] = Query(None),
    x_vinted_cookie: Optional[str] = Header(None, alias="X-Vinted-Cookie"),
    x_csrf_token: Optional[str] = Header(None, alias="X-Csrf-Token"),
    x_anon_id: Optional[str] = Header(None, alias="X-Anon-Id"),
    x_vinted_user_agent: Optional[str] = Header(None, alias="X-Vinted-User-Agent"),
):
    """
    Full stealth relist sequence:
      1. Mutate & upload images
      2. Delete old listing
      3. Wait 10s (delete-post jitter)
      4. Publish new listing with mutated text/images

    Body: {
      "old_item_id": int,
      "item_data": { title, description, price, ... },
      "image_urls": ["http://..."],    // Vinted CDN URLs (bridge will fetch & mutate)
      "image_bytes_b64": ["base64..."],// OR pre-encoded image bytes (from local cache)
      "relist_count": int
    }
    """
    if not x_vinted_cookie:
        return _error_response("MISSING_COOKIE", "X-Vinted-Cookie header required", 400)

    old_item_id = body.get("old_item_id")
    item_data = body.get("item_data", {})
    relist_count = body.get("relist_count", 0)

    if old_item_id is None:
        return _error_response("INVALID_BODY", "old_item_id required", 400)

    # Accept either base64-encoded bytes or raw bytes from image_bytes_b64
    import base64
    image_bytes_list: list[bytes] = []
    for b64 in body.get("image_bytes_b64", []):
        try:
            image_bytes_list.append(base64.b64decode(b64))
        except Exception:
            return _error_response("INVALID_BODY", "Invalid base64 in image_bytes_b64", 400)

    if not image_bytes_list:
        return _error_response("INVALID_BODY", "image_bytes_b64 required (list of base64 image strings)", 400)

    try:
        result = vinted_relist_item(
            cookie=x_vinted_cookie,
            old_item_id=int(old_item_id),
            item_data=item_data,
            image_bytes_list=image_bytes_list,
            relist_count=relist_count,
            csrf_token=x_csrf_token,
            anon_id=x_anon_id,
            proxy=proxy,
            transport_mode=transport_mode,
            user_agent=x_vinted_user_agent,
        )
        return {"ok": True, "data": result}
    except VintedError as e:
        return _error_response(e.code, e.message, e.status_code or 500)
    except Exception as e:
        return _error_response("RELIST_ERROR", f"Relist failed: {e}", 500)


# ─── Dual Brain / Ingest Endpoints ──────────────────────────────────────────

import sqlite3
import os
import json

@app.post("/ingest/wardrobe")
def ingest_wardrobe(body: dict = Body(...)):
    """Receives WardrobeSyncPayload from Extension and upserts to inventory_master."""
    items = body.get("items", [])
    if not items:
        return {"ok": True, "message": "No items to ingest"}
    
    db_path = os.environ.get("VINTED_DB_PATH")
    if not db_path:
        return _error_response("NO_DB", "VINTED_DB_PATH env var not set", 500)

    try:
        # Connect to DB. timeout controls busy waiting
        with sqlite3.connect(db_path, timeout=10.0) as conn:
            conn.execute("PRAGMA foreign_keys = ON;")
            cursor = conn.cursor()
            
            for item in items:
                vinted_id = item.get("id")
                if not vinted_id:
                    continue
                    
                title = item.get("title", "Untitled")
                
                # Best effort price parse
                price = 0.0
                currency = "GBP"
                price_data = item.get("price")
                if isinstance(price_data, dict):
                    try:
                        price = float(price_data.get("amount", 0))
                    except (ValueError, TypeError):
                        pass
                    currency = price_data.get("currency_code", "GBP")
                elif isinstance(item.get("price_numeric"), str):
                     try:
                         price = float(item.get("price_numeric"))
                     except (ValueError, TypeError):
                         pass
                elif isinstance(item.get("price_numeric"), (int, float)):
                     price = float(item.get("price_numeric"))

                # Extract photo URLs
                photos = item.get("photos", [])
                photo_urls = [p.get("url") for p in photos if isinstance(p, dict) and "url" in p]
                photo_urls_json = json.dumps(photo_urls) if photo_urls else "[]"

                cursor.execute("SELECT local_id FROM inventory_sync WHERE vinted_item_id = ?", (vinted_id,))
                row = cursor.fetchone()
                
                if row:
                    local_id = row[0]
                    cursor.execute('''
                        UPDATE inventory_master 
                        SET title = ?, price = ?, currency = ?, photo_urls = ?, updated_at = unixepoch()
                        WHERE id = ?
                    ''', (title, price, currency, photo_urls_json, local_id))
                    
                    cursor.execute('''
                        UPDATE inventory_sync 
                        SET last_synced_at = unixepoch()
                        WHERE local_id = ?
                    ''', (local_id,))
                else:
                    cursor.execute('''
                        INSERT INTO inventory_master (
                            title, price, currency, photo_urls, status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 'live', unixepoch(), unixepoch())
                    ''', (title, price, currency, photo_urls_json))
                    local_id = cursor.lastrowid
                    
                    cursor.execute('''
                        INSERT INTO inventory_sync (
                            local_id, vinted_item_id, sync_direction, last_synced_at, created_at
                        ) VALUES (?, ?, 'pull', unixepoch(), unixepoch())
                    ''', (local_id, vinted_id))
                    
            conn.commit()
            
        return {"ok": True, "message": f"Ingested {len(items)} items successfully."}
    except Exception as e:
        return _error_response("INGEST_ERROR", str(e), 500)

# ─── Deep Sync: single-item ingest from extension ──────────────────────────
@app.post("/ingest/item")
async def ingest_single_item(request: Request):
    """
    Receive a single item's full __NEXT_DATA__ from the extension (hq_sync=true mode).
    Updates the local inventory_master with deep fields: description, photos, brand, size, etc.
    """
    db_path = os.environ.get("VINTED_DB_PATH")
    if not db_path:
        return _error_response("NO_DB", "VINTED_DB_PATH env var not set", 500)

    try:
        body = await request.json()
        item = body.get("item", body)  # Accept both {item: {...}} and flat payload

        vinted_id = item.get("id")
        if not vinted_id:
            return _error_response("MISSING_ID", "Item payload must include 'id'", 400)

        with sqlite3.connect(db_path, timeout=10.0) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Find local mapping
            cursor.execute("SELECT local_id FROM inventory_sync WHERE vinted_item_id = ?", (vinted_id,))
            row = cursor.fetchone()

            if not row:
                return _error_response("NOT_FOUND", f"Vinted item {vinted_id} not linked to any local item", 404)

            local_id = row[0]

            # Extract deep fields
            title = item.get("title", "")
            description = item.get("description", "")

            # Price
            price = 0.0
            currency = "GBP"
            price_data = item.get("price")
            if isinstance(price_data, dict):
                price = float(price_data.get("amount", 0))
                currency = price_data.get("currency_code", "GBP")
            elif isinstance(item.get("price_numeric"), (str, int, float)):
                try:
                    price = float(item.get("price_numeric"))
                except (ValueError, TypeError):
                    pass

            # Photos
            photos = item.get("photos", [])
            photo_urls = [p.get("url") for p in photos if isinstance(p, dict) and "url" in p]
            photo_urls_json = json.dumps(photo_urls) if photo_urls else "[]"

            # Brand
            brand_data = item.get("brand_dto") or item.get("brand") or {}
            brand_id = brand_data.get("id") if isinstance(brand_data, dict) else None
            brand_name = brand_data.get("title") or brand_data.get("name") if isinstance(brand_data, dict) else None
            if brand_name is None and isinstance(item.get("brand_title"), str):
                brand_name = item.get("brand_title")

            # Size
            size_data = item.get("size") or {}
            size_id = size_data.get("id") if isinstance(size_data, dict) else item.get("size_id")
            size_label = size_data.get("title") or size_data.get("name") if isinstance(size_data, dict) else item.get("size_title")

            # Category
            category_id = item.get("catalog_id") or item.get("category_id")

            # Condition
            condition = item.get("status") or item.get("condition")
            if isinstance(condition, dict):
                condition = condition.get("title") or condition.get("name")

            # Colors
            colors = item.get("color1") or item.get("colors") or item.get("color_ids")
            if isinstance(colors, list):
                color_ids_json = json.dumps([c.get("id") if isinstance(c, dict) else c for c in colors])
            elif isinstance(colors, dict):
                color_ids_json = json.dumps([colors.get("id")])
            else:
                color_ids_json = None

            # Package size
            package_size_id = item.get("package_size_id")

            # Update the master record with all deep fields
            cursor.execute('''
                UPDATE inventory_master SET
                    title = ?,
                    description = ?,
                    price = ?,
                    currency = ?,
                    photo_urls = ?,
                    brand_id = COALESCE(?, brand_id),
                    brand_name = COALESCE(?, brand_name),
                    size_id = COALESCE(?, size_id),
                    size_label = COALESCE(?, size_label),
                    category_id = COALESCE(?, category_id),
                    condition = COALESCE(?, condition),
                    color_ids = COALESCE(?, color_ids),
                    package_size_id = COALESCE(?, package_size_id),
                    updated_at = unixepoch()
                WHERE id = ?
            ''', (
                title, description, price, currency, photo_urls_json,
                brand_id, brand_name,
                size_id, size_label,
                category_id,
                condition,
                color_ids_json,
                package_size_id,
                local_id
            ))

            # Update sync record
            cursor.execute('''
                UPDATE inventory_sync
                SET last_synced_at = unixepoch(), sync_direction = 'deep_pull'
                WHERE local_id = ?
            ''', (local_id,))

            conn.commit()

        return {"ok": True, "message": f"Deep sync complete for vinted item {vinted_id} (local_id={local_id})."}
    except Exception as e:
        return _error_response("DEEP_SYNC_ERROR", str(e), 500)

@app.get("/items/{item_id}")
def get_local_item(item_id: int):
    """Fetch local item data from inventory_master acting as the source of truth for the extension."""
    db_path = os.environ.get("VINTED_DB_PATH")
    if not db_path:
        return _error_response("NO_DB", "VINTED_DB_PATH env var not set", 500)
    
    try:
        with sqlite3.connect(db_path, timeout=10.0) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT m.title, m.description, m.price, m.currency, m.condition
                FROM inventory_master m
                JOIN inventory_sync s ON m.id = s.local_id
                WHERE s.vinted_item_id = ?
            ''', (item_id,))
            row = cursor.fetchone()
            
            if not row:
                return _error_response("NOT_FOUND", f"Item {item_id} not found in local DB", 404)
            
            return {"ok": True, "data": dict(row)}
    except Exception as e:
        return _error_response("DB_ERROR", str(e), 500)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=37421, log_level="info")

