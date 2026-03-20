// ─── router.js — Page routing & shared UI helpers ─────────────
import { checkHealth, getDashKPIs, API } from './api.js';
// ── Page routing ──────────────────────────────────────────────
export function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.getElementById('nav-' + name)?.classList.add('active');
  window.scrollTo(0, 0);
}

// ── Shared bar chart renderer ─────────────────────────────────
export function renderBar(id, data, labelKey, valueKey) {
  const el = document.getElementById(id);
  if (!el || !data?.length) {
    if (el) el.innerHTML = '<p style="font-family:var(--font-mono);font-size:.72rem;color:var(--muted);">No data</p>';
    return;
  }
  const max  = Math.max(...data.map(d => d[valueKey]));
  const cols = ['#00e5a0','#4f8bff','#ffb340','#ff4f6b','#b57bee','#00d48a','#6ec6ff','#ffd080'];
  el.innerHTML = data.map((d, i) => `
    <div class="bar-row">
      <div class="bar-label" title="${d[labelKey]}">${d[labelKey]}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(d[valueKey]/max)*100}%;background:${cols[i % cols.length]}"></div>
      </div>
      <div class="bar-val">${typeof d[valueKey] === 'number' && d[valueKey] % 1 !== 0 ? d[valueKey].toFixed(1) : d[valueKey]}</div>
    </div>
  `).join('');
}

// ── Loading placeholder ───────────────────────────────────────
export function setLoading(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
}

// ── API status indicator ──────────────────────────────────────
export async function initAPIStatus() {
  try {
    await checkHealth();
    document.getElementById('apiDot')?.classList.add('live');
    const label = document.getElementById('apiLabel');
    if (label) { label.textContent = 'API Live'; label.style.color = 'var(--accent)'; }
    await loadHomeStats();
  } catch {
    const label = document.getElementById('apiLabel');
    if (label) {
      label.textContent = 'API Offline — run: uvicorn main:app --reload';
      label.style.color = 'var(--danger)';
    }
  }
}

// ── Home stats ────────────────────────────────────────────────
async function loadHomeStats() {
  try {
    const k = await getDashKPIs();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('hs-jobs',      Number(k.total_jobs).toLocaleString());
    set('hs-companies', k.total_companies);
    set('hs-cities',    k.total_cities);
    set('hs-salary',    k.avg_salary ?? '—');
    set('footer-count', `${k.total_jobs} jobs · ${k.total_companies} companies · live`);
  } catch (e) { console.warn('Home stats:', e); }
}

