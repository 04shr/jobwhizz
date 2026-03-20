"""
JobWhiz Lab — DB Helper
Shared database connection used by all route modules.
"""

import os
import pymysql
import pymysql.cursors
from dotenv import load_dotenv
import tempfile

def get_ssl_config():
    ca_content = os.getenv("DB_SSL_CA")

    if ca_content:
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.write(ca_content.encode())
        tmp.close()
        return {"ca": tmp.name}

    return None

def get_db():
    return pymysql.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
        ssl=get_ssl_config()
    )


def query(sql, params=None):
    conn   = get_db()
    cursor = conn.cursor()
    cursor.execute(sql, params or [])
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return rows