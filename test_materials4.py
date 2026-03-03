import sqlite3
import base64
import json

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

for part in cookie.split(';'):
    part = part.strip()
    if part.startswith('access_token_web='):
        token = part.split('=', 1)[1]
        segments = token.split('.')
        if len(segments) >= 2:
            payload_b64 = segments[1].replace('-', '+').replace('_', '/')
            payload_b64 += '=' * (-len(payload_b64) % 4)
            print("JWT Payload:", base64.b64decode(payload_b64).decode('utf-8'))
