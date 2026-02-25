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

## Build a macOS DMG (installed app)

Build distributables (DMG + ZIP) on macOS:

```bash
npm install
npm run make
```

Artifacts are written to `out/make/` (example):

- `out/make/Vinted UK Sniper-0.1.0-arm64.dmg`
- `out/make/zip/darwin/arm64/Vinted UK Sniper-darwin-arm64-0.1.0.zip`

### Install

1. Open the `.dmg`
2. Drag `Vinted UK Sniper.app` into `/Applications`
3. Launch from Spotlight / Launchpad / Dock

If macOS blocks the app (unsigned build), right-click the app → **Open** once. If it was quarantined, you can also run:

```bash
xattr -cr "/Applications/Vinted UK Sniper.app"
```

## Keeping it up to date while developing (Cursor)

- **Fast dev loop**: run `npm start` while coding (no DMG needed).
- **Test the installed build**:
  - `npm run make`
  - Replace the app in `/Applications` with the newly built one from the DMG

Tip: bump `version` in `package.json` when you want releases to sort/compare cleanly.

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

## Future: public sharing + monetization

If you want other people to download/install this from a website link without scary macOS warnings, you will need:

- **Apple Developer Program** membership (to create “Developer ID” signing certs)
- **Code signing + notarization** (so Gatekeeper trusts your app)

When you’re ready, the next repo changes are typically:

- Add `packagerConfig.osxSign` and `packagerConfig.osxNotarize` to `forge.config.ts`
- Use CI (GitHub Actions, etc.) to build + notarize and then upload artifacts (DMG + ZIP) to your website/storage

### Future: auto-updates

macOS auto-updates generally require **signed builds** and a **ZIP** update artifact (you already generate ZIPs). You can host update files on S3/GCS/GitHub Releases or a custom update server, then wire Electron’s update mechanism to point at that feed.
