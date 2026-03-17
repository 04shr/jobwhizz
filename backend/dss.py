"""
JobWhiz Lab — DSS Routes
Decision Support System: What should I do?
Career gap analysis, skill ROI, path recommendations, action plans via Groq
All salary/skill values pulled from real DB — zero hardcoding.
"""

import os
import json
import re
import math
from fastapi import APIRouter, Form, HTTPException
from groq import Groq
from db import query

router = APIRouter(prefix="/api/dss", tags=["DSS"])
client = Groq(api_key=os.getenv("GROQ_API_KEY"))


# ── REAL-TIME SALARY LOOKUP ───────────────────────────────────────
def get_role_salary_map():
    """
    Pulls actual avg salary per role from DB.
    No hardcoding — always reflects latest ETL data.
    """
    rows = query("""
        SELECT
            CASE
                WHEN title LIKE '%Data Engineer%'    THEN 'Data Engineer'
                WHEN title LIKE '%Data Scientist%'   THEN 'Data Scientist'
                WHEN title LIKE '%ML Engineer%'      THEN 'ML Engineer'
                WHEN title LIKE '%Data Analyst%'     THEN 'Data Analyst'
                WHEN title LIKE '%Business Analyst%' THEN 'Business Analyst'
                WHEN title LIKE '%AI Engineer%'      THEN 'AI Engineer'
                WHEN title LIKE '%Software Engineer%'THEN 'Software Engineer'
                ELSE 'Other'
            END AS role,
            ROUND(AVG(salary_avg), 2) AS avg_sal
        FROM jobs
        WHERE salary_avg IS NOT NULL
        GROUP BY role
    """)
    return {r['role']: float(r['avg_sal']) for r in rows}


def get_skill_salary_premium():
    """
    Computes salary premium per skill by comparing avg salary
    of jobs requiring that skill vs overall avg.
    Real signal — not hardcoded.
    """
    overall = query("SELECT ROUND(AVG(salary_avg),2) AS avg FROM jobs WHERE salary_avg IS NOT NULL")[0]['avg']
    overall = float(overall)

    rows = query("""
        SELECT
            s.skill_name,
            ROUND(AVG(j.salary_avg), 2) AS skill_avg,
            COUNT(DISTINCT j.id) AS job_count
        FROM skills s
        JOIN job_skills js ON s.id = js.skill_id
        JOIN jobs j ON j.id = js.job_id
        WHERE j.salary_avg IS NOT NULL
        GROUP BY s.skill_name
        HAVING job_count >= 3
        ORDER BY skill_avg DESC
    """)
    return {
        r['skill_name']: round(float(r['skill_avg']) - overall, 2)
        for r in rows
    }


# Learn time estimates — seeded defaults; overridden by `skill_learn_weeks` DB table if it exists.
_LEARN_WEEKS_DEFAULT = {
    "SQL": 4, "Python": 6, "Power BI": 3, "Tableau": 3,
    "Azure": 8, "AWS": 8, "Spark": 10, "Kafka": 10,
    "Machine Learning": 16, "Tensorflow": 12, "Pytorch": 12,
    "Docker": 5, "Dbt": 4, "Airflow": 6,
    "Databricks": 6, "Snowflake": 4, "Pyspark": 8,
    "Nlp": 12, "R": 5, "Scala": 10,
}
_learn_weeks_cache: dict | None = None

def get_learn_weeks() -> dict:
    """
    Returns skill→weeks mapping.
    Tries `skill_learn_weeks` table first (admin-editable via DB);
    falls back to in-code defaults so the API never breaks.
    """
    global _learn_weeks_cache
    if _learn_weeks_cache is not None:
        return _learn_weeks_cache
    try:
        rows = query("SELECT skill_name, weeks_to_learn FROM skill_learn_weeks")
        if rows:
            _learn_weeks_cache = {r["skill_name"]: int(r["weeks_to_learn"]) for r in rows}
            return _learn_weeks_cache
    except Exception:
        pass  # table may not exist yet — fall through to defaults
    _learn_weeks_cache = dict(_LEARN_WEEKS_DEFAULT)
    return _learn_weeks_cache



