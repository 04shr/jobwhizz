"""
JobWhiz Lab — NLP Routes
Diagnostic Analytics: Why are certain skills dominating?
Resume parsing, JD matching, ATS evaluation via Groq API
"""

import os
import io
import json
import re
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from groq import Groq
import pdfplumber
from db import query

router = APIRouter(prefix="/api/nlp", tags=["NLP"])

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


# ── EXISTING ENDPOINTS ────────────────────────────────────────────
@router.get("/keyword-frequency")
def keyword_frequency():
    return query("""
        SELECT s.skill_name, COUNT(js.job_id) AS frequency
        FROM skills s
        JOIN job_skills js ON s.id = js.skill_id
        GROUP BY s.skill_name
        ORDER BY frequency DESC
        LIMIT 25
    """)


@router.get("/skill-cooccurrence")
def skill_cooccurrence():
    return query("""
        SELECT s1.skill_name AS skill_a, s2.skill_name AS skill_b, COUNT(*) AS co_count
        FROM job_skills js1
        JOIN job_skills js2 ON js1.job_id = js2.job_id AND js1.skill_id < js2.skill_id
        JOIN skills s1 ON s1.id = js1.skill_id
        JOIN skills s2 ON s2.id = js2.skill_id
        GROUP BY skill_a, skill_b
        ORDER BY co_count DESC
        LIMIT 20
    """)


