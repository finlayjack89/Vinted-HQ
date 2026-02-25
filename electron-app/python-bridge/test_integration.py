#!/usr/bin/env python3
"""
Integration tests for Vinted Python bridge.
Run against real Vinted with a valid cookie.

Usage:
  export VINTED_COOKIE="your_cookie_string"
  python test_integration.py

Or:
  python test_integration.py --cookie "your_cookie_string"
"""

import argparse
import os
import sys

# Add parent for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from curl_cffi import requests


def main():
    parser = argparse.ArgumentParser(description="Test Vinted bridge against live API")
    parser.add_argument(
        "--cookie",
        default=os.environ.get("VINTED_COOKIE"),
        help="Vinted cookie string (or set VINTED_COOKIE env)",
    )
    parser.add_argument(
        "--base",
        default="http://127.0.0.1:37421",
        help="Bridge base URL",
    )
    parser.add_argument(
        "--no-start",
        action="store_true",
        help="Assume bridge is already running (default: start it)",
    )
    args = parser.parse_args()

    if not args.cookie:
        print("Error: No cookie. Set VINTED_COOKIE or pass --cookie")
        sys.exit(1)

    base = args.base.rstrip("/")
    headers = {"X-Vinted-Cookie": args.cookie}

    # 1. Health check
    print("1. Health check...")
    try:
        r = requests.get(f"{base}/health", timeout=5)
        r.raise_for_status()
        data = r.json()
        assert data.get("ok") is True
        print("   OK:", data)
    except requests.exceptions.ConnectionError:
        print("   FAIL: Bridge not running. Start with: python server.py")
        sys.exit(1)
    except Exception as e:
        print("   FAIL:", e)
        sys.exit(1)

    # 2. Search (catalog URL)
    test_url = "https://www.vinted.co.uk/catalog?search_text=hermes&order=newest_first"
    print(f"2. Search: {test_url[:60]}...")
    try:
        r = requests.get(
            f"{base}/search",
            params={"url": test_url, "page": 1},
            headers=headers,
            timeout=30,
        )
        data = r.json()
        if not data.get("ok"):
            print("   FAIL:", data.get("code"), data.get("message"))
            sys.exit(1)
        items = data.get("data", {})
        # Catalog response structure may vary
        if "items" in items:
            print(f"   OK: {len(items['items'])} items")
        elif "catalog" in items:
            print(f"   OK: catalog response")
        else:
            print("   OK: response keys:", list(items.keys())[:10])
    except Exception as e:
        print("   FAIL:", e)
        sys.exit(1)

    print("\nAll integration tests passed.")

if __name__ == "__main__":
    main()
