#!/usr/bin/env python3
"""
Vinted UK Sniper — Python Bridge
Local HTTP server for Electron to call. Uses curl_cffi for stealth requests.
"""

import io
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, Form, Header, Query, Body, UploadFile
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

# Allow Electron renderer to call this local bridge server.
# Restricted to localhost origins to prevent credential theft via malicious webpages.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        "app://.",
        "file://",
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


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=37421, log_level="info")
