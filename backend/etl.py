"""
JobWhiz Lab — ETL Pipeline (Adzuna)
Extract → Transform → Load
Includes: auto cleanup of old jobs to save storage
"""

import os
import re
import time
import logging
import requests
import pymysql
import pymysql.cursors
from datetime import datetime
from dotenv import load_dotenv
import tempfile

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger(__name__)

ADZUNA_APP_ID  = os.getenv("ADZUNA_APP_ID", "")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY", "")
ADZUNA_BASE    = "https://api.adzuna.com/v1/api"

def get_ssl_config():
    ca_content = os.getenv("DB_SSL_CA")

    if ca_content:
        ca_content = ca_content.replace("\\n", "\n")
        temp = tempfile.NamedTemporaryFile(delete=False)
        temp.write(ca_content.encode())
        temp.close()
        return {"ca": temp.name}
    else:
        return {"ca": "ca.pem"}  # local fallback

# ── DATABASE CONNECTION ───────────────────────────────────────────
def get_db_connection():
    return pymysql.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
        ssl={"ca": "ca.pem"}
    )


# ── CLEANUP: Delete old jobs to save storage ──────────────────────
def delete_old_jobs(days_to_keep: int = 30):
    conn   = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            DELETE js FROM job_skills js
            JOIN jobs j ON js.job_id = j.id
            WHERE j.date_posted < DATE_SUB(CURDATE(), INTERVAL %s DAY)
        """, (days_to_keep,))
        skills_deleted = cursor.rowcount

        cursor.execute("""
            DELETE FROM jobs
            WHERE date_posted < DATE_SUB(CURDATE(), INTERVAL %s DAY)
        """, (days_to_keep,))
        jobs_deleted = cursor.rowcount

        conn.commit()
        log.info(f"Cleanup: removed {jobs_deleted} old jobs + {skills_deleted} skill mappings (>{days_to_keep} days old)")
    except Exception as e:
        conn.rollback()
        log.error(f"Cleanup failed: {e}")
    finally:
        cursor.close()
        conn.close()


# ── SALARY LOOKUP (Adzuna histogram endpoint) ─────────────────────
_salary_cache = {}

def get_salary_estimate(job_title_keyword):
    key = job_title_keyword.lower()
    if key in _salary_cache:
        return _salary_cache[key]
    try:
        url = f"{ADZUNA_BASE}/jobs/in/histogram"
        r = requests.get(url, params={
            "app_id":  ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "what":    job_title_keyword,
        }, timeout=15)
        r.raise_for_status()
        data = r.json()
        histogram = data.get("histogram", {})
        if not histogram:
            return None, None, None
        buckets = sorted([(int(k), v) for k, v in histogram.items() if v > 0])
        total   = sum(v for _, v in buckets)
        if total == 0:
            return None, None, None
        weighted_sum = sum(k * v for k, v in buckets)
        avg_inr = weighted_sum / total
        min_inr = buckets[0][0]
        max_inr = buckets[-1][0]
        def to_lpa(val):
            return round(val / 100000, 1)
        result = (to_lpa(avg_inr), to_lpa(min_inr), to_lpa(max_inr))
        _salary_cache[key] = result
        log.info(f"Salary for '{job_title_keyword}': avg={result[0]}L min={result[1]}L max={result[2]}L")
        time.sleep(0.5)
        return result
    except Exception as e:
        log.warning(f"Salary lookup failed for '{job_title_keyword}': {e}")
        return None, None, None


# ── ROLE → SALARY KEYWORD MAPPING ────────────────────────────────
ROLE_SALARY_MAP = {
    "data analyst":        "data analyst",
    "senior data analyst": "senior data analyst",
    "data scientist":      "data scientist",
    "data engineer":       "data engineer",
    "ml engineer":         "machine learning engineer",
    "business analyst":    "business analyst",
    "bi analyst":          "business intelligence analyst",
    "analytics engineer":  "analytics engineer",
}

def get_salary_keyword(title):
    t = title.lower()
    for role, keyword in ROLE_SALARY_MAP.items():
        if role in t:
            return keyword
    return "data analyst"


# ── EXTRACT ───────────────────────────────────────────────────────
def extract_jobs(what="data analyst", where="india", num_pages=2):
    if not ADZUNA_APP_ID or not ADZUNA_APP_KEY:
        log.info("No Adzuna credentials — using mock data")
        return _mock_jobs()
    all_jobs = []
    for page in range(1, num_pages + 1):
        log.info(f"Fetching page {page} for '{what}' in '{where}'")
        try:
            url = f"{ADZUNA_BASE}/jobs/in/search/{page}"
            r = requests.get(url, params={
                "app_id":           ADZUNA_APP_ID,
                "app_key":          ADZUNA_APP_KEY,
                "what":             what,
                "where":            where,
                "results_per_page": 50,
                "content-type":     "application/json",
                "sort_by":          "date",
            }, timeout=30)
            r.raise_for_status()
            jobs = r.json().get("results", [])
            all_jobs.extend(jobs)
            log.info(f"  Got {len(jobs)} jobs (total so far: {len(all_jobs)})")
            time.sleep(1)
        except Exception as e:
            log.error(f"API error on page {page}: {e}")
    return all_jobs


# ── TRANSFORM ─────────────────────────────────────────────────────
KNOWN_SKILLS = [
    "python", "r", "scala", "java", "javascript",
    "sql", "mysql", "postgresql", "mongodb", "snowflake",
    "bigquery", "redshift", "power bi", "tableau", "looker",
    "excel", "matplotlib", "plotly", "aws", "azure", "gcp",
    "databricks", "machine learning", "deep learning", "nlp",
    "tensorflow", "pytorch", "scikit-learn", "spark", "kafka",
    "airflow", "dbt", "pandas", "numpy", "hadoop", "pyspark",
    "docker", "kubernetes", "git", "fastapi", "flask", "statistics"
]

CITY_NORMALIZE = {
    "bengaluru":   "Bangalore",
    "bangalore":   "Bangalore",
    "delhi":       "Delhi NCR",
    "new delhi":   "Delhi NCR",
    "gurugram":    "Delhi NCR",
    "gurgaon":     "Delhi NCR",
    "noida":       "Delhi NCR",
    "mumbai":      "Mumbai",
    "bombay":      "Mumbai",
    "navi mumbai": "Mumbai",
    "hyderabad":   "Hyderabad",
    "pune":        "Pune",
    "chennai":     "Chennai",
    "kolkata":     "Kolkata",
    "ahmedabad":   "Ahmedabad",
    "kochi":       "Kochi",
    "coimbatore":  "Coimbatore",
}

def extract_skills_from_text(text):
    text_lower = text.lower()
    found = []
    for skill in KNOWN_SKILLS:
        pattern = r'\b' + re.escape(skill) + r'\b'
        if re.search(pattern, text_lower):
            found.append(skill.title() if len(skill) > 2 else skill.upper())
    return found

def normalize_city(raw_city):
    if not raw_city:
        return ""
    key = raw_city.lower().strip()
    return CITY_NORMALIZE.get(key, raw_city.strip().title())

def extract_experience_from_description(text):
    patterns = [
        r'(\d+)\s*[-to]+\s*(\d+)\s*years?',
        r'(\d+)\+\s*years?',
        r'minimum\s+(\d+)\s*years?',
        r'at least\s+(\d+)\s*years?',
        r'(\d+)\s*years?\s+experience',
    ]
    for pat in patterns:
        m = re.search(pat, text.lower())
        if m:
            groups = m.groups()
            exp_min = int(groups[0])
            exp_max = int(groups[1]) if len(groups) > 1 and groups[1] else exp_min + 2
            return exp_min, exp_max
    return 0, 0

def transform_job(raw, salary_cache_by_role):
    title   = (raw.get("title") or "").strip()
    company = (raw.get("company") or {}).get("display_name", "").strip()
    if not title or not company:
        return None
    loc_obj  = raw.get("location") or {}
    area     = loc_obj.get("area", [])
    raw_city = area[-1] if area else ""
    city     = normalize_city(raw_city)
    country  = "IN"
    location = f"{city}, {country}" if city else country
    category    = (raw.get("category") or {}).get("label", "IT Jobs")
    description = (raw.get("description") or "").strip()
    skills      = extract_skills_from_text(description + " " + title)
    exp_min, exp_max = extract_experience_from_description(description)
    sal_keyword = get_salary_keyword(title)
    sal_avg, sal_min, sal_max = salary_cache_by_role.get(sal_keyword, (None, None, None))
    raw_date = raw.get("created", "")
    try:
        date_posted = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).date()
    except Exception:
        date_posted = datetime.today().date()
    return {
        "external_id":     str(raw.get("id", "")),
        "title":           title,
        "company":         company,
        "location":        location,
        "city":            city,
        "country":         country,
        "category":        category,
        "salary_max":      sal_max,
        "salary_avg":      sal_avg,
        "employment_type": "FULLTIME",
        "experience_min":  exp_min,
        "experience_max":  exp_max,
        "description":     description,
        "date_posted":     date_posted,
        "redirect_url":    raw.get("redirect_url", ""),
        "source":          "adzuna",
        "skills":          skills,
    }

def transform_all(raw_jobs, salary_cache_by_role):
    results, skipped = [], 0
    for raw in raw_jobs:
        r = transform_job(raw, salary_cache_by_role)
        if r:
            results.append(r)
        else:
            skipped += 1
    log.info(f"Transform done: {len(results)} valid, {skipped} skipped")
    return results


# ── LOAD ──────────────────────────────────────────────────────────
def get_or_create_skill(cursor, skill_name):
    cursor.execute("SELECT id FROM skills WHERE skill_name = %s", (skill_name,))
    row = cursor.fetchone()
    if row:
        return row["id"]   # pymysql DictCursor returns dicts
    cursor.execute("INSERT IGNORE INTO skills (skill_name) VALUES (%s)", (skill_name,))
    return cursor.lastrowid

def load_all(jobs):
    conn   = get_db_connection()
    cursor = conn.cursor()
    inserted = duplicates = errors = 0
    try:
        for job in jobs:
            try:
                skills = job.pop("skills", [])
                cursor.execute("""
                    INSERT IGNORE INTO jobs (
                        external_id, title, company, location, city, country,
                        salary_max, salary_avg,
                        employment_type, experience_min, experience_max,
                        description, date_posted, redirect_url, source
                    ) VALUES (
                        %(external_id)s, %(title)s, %(company)s, %(location)s,
                        %(city)s, %(country)s, %(salary_max)s,
                        %(salary_avg)s, %(employment_type)s, %(experience_min)s,
                        %(experience_max)s, %(description)s, %(date_posted)s,
                        %(redirect_url)s, %(source)s
                    )
                """, job)
                if cursor.rowcount == 0:
                    duplicates += 1
                    continue
                job_id = cursor.lastrowid
                for skill_name in skills:
                    skill_id = get_or_create_skill(cursor, skill_name)
                    if skill_id:
                        cursor.execute(
                            "INSERT IGNORE INTO job_skills (job_id, skill_id) VALUES (%s, %s)",
                            (job_id, skill_id)
                        )
                inserted += 1
            except Exception as e:
                log.error(f"Error on '{job.get('title')}': {e}")
                errors += 1
        conn.commit()
        log.info(f"Load done: {inserted} inserted, {duplicates} duplicates, {errors} errors")
    except Exception as e:
        conn.rollback()
        log.error(f"Transaction failed: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


# ── ORCHESTRATOR ──────────────────────────────────────────────────
def run_etl():
    log.info("=" * 55)
    log.info("  JOBWHIZ LAB — ETL STARTING (Adzuna)")
    log.info("=" * 55)

    log.info("\n→ Cleaning up old jobs...")
    delete_old_jobs(days_to_keep=30)

    log.info("\n→ Pre-fetching salary benchmarks from Adzuna histogram...")
    salary_roles = list(set(ROLE_SALARY_MAP.values()))
    salary_cache = {}
    for role_kw in salary_roles:
        avg, mn, mx = get_salary_estimate(role_kw)
        salary_cache[role_kw] = (avg, mn, mx)
        log.info(f"  {role_kw}: avg={avg}L  min={mn}L  max={mx}L")

    queries = [
        {"what": "data analyst",              "where": "india"},
        {"what": "data scientist",            "where": "india"},
        {"what": "data engineer",             "where": "india"},
        {"what": "business analyst",          "where": "india"},
        {"what": "machine learning engineer", "where": "india"},
    ]
    for q in queries:
        log.info(f"\n→ '{q['what']}' in '{q['where']}'")
        raw   = extract_jobs(q["what"], q["where"], num_pages=2)
        clean = transform_all(raw, salary_cache)
        if clean:
            load_all(clean)

    log.info("\n" + "=" * 55)
    log.info("  ETL COMPLETE")
    log.info("=" * 55)


# ── MOCK DATA (fallback if no API key) ────────────────────────────
def _mock_jobs():
    return [
        {"id": "mock_001", "title": "Data Analyst", "company": {"display_name": "Flipkart"},
         "location": {"area": ["India", "Karnataka", "Bangalore"]}, "category": {"label": "IT Jobs"},
         "description": "Data Analyst with Python, SQL, Power BI, Tableau, MySQL, Excel.",
         "created": "2025-01-15T10:00:00Z", "redirect_url": ""},
        {"id": "mock_002", "title": "Senior Data Analyst", "company": {"display_name": "Swiggy"},
         "location": {"area": ["India", "Karnataka", "Bangalore"]}, "category": {"label": "IT Jobs"},
         "description": "Senior Data Analyst. Python, SQL, Spark, Airflow, AWS, machine learning.",
         "created": "2025-01-20T10:00:00Z", "redirect_url": ""},
        {"id": "mock_003", "title": "Data Scientist", "company": {"display_name": "Meesho"},
         "location": {"area": ["India", "Karnataka", "Bangalore"]}, "category": {"label": "IT Jobs"},
         "description": "Data Scientist with Python, TensorFlow, PyTorch, SQL, Scikit-learn, NLP.",
         "created": "2025-01-22T10:00:00Z", "redirect_url": ""},
        {"id": "mock_004", "title": "Data Engineer", "company": {"display_name": "Razorpay"},
         "location": {"area": ["India", "Karnataka", "Bangalore"]}, "category": {"label": "IT Jobs"},
         "description": "Data Engineer with Python, Spark, Kafka, Airflow, AWS, SQL, Databricks.",
         "created": "2025-01-21T10:00:00Z", "redirect_url": ""},
        {"id": "mock_005", "title": "ML Engineer", "company": {"display_name": "PhonePe"},
         "location": {"area": ["India", "Karnataka", "Bangalore"]}, "category": {"label": "IT Jobs"},
         "description": "ML Engineer with Python, TensorFlow, PyTorch, Deep Learning, NLP, AWS.",
         "created": "2025-01-24T10:00:00Z", "redirect_url": ""},
        {"id": "mock_006", "title": "BI Analyst", "company": {"display_name": "Zomato"},
         "location": {"area": ["India", "Delhi", "Delhi"]}, "category": {"label": "IT Jobs"},
         "description": "BI Analyst. SQL, Tableau, Power BI, Excel, Looker.",
         "created": "2025-01-18T10:00:00Z", "redirect_url": ""},
        {"id": "mock_007", "title": "Data Analyst", "company": {"display_name": "Ola"},
         "location": {"area": ["India", "Maharashtra", "Mumbai"]}, "category": {"label": "IT Jobs"},
         "description": "Data Analyst. SQL, Excel, Python, R, Tableau.",
         "created": "2025-01-19T10:00:00Z", "redirect_url": ""},
        {"id": "mock_008", "title": "Business Analyst", "company": {"display_name": "Paytm"},
         "location": {"area": ["India", "Uttar Pradesh", "Noida"]}, "category": {"label": "IT Jobs"},
         "description": "Business Analyst. SQL, Excel, Tableau, Python.",
         "created": "2025-01-17T10:00:00Z", "redirect_url": ""},
        {"id": "mock_009", "title": "Data Analyst", "company": {"display_name": "CRED"},
         "location": {"area": ["India", "Karnataka", "Bangalore"]}, "category": {"label": "IT Jobs"},
         "description": "Data Analyst. Python, SQL, Pandas, NumPy, Matplotlib, Power BI.",
         "created": "2025-01-23T10:00:00Z", "redirect_url": ""},
        {"id": "mock_010", "title": "Data Analyst", "company": {"display_name": "Nykaa"},
         "location": {"area": ["India", "Maharashtra", "Mumbai"]}, "category": {"label": "IT Jobs"},
         "description": "Data Analyst. SQL, Python, Excel, Looker, Power BI.",
         "created": "2025-01-16T10:00:00Z", "redirect_url": ""},
    ]


if __name__ == "__main__":
    run_etl()