import sqlite3

def get_cookie():
    db = sqlite3.connect('/Users/finlaysalisbury/Library/Application Support/Vinted UK Sniper/vinted.db')
    cursor = db.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'vinted_cookie_enc'")
    row = cursor.fetchone()
    # The actual cookies are encrypted, they can't be read using standard sqlite3 without electron safeStorage.
    return row[0] if row else ""

print(get_cookie()[:50])
