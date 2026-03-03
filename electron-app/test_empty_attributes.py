import sqlite3
import json

db_path = "master.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT name, extra FROM vinted_ontology WHERE entity_type='category_attributes' LIMIT 1")
row = cursor.fetchone()
print("ROWS: ", row)

