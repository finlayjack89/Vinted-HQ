import json
import sqlite3
import base64
from curl_cffi import requests as cffi_requests

def get_cookie():
    db = sqlite3.connect('/Users/finlaysalisbury/Library/Application Support/Vinted UK Sniper/vinted.db')
    cursor = db.cursor()
    cursor.execute("SELECT cookie FROM _auth_session LIMIT 1")
    row = cursor.fetchone()
    return row[0] if row else ""

try:
    cookie = get_cookie()
except:
    cookie = ""

def get_csrf_from_cookie(cookie_str):
    for part in cookie_str.split(';'):
        part = part.strip()
        if part.startswith('access_token_web='):
            token = part.split('=', 1)[1]
            segments = token.split('.')
            if len(segments) >= 2:
                payload_b64 = segments[1].replace('-', '+').replace('_', '/')
                # Add padding
                payload_b64 += '=' * (-len(payload_b64) % 4)
                try:
                    payload = json.loads(base64.b64decode(payload_b64).decode('utf-8'))
                    return payload.get('csrf_token') or payload.get('csrf')
                except Exception as e:
                    print(f"Error decoding JWT: {e}")
    return None

import urllib.parse
def get_csrf_from_cookie_2(cookie_str):
    for part in cookie_str.split(';'):
        part = part.strip()
        if part.startswith('secure_access_token_web='):
            # sometimes vinted has it here
            pass

csrf_token = get_csrf_from_cookie(cookie)
print(f"Extracted CSRF: {csrf_token}")

def test_payload(payload):
    print(f"Testing payload: {json.dumps(payload)}")
    headers = {
        "cookie": cookie,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "x-csrf-token": csrf_token or "123"
    }
    resp = cffi_requests.post(
        "https://www.vinted.co.uk/api/v2/item_upload/attributes",
        headers=headers,
        json=payload,
        impersonate="chrome120"
    )
    if resp.status_code == 200:
        data = resp.json()
        attrs = data.get("attributes", [])
        print(f"Total attributes returned: {len(attrs)}")
        codes = [a.get("code") for a in attrs]
        print(f"Attribute codes: {codes}")
        for a in attrs:
            if a.get("code") == "material":
                opts = a.get("configuration", {}).get("options", [])
                print(f"Found materials configuration!")
                return True
        print("Success, but no materials found in response.")
    else:
        print(f"Failed: {resp.status_code}")
    return False

print("\n--- Testing 158 (Handbags) ---")
test_payload({"attributes": [{"code": "category", "value": [158]}]})
