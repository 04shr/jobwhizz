from backend.db import get_db

conn = get_db()
print("✅ Connected successfully!")

cursor = conn.cursor()
cursor.execute("SHOW TABLES;")
print(cursor.fetchall())

conn.close()