# Vinted UK Sniper — E2E Testing Guide

**Last Updated:** 12 Feb 2026

This document describes how to test the app end-to-end against live Vinted.

---

## Prerequisites

- Valid Vinted UK account
- Chrome (for extracting cookies)
- Python 3 with venv for the bridge

---

## 1. Authenticate

1. Open [vinted.co.uk](https://www.vinted.co.uk) in Chrome and log in.
2. DevTools → Application → Cookies → `https://www.vinted.co.uk`
3. Copy the full cookie string (or use "Copy as cURL" from a request and extract the Cookie header).
4. In the app: Settings → paste cookie into the Session box → Save session.
5. Verify "✓ Connected" appears.

---

## 2. Add Search URL

1. In Vinted, perform a search (e.g. "hermes kelly").
2. Copy the catalog URL from the address bar (e.g. `https://www.vinted.co.uk/catalog?search_text=hermes%20kelly&order=newest_first`).
3. In the app: Settings → Search URLs → paste URL → Add.
4. Ensure the URL is enabled (checkbox checked).

---

## 3. Feed Polling

1. Go to Feed tab.
2. Wait a few seconds. Items should appear.
3. If no items: check Python bridge is running (console should show `[Python Bridge]`), verify cookie is valid.

---

## 4. Simulation Mode (Recommended First)

1. Settings → ensure **Simulation mode** is ON.
2. Settings → ensure **Enable autobuy** is ON.
3. Add a Sniper: name "Test", max £500, keywords "hermes", budget £100.
4. Enable the sniper (checkbox).
5. When a matching item appears, a 3s countdown should show.
6. Let it complete — you should see "Would have bought" toast (no real purchase).
7. Check Logs tab for `sniper:would-have-bought` entry.

---

## 5. One-Click Buy (Manual)

1. In Feed, expand an item and click **Buy Now**.
2. Follow the checkout flow. If 3DS is required, approve in your banking app.
3. Check Purchases tab for the completed purchase.

---

## 6. Live Autobuy (Use With Caution)

1. **Turn off Simulation mode** in Settings.
2. Ensure you have a saved card on Vinted.
3. Enable autobuy and a sniper with a sensible budget.
4. When a match occurs, the 3s countdown will run and a real purchase will be attempted.
5. Monitor Purchases and Logs for results.

---

## Known Issues to Document

- **Session expiry:** If you see "Session expired" banner, re-paste your cookie.
- **Python bridge:** If feed is empty, check `python-bridge` is running: `cd python-bridge && python3 server.py`.
- **Rate limiting:** The app retries on RATE_LIMITED with exponential backoff. If you hit limits, increase polling interval.
- **3DS:** If your bank requires 3DS, the app opens the browser. Complete the flow there; the purchase may take a moment to confirm.

---

## Regression Checklist

- [ ] Cookie storage and retrieval
- [ ] Search URL add/remove/toggle
- [ ] Feed shows items
- [ ] Buy Now completes (or fails gracefully)
- [ ] Sniper match triggers countdown
- [ ] Simulation mode logs only
- [ ] Session expiry shows banner + modal
- [ ] Logs viewer shows entries
- [ ] Purchases viewer shows history
