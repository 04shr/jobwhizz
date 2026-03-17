"""
JobWhiz Lab — DB Helper
Shared database connection used by all route modules.
"""

import os
import pymysql
import pymysql.cursors
from dotenv import load_dotenv

load_dotenv()


def get_db():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "railway"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False
    )


def query(sql, params=None):
    conn   = get_db()
    cursor = conn.cursor()
    cursor.execute(sql, params or [])
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return rows