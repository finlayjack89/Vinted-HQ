import json
import sqlite3
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

def test_payload(payload):
    print(f"Testing payload: {json.dumps(payload)}")
    headers = {
        "cookie": cookie,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json"
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

print("\n--- Testing 1904 (Clothing) ---")
test_payload({"attributes": [{"code": "category", "value": [1904]}]})

print("\n--- Testing 158 (Handbags) ---")
test_payload({"attributes": [{"code": "category", "value": [158]}]})