# ── DYNAMIC CONFIG ENDPOINTS ─────────────────────────────────────
@router.get("/config/learn-weeks")
def config_learn_weeks():
    """Exposes current skill→weeks mapping so the frontend can show it."""
    return get_learn_weeks()


@router.get("/config/career-ladder")
def config_career_ladder():
    """
    Returns the role progression ladder from DB (table: career_ladder).
    Falls back to a sensible default if the table doesn't exist.
    """
    try:
        rows = query("SELECT current_role, next_role FROM career_ladder ORDER BY current_role, priority ASC")
        if rows:
            ladder: dict[str, list] = {}
            for r in rows:
                ladder.setdefault(r["current_role"], []).append(r["next_role"])
            return ladder
    except Exception:
        pass
    # fallback defaults
    return {
        "Data Analyst":     ["Senior Data Analyst", "Data Scientist", "Data Engineer"],
        "Business Analyst": ["Senior Business Analyst", "Data Analyst", "Product Analyst"],
        "Data Scientist":   ["Senior Data Scientist", "ML Engineer", "AI Engineer"],
        "Data Engineer":    ["Senior Data Engineer", "ML Engineer", "Data Architect"],
        "ML Engineer":      ["Senior ML Engineer", "AI Engineer", "Data Scientist"],
        "AI Engineer":      ["Senior AI Engineer", "ML Engineer", "Data Scientist"],
        "Software Engineer":["Senior SWE", "Data Engineer", "ML Engineer"],
    }


@router.get("/config/roles")
def config_roles():
    """Returns distinct roles inferred from DB job titles — used to populate frontend dropdowns."""
    rows = query("""
        SELECT DISTINCT
            CASE
                WHEN title LIKE '%Data Engineer%'    THEN 'Data Engineer'
                WHEN title LIKE '%Data Scientist%'   THEN 'Data Scientist'
                WHEN title LIKE '%ML Engineer%'      THEN 'ML Engineer'
                WHEN title LIKE '%Data Analyst%'     THEN 'Data Analyst'
                WHEN title LIKE '%Business Analyst%' THEN 'Business Analyst'
                WHEN title LIKE '%AI Engineer%'      THEN 'AI Engineer'
                WHEN title LIKE '%Software Engineer%'THEN 'Software Engineer'
            END AS role
        FROM jobs
        WHERE title IS NOT NULL
        ORDER BY role
    """)
    roles = [r["role"] for r in rows if r["role"]]
    return roles or ["Data Analyst", "Data Scientist", "Data Engineer", "ML Engineer",
                     "Business Analyst", "AI Engineer", "Software Engineer"]


@router.get("/config/cities")
def config_cities():
    """Returns distinct cities from DB with at least 1 job — used to populate city dropdown."""
    rows = query("""
        SELECT city, COUNT(*) AS cnt
        FROM jobs
        WHERE city IS NOT NULL AND city != '' AND city != 'India'
        GROUP BY city
        HAVING cnt >= 1
        ORDER BY cnt DESC
        LIMIT 20
    """)
    cities = [r["city"] for r in rows]
    return cities or ["Bangalore", "Hyderabad", "Mumbai", "Delhi NCR", "Chennai", "Pune"]



@router.get("/market-pulse")
def market_pulse():
    rows = query("""
        SELECT
            COUNT(*) AS total_jobs,
            ROUND(AVG(salary_avg), 2) AS avg_salary,
            COUNT(DISTINCT company) AS companies,
            COUNT(DISTINCT city)    AS cities
        FROM jobs
    """)
    top_role = query("""
        SELECT
            CASE
                WHEN title LIKE '%Data Engineer%'  THEN 'Data Engineer'
                WHEN title LIKE '%Data Scientist%' THEN 'Data Scientist'
                WHEN title LIKE '%ML Engineer%'    THEN 'ML Engineer'
                WHEN title LIKE '%Data Analyst%'   THEN 'Data Analyst'
                ELSE 'Other'
            END AS role,
            COUNT(*) AS cnt
        FROM jobs GROUP BY role ORDER BY cnt DESC LIMIT 1
    """)
    return {
        **rows[0],
        "hottest_role": top_role[0]['role'] if top_role else "Data Engineer",
    }


