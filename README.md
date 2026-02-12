# Vinted UK Sniper

Desktop app for real-time Vinted UK monitoring and automated purchasing.

## Phase 0 Complete ✓

- Electron + Vite + React + TypeScript scaffold
- SQLite ready (sql.js)
- Python bridge scaffold (FastAPI + curl_cffi)
- API reference & checkout flow doc templates

## Quick Start

```bash
# Install dependencies
npm install

# Install Python bridge deps (optional, for Phase 2+)
cd python-bridge && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

# Run the app
npm start
```

## Proxies (Required for Vinted)

The app uses proxies to avoid bot detection. Configure in **Settings → Proxies**:

- **Format:** `http://user:pass@host:port` or `socks5://user:pass@host:port`
- **Residential proxies** are recommended
- **Rotation:** One proxy per search URL (first proxy ↔ first URL, etc.); round-robin when more URLs than proxies
- **Sticky proxy:** The same proxy used to fetch an item is used for its entire checkout sequence

## Next Steps

1. **Fill out API docs** — Open vinted.co.uk and document the Network tab in `docs/VINTED_API_REFERENCE.md`
2. **Document checkout** — Perform a test purchase and record the flow in `docs/CHECKOUT_FLOW.md`

See `docs/IMPLEMENTATION_PLAN.md` for the full roadmap.
