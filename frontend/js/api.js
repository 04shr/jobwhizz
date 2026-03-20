// ─── api.js — All fetch calls in one place ────────────────────
export const API = "https://jobwhizz.onrender.com";

export async function apiFetch(endpoint) {
  const r = await fetch(API + endpoint);
  if (!r.ok) throw new Error(`API error: ${endpoint}`);
  return r.json();
}

// ── Health ────────────────────────────────────────────────────
export const checkHealth      = () => apiFetch('/');

// ── Dashboard ─────────────────────────────────────────────────
export const getDashKPIs      = () => apiFetch('/api/dashboard/kpis');
export const getJobsByCity    = () => apiFetch('/api/dashboard/jobs-by-city');
export const getJobsByRole    = () => apiFetch('/api/dashboard/jobs-by-role');
export const getSalaryDist    = () => apiFetch('/api/dashboard/salary-distribution');
export const getHiringTrend   = () => apiFetch('/api/dashboard/hiring-trend');
export const getTopCompanies  = () => apiFetch('/api/dashboard/top-companies');

// ── EDA ───────────────────────────────────────────────────────
export const getEDASummary    = () => apiFetch('/api/eda/summary');
export const getSalaryByCity  = () => apiFetch('/api/eda/salary-by-city');
export const getSalaryByRole  = () => apiFetch('/api/eda/salary-by-role');
export const getExpVsSalary   = () => apiFetch('/api/eda/experience-vs-salary');
export const getJobsOverTime  = () => apiFetch('/api/eda/jobs-over-time');
export const getEDASkills     = (limit = 15) => apiFetch(`/api/eda/skills?limit=${limit}`);
export const getSkillsByRole  = () => apiFetch('/api/eda/skills-by-role');

// ── NLP ───────────────────────────────────────────────────────
export const getKeywordFreq   = () => apiFetch('/api/nlp/keyword-frequency');
export const getSkillCooccur  = () => apiFetch('/api/nlp/skill-cooccurrence');

// ── SML ───────────────────────────────────────────────────────
export const getSMLStatsSummary  = () => apiFetch('/api/sml/stats/summary');
export const getSMLDistribution  = () => apiFetch('/api/sml/stats/distribution');
export const getRegressionData   = () => apiFetch('/api/sml/regression/exp-vs-salary');
export const getFeatureImportance= () => apiFetch('/api/sml/feature-importance');
export const getSMLSalaryByRole  = () => apiFetch('/api/sml/salary-by-role');
export const getSMLSalaryByCity  = (limit = 10) => apiFetch(`/api/sml/salary-by-city?limit=${limit}`);
export const getSMLOverallAvg    = () => apiFetch('/api/sml/overall-avg');
export const getModelEvaluation  = () => apiFetch('/api/sml/model/evaluation');
export const getHypothesisDE     = () => apiFetch('/api/sml/hypothesis/data-engineers-vs-rest');
export const getHypothesisBLR    = () => apiFetch('/api/sml/hypothesis/bangalore-vs-rest');

// ── DSS ───────────────────────────────────────────────────────
export const getSalaryBenchmarks = () => apiFetch('/api/dss/salary-benchmarks');
export const getMarketPulse      = () => apiFetch('/api/dss/market-pulse');

// ── Jobs ──────────────────────────────────────────────────────
export const getJobs = (city = '', role = '', limit = 50) => {
  const params = new URLSearchParams();
  if (city)  params.set('city', city);
  if (role)  params.set('role', role);
  params.set('limit', limit);
  return apiFetch(`/api/jobs?${params}`);
};

// ── Skills ────────────────────────────────────────────────────
export const getTopSkills = (limit = 15) => apiFetch(`/api/skills/top?limit=${limit}`);