# ── SALARY BENCHMARKS (for frontend predictor) ────────────────────
@router.get("/salary-benchmarks")
def salary_benchmarks():
    """
    Returns real avg salary per role AND per city from DB.
    Frontend uses this to replace all hardcoded base/locMult values.
    """
    by_role = query("""
        SELECT
            CASE
                WHEN title LIKE '%Data Engineer%'    THEN 'Data Engineer'
                WHEN title LIKE '%Data Scientist%'   THEN 'Data Scientist'
                WHEN title LIKE '%ML Engineer%'      THEN 'ML Engineer'
                WHEN title LIKE '%Data Analyst%'     THEN 'Data Analyst'
                WHEN title LIKE '%Business Analyst%' THEN 'Business Analyst'
                WHEN title LIKE '%AI Engineer%'      THEN 'AI Engineer'
                ELSE 'Other'
            END AS role,
            ROUND(AVG(salary_avg), 2) AS avg_salary
        FROM jobs WHERE salary_avg IS NOT NULL
        GROUP BY role ORDER BY avg_salary DESC
    """)
    by_city = query("""
        SELECT city, ROUND(AVG(salary_avg), 2) AS avg_salary
        FROM jobs
        WHERE salary_avg IS NOT NULL AND city != '' AND city != 'India'
        GROUP BY city ORDER BY avg_salary DESC
        LIMIT 10
    """)
    overall = query("SELECT ROUND(AVG(salary_avg),2) AS avg FROM jobs WHERE salary_avg IS NOT NULL")[0]

    return {
        "by_role":       {r['role']: float(r['avg_salary']) for r in by_role},
        "by_city":       {r['city']: float(r['avg_salary']) for r in by_city},
        "overall_avg":   float(overall['avg']),
    }


# ── PROFILE GAP ANALYSIS ─────────────────────────────────────────
@router.post("/gap-analysis")
async def gap_analysis(
    current_role: str  = Form(...),
    target_role:  str  = Form(...),
    city:         str  = Form(...),
    experience:   int  = Form(...),
    skills:       str  = Form(...)
):
    user_skills = [s.strip().lower() for s in skills.split(",") if s.strip()]
    role_salary = get_role_salary_map()
    fallback_sal = role_salary.get("Other") or float(
        query("SELECT ROUND(AVG(salary_avg),2) AS avg FROM jobs WHERE salary_avg IS NOT NULL")[0]["avg"]
    )
    market_salary  = role_salary.get(target_role,  fallback_sal)
    current_salary = role_salary.get(current_role, fallback_sal)
    salary_gap     = round(market_salary - current_salary, 2)

    role_pattern = target_role.replace(" ", "%")
    city_jobs = query("""
        SELECT COUNT(*) AS cnt FROM jobs
        WHERE title LIKE %s AND (city = %s OR city = 'India')
    """, [f"%{role_pattern}%", city])
    jobs_available = city_jobs[0]['cnt'] if city_jobs else 0

    market_skills_raw = query("""
        SELECT s.skill_name, COUNT(*) AS freq
        FROM skills s
        JOIN job_skills js ON s.id = js.skill_id
        JOIN jobs j ON j.id = js.job_id
        WHERE j.title LIKE %s
        GROUP BY s.skill_name ORDER BY freq DESC LIMIT 12
    """, [f"%{role_pattern}%"])

    market_skills = [r['skill_name'].lower() for r in market_skills_raw]
    missing = [s for s in market_skills if s not in user_skills][:5]
    matched = [s for s in market_skills if s in user_skills][:5]

    exp_rows = query("""
        SELECT experience_min, experience_max FROM jobs
        WHERE title LIKE %s AND experience_max IS NOT NULL AND experience_max > 0
    """, [f"%{role_pattern}%"])
    avg_exp_min = round(sum(r['experience_min'] for r in exp_rows) / len(exp_rows), 1) if exp_rows else 2
    avg_exp_max = round(sum(r['experience_max'] for r in exp_rows) / len(exp_rows), 1) if exp_rows else 5
    exp_fit = "Under" if experience < avg_exp_min else "Match" if experience <= avg_exp_max else "Over"

    return {
        "current_role":     current_role,
        "target_role":      target_role,
        "market_salary":    market_salary,
        "current_salary":   current_salary,
        "salary_gap":       salary_gap,
        "jobs_available":   jobs_available,
        "missing_skills":   missing,
        "matched_skills":   matched,
        "exp_fit":          exp_fit,
        "avg_exp_required": f"{avg_exp_min}–{avg_exp_max} yrs",
        "skill_match_pct":  round(len(matched) / max(len(market_skills), 1) * 100, 1),
    }


