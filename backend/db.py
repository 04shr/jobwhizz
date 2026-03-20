"""
JobWhiz Lab — DB Helper
Shared database connection used by all route modules.
"""

import os
import ssl
import pymysql
import pymysql.cursors
from dotenv import load_dotenv


def get_ssl_context():
    ca_content = os.getenv("DB_SSL_CA")
    if not ca_content:
        return None
    # Normalize escaped newlines that some secret managers inject
    ca_content = ca_content.replace("\\n", "\n").strip()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.load_verify_locations(cadata=ca_content)
    return ctx


def get_db():
    ssl_ctx = get_ssl_context()
    return pymysql.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
        ssl={"ssl": ssl_ctx} if ssl_ctx else None,
    )


def query(sql, params=None):
    conn   = get_db()
    cursor = conn.cursor()
    cursor.execute(sql, params or [])
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return rows