# ── PDF EXTRACTION ────────────────────────────────────────────────
@router.post("/extract-pdf")
async def extract_pdf(file: UploadFile = File(...)):
    """
    Accepts a PDF binary upload, extracts clean text server-side using pdfplumber.
    This is the correct way to handle PDFs — browser FileReader only works for .txt.
    """
    contents = await file.read()

    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Max 10MB.")

    try:
        text_parts = []
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text.strip())

        full_text = "\n\n".join(text_parts).strip()

        if not full_text or len(full_text) < 50:
            raise HTTPException(
                status_code=422,
                detail="Could not extract text. This PDF may be image-based or scanned. Please paste your resume text instead."
            )

        return {"text": full_text, "pages": len(text_parts), "char_count": len(full_text)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF extraction failed: {str(e)}")


# ── MATCH JDs FROM DB ─────────────────────────────────────────────
@router.post("/match-jds")
async def match_jds(role: str = Form(...), skills: str = Form(...)):
    skill_list = [s.strip() for s in skills.split(",") if s.strip()]

    if skill_list:
        like_clauses = " OR ".join([f"description LIKE %s" for _ in skill_list[:6]])
        params = [f"%{s}%" for s in skill_list[:6]]
    else:
        like_clauses = "1=1"
        params = []

    role_map = {
        "data analyst": "Data Analyst", "data scientist": "Data Scientist",
        "data engineer": "Data Engineer", "ml engineer": "ML Engineer",
        "business analyst": "Business Analyst", "software engineer": "Software Engineer",
        "ai engineer": "AI Engineer",
    }
    matched_role = next((v for k, v in role_map.items() if k in role.lower()), None)

    if matched_role:
        role_clause = "AND title LIKE %s"
        params.append(f"%{matched_role}%")
    else:
        role_clause = ""

    rows = query(f"""
        SELECT id, title, company, city, salary_avg, salary_max,
               experience_min, experience_max, description, redirect_url
        FROM jobs WHERE ({like_clauses}) {role_clause}
        ORDER BY salary_avg DESC LIMIT 5
    """, params)

    # Fallback: just return top 5 if nothing matched
    if not rows:
        rows = query("""
            SELECT id, title, company, city, salary_avg, salary_max,
                   experience_min, experience_max, description, redirect_url
            FROM jobs ORDER BY salary_avg DESC LIMIT 5
        """)
    return rows


# ── ANALYSE RESUME WITH GROQ ──────────────────────────────────────
@router.post("/analyse-resume")
async def analyse_resume(
    resume_text: str = Form(...),
    jd_text:     str = Form(...),
    tone:        str = Form(default="normal")
):
    # ── Tone system prompts — each is a distinct persona ────────────
    tone_system = {
        "normal": (
            "You are a senior HR consultant and ATS specialist. "
            "Give a professional, balanced, objective evaluation. "
            "Be factual and constructive. No fluff."
        ),
        "roast": (
            "You are a savage, brutally honest career coach who ROASTS resumes like a stand-up comedian. "
            "You are FUNNY, HARSH, and SARCASTIC. You make the person cringe but also laugh. "
            "Think of Gordon Ramsay reviewing a resume instead of food. "
            "EVERY field must drip with sarcasm and dark humour — the summary, the one_liner, the pros, the cons, the action_items. "
            "Do NOT be polite. Do NOT soften anything. Still be secretly helpful — the advice must be real — but BRUTAL in delivery. "
            "Example one_liner style: 'This resume is so generic it could apply for a job at the post office AND NASA simultaneously.' "
            "Example cons style: 'Lists Python as a skill but probably only used it to print Hello World and watch one YouTube tutorial.' "
            "Example action_items style: 'Delete the hobbies section — nobody cares that you like hiking, this is a data job not a Tinder profile.'"
        ),
        "hype": (
            "You are the world's most enthusiastic hype coach. You are LOUD, POSITIVE, and FULL OF ENERGY. "
            "Use emojis everywhere. Celebrate EVERY tiny thing on this resume like it is a Nobel Prize. "
            "EVERY field must be electric with positivity — turn every weakness into a growth opportunity with excitement. "
            "Think of a motivational speaker who has had 10 espressos. "
            "Example one_liner style: '🚀 This resume is a ROCKET waiting to launch — just needs a little fuel! 🔥' "
            "Example pros style: '✨ Wait — you know Python AND SQL?! That is LITERALLY the dream combo right there! 🐍💥' "
            "Example cons style: '🌱 Generative AI is your next growth frontier — imagine how UNSTOPPABLE you will be once you add that! 💪'"
        ),
        "interviewer": (
            "You are a stone-cold senior staff engineer at Google conducting a resume review. "
            "You are DEMANDING, TECHNICAL, and SKEPTICAL. You have seen 10,000 resumes and are impressed by nothing. "
            "Every field must read like a tough interview question or brutal rejection reason. "
            "Be cold, precise, and clinical. Call out vague language, missing metrics, and unverifiable claims. "
            "Example one_liner style: 'Candidate lists Machine Learning but provides zero metrics, zero model performance numbers, and zero production deployments. Reject.' "
            "Example cons style: 'Says experienced with Python — experienced how? Scripts? Packages? Distributed systems? This is meaningless without context.' "
            "Example action_items style: 'Every bullet point needs a number. Not worked on ML models — trained 3 models achieving 94% accuracy on 50K dataset. That is the bar.'"
        ),
    }

    # ── Tone-specific field hints injected into the prompt ────────
    tone_field_hints = {
        "normal":      ("a professional 2-3 sentence verdict",
                        "a genuine professional strength",
                        "a real gap or weakness",
                        "a concise professional one-liner",
                        "a specific actionable improvement"),
        "roast":       ("2-3 sentences dripping with sarcasm and dark humour that ROASTS the candidate while being secretly accurate",
                        "a strength written sarcastically — even compliments should sting a little",
                        "a weakness written with savage humour and specific examples from the resume",
                        "the most savage one-liner you can write about this resume — make it burn",
                        "a brutally worded but actually useful fix — think Gordon Ramsay giving career advice"),
        "hype":        ("2-3 sentences EXPLODING with energy and emojis celebrating this candidate",
                        "a strength celebrated with maximum hype and emojis",
                        "a weakness reframed as an exciting growth opportunity with enthusiasm",
                        "an electric, emoji-filled one-liner that makes the candidate feel like a superstar",
                        "an action item written as an exciting challenge they will CRUSH"),
        "interviewer": ("2-3 cold, clinical sentences a FAANG interviewer would write in a rejection email",
                        "a strength — but phrase it as what barely saves them from immediate rejection",
                        "a weakness phrased as a specific technical gap that disqualifies them",
                        "one cold precise sentence a FAANG recruiter would write — imagine a rejection email subject line",
                        "a technical requirement phrased as a non-negotiable standard they must meet"),
    }

    hints = tone_field_hints.get(tone, tone_field_hints["normal"])

    user_prompt = f"""
Analyse this resume against the job description. You MUST write in the assigned tone for EVERY single field.

--- RESUME ---
{resume_text[:3000]}

--- JOB DESCRIPTION ---
{jd_text[:2000]}

Return ONLY a valid JSON object with this exact structure. No markdown, no backticks, no explanation.
The tone must be UNMISTAKABLY present in every text field — not just the summary:

{{
  "match_score": <integer 0-100, be honest>,
  "detected_role": "<job title>",
  "summary": "<{hints[0]}>",
  "pros": [
    "<{hints[1]}>",
    "<{hints[1]}>",
    "<{hints[1]}>",
    "<{hints[1]}>"
  ],
  "cons": [
    "<{hints[2]}>",
    "<{hints[2]}>",
    "<{hints[2]}>",
    "<{hints[2]}>"
  ],
  "missing_skills": ["<skill gap 1>", "<skill gap 2>", "<skill gap 3>"],
  "matched_skills": ["<matched skill 1>", "<matched skill 2>", "<matched skill 3>", "<matched skill 4>"],
  "ats_flags": ["<ATS formatting or keyword issue 1>", "<ATS issue 2>"],
  "one_liner": "<{hints[3]}>",
  "action_items": [
    "<{hints[4]}>",
    "<{hints[4]}>",
    "<{hints[4]}>"
  ]
}}
"""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": tone_system.get(tone, tone_system["normal"])},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.85 if tone in ["roast", "hype"] else 0.4 if tone == "interviewer" else 0.3,
            max_tokens=1200,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r"^```(?:json)?", "", raw).strip()
        raw = re.sub(r"```$", "", raw).strip()
        result = json.loads(raw)
        result["tone"] = tone
        return result
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Groq returned invalid JSON: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq error: {str(e)}")


# ── PARSE RESUME ──────────────────────────────────────────────────
@router.post("/parse-resume")
async def parse_resume(resume_text: str = Form(...)):
    user_prompt = f"""
Parse this resume and return ONLY a JSON object:
{{
  "detected_role": "<most likely target job title>",
  "years_experience": <integer or 0 if fresher>,
  "top_skills": ["<skill1>", "<skill2>", "<skill3>", "<skill4>", "<skill5>"],
  "education": "<highest degree and field>",
  "summary": "<one sentence about this candidate>"
}}

RESUME:
{resume_text[:2500]}
"""
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a resume parser. Return only valid JSON, no markdown."},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=400,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r"^```(?:json)?", "", raw).strip()
        raw = re.sub(r"```$", "", raw).strip()
        return json.loads(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse error: {str(e)}")