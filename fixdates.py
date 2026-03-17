"""
fix_dates.py — One-time script to backfill real date_posted values from Adzuna API
Run: python fix_dates.py
"""

import os
import requests
import mysql.connector
from datetime import datetime
from dotenv import load_dotenv
import time

load_dotenv()

ADZUNA_APP_ID  = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY")

conn = mysql.connector.connect(
    host     = os.getenv("DB_HOST", "localhost"),
    port     = int(os.getenv("DB_PORT", 3306)),
    user     = os.getenv("DB_USER", "root"),
    password = os.getenv("DB_PASSWORD", ""),
    database = os.getenv("DB_NAME", "joblens")
)
cursor = conn.cursor()

queries = [
    {"what": "data analyst",             "where": "india"},
    {"what": "data scientist",           "where": "india"},
    {"what": "data engineer",            "where": "india"},
    {"what": "business analyst",         "where": "india"},
    {"what": "machine learning engineer","where": "india"},
]

updated = 0
not_found = 0

for q in queries:
    print(f"\n→ Fetching '{q['what']}'...")
    for page in range(1, 3):  # 2 pages = 100 jobs per query
        try:
            r = requests.get(
                f"https://api.adzuna.com/v1/api/jobs/in/search/{page}",
                params={
                    "app_id":           ADZUNA_APP_ID,
                    "app_key":          ADZUNA_APP_KEY,
                    "what":             q["what"],
                    "where":            q["where"],
                    "results_per_page": 50,
                    "sort_by":          "date",
                },
                timeout=30
            )
            r.raise_for_status()
            jobs = r.json().get("results", [])

            for job in jobs:
                ext_id   = str(job.get("id", ""))
                raw_date = job.get("created", "")
                if not raw_date:
                    continue
                try:
                    date_posted = datetime.fromisoformat(
                        raw_date.replace("Z", "+00:00")
                    ).date()
                except Exception as e:
                    print(f"  Parse error for {ext_id}: {e}")
                    continue

                cursor.execute(
                    "UPDATE jobs SET date_posted = %s WHERE external_id = %s",
                    (date_posted, ext_id)
                )
                if cursor.rowcount:
                    updated += 1
                else:
                    not_found += 1

            time.sleep(1)

        except Exception as e:
            print(f"  API error: {e}")

conn.commit()
cursor.close()
conn.close()

print(f"\n✅ Done — {updated} rows updated, {not_found} external_ids not matched in DB")