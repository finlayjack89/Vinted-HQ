# Python Bridge

Local HTTP server for stealth requests to Vinted using `curl_cffi` (browser-like TLS fingerprints). Phase 2 implementation.

## Setup

```bash
cd python-bridge
python3 -m venv venv
source venv/bin/activate   # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

## Run Standalone (for testing)

```bash
python server.py
# Or: uvicorn server:app --host 127.0.0.1 --port 37421
```

Then open http://127.0.0.1:37421/health — you should see `{"ok":true,"service":"vinted-sniper-bridge"}`.

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Health check |
| GET | `/search?url=...&page=1&proxy=...` | Fetch catalog items (cookie in `X-Vinted-Cookie`) |
| POST | `/checkout/build` | Initiate checkout (body: `{ "order_id": 12345 }`) |
| PUT | `/checkout/{purchase_id}` | Checkout step (body: `{ "components": {...} }`) |
| GET | `/checkout/nearby_pickup_points?shipping_order_id=...&latitude=...&longitude=...` | Drop-off points |

All endpoints support `base_interval` and `jitter` query params for rate limiting. Proxy URLs: `http://`, `https://`, `socks5://`.

## Integration Test

```bash
export VINTED_COOKIE="your_cookie_string"
python test_integration.py
```

Or: `python test_integration.py --cookie "your_cookie_string"`

## Run via Electron

The Electron app spawns this server automatically on startup. Ensure `python3` is in your PATH.
