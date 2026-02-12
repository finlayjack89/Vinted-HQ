# Python Bridge

Local HTTP server for stealth requests to Vinted using `curl_cffi` (browser-like TLS fingerprints).

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

## Run via Electron

The Electron app spawns this server automatically on startup. Ensure `python3` is in your PATH.