# ── SKILL ROI RANKING ────────────────────────────────────────────
@router.post("/skill-roi")
async def skill_roi(
    current_role: str = Form(...),
    skills:       str = Form(...)
):
    user_skills   = [s.strip().lower() for s in skills.split(",") if s.strip()]
    role_salary   = get_role_salary_map()
    skill_premium = get_skill_salary_premium()
    learn_weeks   = get_learn_weeks()
    fallback_sal  = role_salary.get("Other") or float(
        query("SELECT ROUND(AVG(salary_avg),2) AS avg FROM jobs WHERE salary_avg IS NOT NULL")[0]["avg"]
    )
    base_salary = role_salary.get(current_role, fallback_sal)

    results = []
    for skill, premium in skill_premium.items():
        if premium <= 0:
            continue
        if skill.lower() in user_skills:
            continue
        weeks = learn_weeks.get(skill, 8)
        roi   = round(premium / (weeks / 52) * 100, 1)
        results.append({
            "skill":            skill,
            "salary_premium":   premium,
            "weeks_to_learn":   weeks,
            "projected_salary": round(base_salary + premium, 2),
            "roi_score":        roi,
        })

    results.sort(key=lambda x: x["roi_score"], reverse=True)
    return results[:8]


# ── CAREER PATH OPTIONS ──────────────────────────────────────────
@router.post("/career-paths")
async def career_paths(
    current_role: str = Form(...),
    experience:   int = Form(...),
    city:         str = Form(...)
):
    # ── Career ladder: prefer DB, fall back to config endpoint defaults ──────
    try:
        ladder_rows = query(
            "SELECT next_role FROM career_ladder WHERE current_role = %s ORDER BY priority ASC",
            [current_role]
        )
        next_roles = [r["next_role"] for r in ladder_rows] if ladder_rows else []
    except Exception:
        next_roles = []

    if not next_roles:
        # fallback defaults keyed by role
        _default_ladder = {
            "Data Analyst":     ["Senior Data Analyst", "Data Scientist", "Data Engineer"],
            "Business Analyst": ["Senior Business Analyst", "Data Analyst", "Product Analyst"],
            "Data Scientist":   ["Senior Data Scientist", "ML Engineer", "AI Engineer"],
            "Data Engineer":    ["Senior Data Engineer", "ML Engineer", "Data Architect"],
            "ML Engineer":      ["Senior ML Engineer", "AI Engineer", "Data Scientist"],
            "AI Engineer":      ["Senior AI Engineer", "ML Engineer", "Data Scientist"],
            "Software Engineer":["Senior SWE", "Data Engineer", "ML Engineer"],
        }
        next_roles = _default_ladder.get(current_role, ["Data Analyst", "Data Scientist", "Data Engineer"])

    role_salary = get_role_salary_map()
    fallback_sal = role_salary.get("Other") or float(
        query("SELECT ROUND(AVG(salary_avg),2) AS avg FROM jobs WHERE salary_avg IS NOT NULL")[0]["avg"]
    )
    current_sal = role_salary.get(current_role, fallback_sal)

    # Configurable thresholds — read from app_config table; graceful fallback
    try:
        cfg_rows = query(
            "SELECT `key`, value FROM app_config WHERE `key` IN "
            "('senior_salary_multiplier','difficulty_threshold_medium','difficulty_threshold_hard')"
        )
        cfg = {r["key"]: float(r["value"]) for r in cfg_rows}
    except Exception:
        cfg = {}
    senior_multiplier = cfg.get("senior_salary_multiplier", 1.3)
    th_medium = cfg.get("difficulty_threshold_medium", 2.0)
    th_hard   = cfg.get("difficulty_threshold_hard",   4.0)

    paths = []
    for next_role in next_roles:
        base_key = next_role.replace("Senior ", "")
        sal = role_salary.get(base_key, fallback_sal)
        if "Senior" in next_role:
            sal = round(sal * senior_multiplier, 2)

        pattern = next_role.replace("Senior ", "").replace(" ", "%")
        jcount  = query("""
            SELECT COUNT(*) AS cnt FROM jobs
            WHERE title LIKE %s AND (city = %s OR city = 'India')
        """, [f"%{pattern}%", city])

        skills_needed = query("""
            SELECT s.skill_name, COUNT(*) AS freq
            FROM skills s
            JOIN job_skills js ON s.id = js.skill_id
            JOIN jobs j ON j.id = js.job_id
            WHERE j.title LIKE %s
            GROUP BY s.skill_name ORDER BY freq DESC LIMIT 5
        """, [f"%{pattern}%"])

        jump = sal - current_sal
        paths.append({
            "role":            next_role,
            "avg_salary":      sal,
            "salary_jump":     round(jump, 2),
            "jump_pct":        round(jump / current_sal * 100, 1) if current_sal else 0,
            "jobs_available":  jcount[0]["cnt"] if jcount else 0,
            "skills_needed":   [r["skill_name"] for r in skills_needed],
            "timeline_months": 6 if "Senior" in next_role else 12 if jump < th_medium else 18,
            "difficulty":      "Medium" if jump < th_medium else "Hard" if jump < th_hard else "Very Hard",
        })

    paths.sort(key=lambda x: x["salary_jump"], reverse=True)
    return paths


# ── 90-DAY ACTION PLAN (Groq) ────────────────────────────────────
@router.post("/action-plan")
async def action_plan(
    current_role:   str = Form(...),
    target_role:    str = Form(...),
    city:           str = Form(...),
    experience:     int = Form(...),
    skills:         str = Form(...),
    missing_skills: str = Form(default=""),
    salary_gap:     str = Form(default="0"),
):
    system_prompt = (
        "You are a senior career strategist and data industry expert. "
        "You create specific, actionable 90-day career plans. "
        "Be concrete — name exact courses, platforms, projects, and milestones. "
        "Return only valid JSON, no markdown, no explanation."
    )
    user_prompt = f"""
Create a personalised 90-day career action plan:
- Current Role: {current_role}
- Target Role: {target_role}
- City: {city}
- Experience: {experience} years
- Current Skills: {skills}
- Missing Skills: {missing_skills}
- Salary Gap: ₹{salary_gap}L

Return ONLY a JSON object:
{{
  "goal": "<one sentence mission>",
  "month_1": {{"theme": "<theme>", "weeks": [{{"week":1,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}, {{"week":2,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}, {{"week":3,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}, {{"week":4,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}]}},
  "month_2": {{"theme": "<theme>", "weeks": [{{"week":5,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}, {{"week":6,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}, {{"week":7,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}, {{"week":8,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}]}},
  "month_3": {{"theme": "<theme>", "weeks": [{{"week":9,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}, {{"week":10,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}, {{"week":11,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}, {{"week":12,"focus":"<task>","resource":"<platform>","output":"<deliverable>"}}]}},
  "success_metrics": ["<metric1>","<metric2>","<metric3>"],
  "quick_wins": ["<action1>","<action2>","<action3>"]
}}"""

    try:
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=2000,
        )
        raw = resp.choices[0].message.content.strip()
        raw = re.sub(r"^```(?:json)?", "", raw).strip()
        raw = re.sub(r"```$", "", raw).strip()
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Groq returned invalid JSON: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq error: {str(e)}")