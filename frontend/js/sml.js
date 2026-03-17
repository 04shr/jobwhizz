// ─── sml.js — All SML logic, zero hardcoded values ───────────
const API = 'http://127.0.0.1:8000';

// ── State — populated from API on boot ────────────────────────
let STATS    = {};
let ROLE_MAP = {};
let CITY_MAP = {};
let REG_DATA = {};
let OVERALL  = null;   // set from /api/dss/salary-benchmarks — never hardcoded

// ── Fetch helper ──────────────────────────────────────────────
async function get(ep) {
  const r = await fetch(API + ep);
  if (!r.ok) throw new Error(ep);
  return r.json();
}

// ── Toggle learn boxes ────────────────────────────────────────
window.toggleLearn = id => document.getElementById(id)?.classList.toggle('open');

// ── API status ────────────────────────────────────────────────
async function checkAPI() {
  try {
    await get('/');
    document.getElementById('apiDot')?.classList.add('live');
    const l = document.getElementById('apiLabel');
    if (l) { l.textContent = 'API Live'; l.style.color = 'var(--accent)'; }
  } catch {
    const l = document.getElementById('apiLabel');
    if (l) { l.textContent = 'API Offline'; l.style.color = 'var(--danger)'; }
  }
}

// ── Row count ─────────────────────────────────────────────────
async function loadRowCount() {
  try {
    const d = await get('/api/eda/summary');
    document.querySelectorAll('#rowCount, #rowCount2').forEach(el => {
      if (el) el.textContent = d.total_jobs;
    });
  } catch { }
}

// ── Footer ────────────────────────────────────────────────────
async function loadFooterStats() {
  try {
    const d = await get('/api/eda/summary');
    const el = document.getElementById('footer-note');
    if (el) el.textContent = `${d.total_jobs} jobs · ${d.unique_cities} cities · Adzuna API · Live MySQL`;
  } catch { }
}

// ── SECTION 1: Stat strip ─────────────────────────────────────
async function renderStatStrip() {
  try {
    const s = await get('/api/sml/stats/summary');
    STATS = s;
    const skewLabel = s.skewness > 1 ? 'Strongly right-skewed' : s.skewness > 0 ? 'Slightly right-skewed' : 'Left-skewed';
    const kurtLabel = s.excess_kurtosis > 0 ? 'Leptokurtic — heavier tails than normal' : 'Platykurtic — lighter tails';

    document.getElementById('stat-strip').innerHTML = `
      <div class="stat-cell teal">
        <div class="stat-val">${s.mean?.toFixed(2) ?? '—'}</div>
        <div class="stat-name">Mean (LPA)</div>
        <div class="stat-def">Sum ÷ count. Pulled up by high earners above median.</div>
      </div>
      <div class="stat-cell blue">
        <div class="stat-val">${s.median?.toFixed(2) ?? '—'}</div>
        <div class="stat-name">Median (LPA)</div>
        <div class="stat-def">Middle value when sorted. More honest than mean for skewed data.</div>
      </div>
      <div class="stat-cell warn">
        <div class="stat-val">${s.std_dev?.toFixed(2) ?? '—'}</div>
        <div class="stat-name">Std Dev</div>
        <div class="stat-def">Average spread from mean across all ${s.n} jobs.</div>
      </div>
      <div class="stat-cell danger">
        <div class="stat-val">${s.skewness?.toFixed(2) ?? '—'}</div>
        <div class="stat-name">Skewness</div>
        <div class="stat-def">${skewLabel}. Long tail of high-pay specialist roles.</div>
      </div>
      <div class="stat-cell purple">
        <div class="stat-val">${s.excess_kurtosis?.toFixed(2) ?? '—'}</div>
        <div class="stat-name">Kurtosis</div>
        <div class="stat-def">${kurtLabel}.</div>
      </div>
      <div class="stat-cell blue">
        <div class="stat-val">${s.n}</div>
        <div class="stat-name">Sample Size</div>
        <div class="stat-def">n=${s.n}. Above 30-sample threshold for Z-tests and CLT.</div>
      </div>`;
  } catch(e) {
    document.getElementById('stat-strip').innerHTML =
      '<div style="grid-column:1/-1;padding:1rem;font-family:var(--font-mono);font-size:.72rem;color:var(--danger);">Could not load — is the API running?</div>';
  }
}

// ── SECTION 2: Salary Predictor ──────────────────────────────
async function initPredictor() {
  try {
    const [roles, cities, bench, skillRows, reg] = await Promise.all([
      get('/api/sml/salary-by-role'),
      get('/api/sml/salary-by-city'),
      get('/api/dss/salary-benchmarks'),
      get('/api/nlp/keyword-frequency'),
      get('/api/sml/regression/exp-vs-salary'),
    ]);

    OVERALL  = bench.overall_avg ?? null;
    REG_DATA = reg;

    // Role dropdown + map
    ROLE_MAP = {};
    roles.filter(r => r.role !== 'Other').forEach(r => { ROLE_MAP[r.role] = r.avg_salary; });
    // Derive overall from role map if bench didn't return it
    if (OVERALL === null) {
      const vals = Object.values(ROLE_MAP);
      OVERALL = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    const roleEl = document.getElementById('p-role');
    if (roleEl) roleEl.innerHTML = Object.keys(ROLE_MAP).map(r => `<option value="${r}">${r}</option>`).join('');

    // City dropdown + map
    CITY_MAP = {};
    cities.forEach(c => { CITY_MAP[c.city] = c.avg_salary; });
    const cityEl = document.getElementById('p-city');
    if (cityEl) cityEl.innerHTML = Object.keys(CITY_MAP).map(c => `<option value="${c}">${c}</option>`).join('');

    // Skill dropdown from top skills
    const skillEl = document.getElementById('p-skill');
    if (skillEl) skillEl.innerHTML = skillRows.slice(0, 10).map(s => `<option value="${s.skill_name}">${s.skill_name}</option>`).join('');

    window.updatePrediction();
  } catch(e) { console.warn('Predictor init:', e); }
}

window.updatePrediction = function() {
  const role = document.getElementById('p-role')?.value;
  const city = document.getElementById('p-city')?.value;
  const exp  = +(document.getElementById('p-exp')?.value ?? 2);
  if (!role || !ROLE_MAP[role]) return;

  const base      = ROLE_MAP[role] ?? OVERALL ?? 0;
  const cityAvg   = CITY_MAP[city] ?? OVERALL ?? base;
  const cityAdj   = cityAvg - (OVERALL ?? base);
  const slope     = REG_DATA.slope ?? 0;
  // expFactor: slope / base gives % lift per year of experience.
  // Floor at 0.85 is the Adzuna data min — role always dominates.
  const expFloor  = 1 - Math.min(0.15, Math.abs(slope * 5 / (base || 1)));
  const expFactor = Math.max(1 + (exp * slope / (base || 1)), expFloor);
  const predicted = (base + cityAdj) * expFactor;
  // Confidence band width: ±1 std_dev expressed as % of predicted, capped at ±20%
  const halfBand  = STATS.std_dev ? Math.min(STATS.std_dev / (predicted || 1), 0.20) : 0.12;
  const lo = (predicted * (1 - halfBand)).toFixed(1);
  const hi = (predicted * (1 + halfBand)).toFixed(1);

  const el = document.getElementById('pred-result');
  if (!el) return;
  el.classList.add('has-result');
  el.innerHTML = `
    <div>
      <div style="font-family:var(--font-mono);font-size:.65rem;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:.5rem;">Predicted Salary</div>
      <div class="pred-salary">₹${predicted.toFixed(1)} <span style="font-size:1.5rem;color:var(--muted)">LPA</span></div>
      <div class="pred-range-text">Confidence range: ₹${lo}L – ₹${hi}L</div>
      <div class="pred-breakdown">
        <div class="pred-row"><span>Role baseline (${role})</span><span>₹${base.toFixed(1)}L</span></div>
        <div class="pred-row"><span>City adjustment (${city})</span><span>${cityAdj >= 0 ? '+' : ''}₹${cityAdj.toFixed(2)}L</span></div>
        <div class="pred-row"><span>Exp multiplier (${exp} yr)</span><span>×${expFactor.toFixed(3)}</span></div>
        <div class="pred-row" style="border-top:1px solid var(--border);padding-top:.5rem;margin-top:.25rem;color:var(--text);font-weight:600;">
          <span>Final estimate</span><span style="color:var(--teal)">₹${predicted.toFixed(1)}L</span>
        </div>
      </div>
    </div>`;

  const fb = document.getElementById('formula-box');
  if (fb) fb.textContent = `₹${predicted.toFixed(1)}L = (${base.toFixed(1)} ${cityAdj >= 0 ? '+' : ''}${cityAdj.toFixed(2)}) × ${expFactor.toFixed(3)}`;
};

// ── SECTION 3: Regression ─────────────────────────────────────
async function renderRegression() {
  try {
    const reg = await get('/api/sml/regression/exp-vs-salary');
    REG_DATA  = reg;
    const { slope, intercept, r_squared: r2, r, mae, points } = reg;

    const slopeEl = document.getElementById('slope-display');
    const r2El    = document.getElementById('r2-display');
    if (slopeEl) slopeEl.textContent = slope.toFixed(3);
    if (r2El)    r2El.textContent    = r2.toFixed(3);

    document.getElementById('reg-stats').innerHTML = `
      <span class="reg-badge">slope = ${slope.toFixed(3)}</span>
      <span class="reg-badge">intercept = ${intercept.toFixed(2)}</span>
      <span class="reg-badge ${r2 < 0.1 ? 'warn' : 'ok'}">R² = ${r2.toFixed(3)}</span>
      <span class="reg-badge">r = ${r.toFixed(3)}</span>
      <span class="reg-badge">MAE = ${mae.toFixed(2)} LPA</span>`;

    const xs     = points.map(d => d.experience_years);
    // Fetch scatter points using actual DB count — no hardcoded limit
    let scatterLimit = 500;
    try {
      const summary = await get('/api/eda/summary');
      scatterLimit = summary.total_jobs ?? 500;
    } catch { /* use default */ }
    const rawData = await get(`/api/jobs?limit=${scatterLimit}`);
    const scatter = rawData
      .filter(j => j.experience_max > 0 && j.salary_avg)
      .map(j => ({ x: j.experience_max + (Math.random()-.5)*.3, y: +j.salary_avg + (Math.random()-.5)*.1 }));

    const lineX = xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 15];
    const lineY = lineX.map(x => intercept + slope * x);

    new Chart(document.getElementById('regressionChart'), {
      type: 'scatter',
      data: {
        datasets: [
          { label:'Job listings', data:scatter, backgroundColor:'rgba(79,139,255,.25)', borderColor:'rgba(79,139,255,.5)', pointRadius:3, pointHoverRadius:5 },
          { label:'Regression line', data:lineX.map((x,i)=>({x,y:lineY[i]})), type:'line', borderColor:'#00c9d4', borderWidth:2, pointRadius:0, fill:false }
        ]
      },
      options: {
        plugins:{ legend:{ labels:{ color:'#5a6075', font:{ family:'DM Mono', size:10 } } } },
        scales:{
          x:{ title:{ display:true, text:'Experience (years)', color:'#5a6075', font:{family:'DM Mono',size:10} }, ticks:{ color:'#5a6075', font:{family:'DM Mono',size:10} }, grid:{ color:'#1a1f2e' } },
          y:{ title:{ display:true, text:'Salary Avg (LPA)', color:'#5a6075', font:{family:'DM Mono',size:10} }, ticks:{ color:'#5a6075', font:{family:'DM Mono',size:10}, callback:v=>'₹'+v+'L' }, grid:{ color:'#1a1f2e' } }
        }
      }
    });
  } catch(e) { console.warn('Regression:', e); }
}

// ── SECTION 4: Feature importance ────────────────────────────
async function renderFeatureImportance() {
  try {
    const fi = await get('/api/sml/feature-importance');
    document.getElementById('fi-bars').innerHTML = fi.map(f => `
      <div class="fi-bar-row">
        <div class="fi-label">${f.feature}</div>
        <div class="fi-track"><div class="fi-fill" style="width:0%;background:${f.color}" data-w="${f.importance_pct}"></div></div>
        <div class="fi-pct">${f.importance_pct}%</div>
      </div>`).join('');
    setTimeout(() => document.querySelectorAll('#fi-bars .fi-fill').forEach(b => b.style.width = b.dataset.w + '%'), 100);
  } catch(e) { console.warn('Feature importance:', e); }

  try {
    const roles  = await get('/api/sml/salary-by-role');
    const filtered = roles.filter(r => r.role !== 'Other');
    const maxR   = Math.max(...filtered.map(r => r.avg_salary));
    const cols   = ['#00c9d4','#4f8bff','#b57bee','#00e5a0','#ffb340','#ff4f6b'];
    document.getElementById('role-range-bars').innerHTML = filtered.map((r, i) => `
      <div class="fi-bar-row">
        <div class="fi-label" style="font-size:.65rem">${r.role}</div>
        <div class="fi-track"><div class="fi-fill" style="width:${(r.avg_salary/maxR)*100}%;background:${cols[i%cols.length]}"></div></div>
        <div class="fi-pct">₹${r.avg_salary}L</div>
      </div>`).join('');
  } catch(e) { console.warn('Role bars:', e); }
}

// ── SECTION 5: Distribution ───────────────────────────────────
async function renderDistribution() {
  try {
    const sal  = await get('/api/sml/stats/distribution');
    const cols = ['rgba(79,139,255,.4)','rgba(0,201,212,.5)','rgba(0,201,212,.5)','rgba(255,179,64,.4)','rgba(255,79,107,.4)','rgba(181,123,238,.4)'];
    new Chart(document.getElementById('distChart'), {
      type: 'bar',
      data: {
        labels: sal.map(d => d.bucket),
        datasets: [{ data:sal.map(d=>d.count), backgroundColor:sal.map((_,i)=>cols[i%cols.length]), borderWidth:1, borderRadius:5 }]
      },
      options:{
        plugins:{ legend:{ display:false } },
        scales:{ x:{ ticks:{ color:'#5a6075', font:{family:'DM Mono',size:10} }, grid:{ color:'#1a1f2e' } }, y:{ ticks:{ color:'#5a6075', font:{family:'DM Mono',size:10} }, grid:{ color:'#1a1f2e' } } }
      }
    });
  } catch(e) { console.warn('Dist chart:', e); }

  try {
    const s   = Object.keys(STATS).length ? STATS : await get('/api/sml/stats/summary');
    const vals  = [s.min, s.q1, s.median, s.q3, s.max];
    const range = (s.max - s.min) || 1;
    const pct   = v => ((v - s.min) / range * 90 + 5);

    document.getElementById('boxplot').innerHTML = `
      <div class="bp-line"></div>
      <div class="bp-box" style="left:${pct(s.q1)}%;width:${pct(s.q3)-pct(s.q1)}%"></div>
      <div class="bp-median" style="left:${pct(s.median)}%"></div>
      <div class="bp-whisker" style="left:${pct(s.min)}%"></div>
      <div class="bp-whisker" style="left:${pct(s.max)}%"></div>`;

    document.getElementById('bp-labels').innerHTML =
      `<span>Min ${s.min}</span><span>Q1 ${s.q1}</span><span>Median ${s.median}</span><span>Q3 ${s.q3}</span><span>Max ${s.max}</span>`;

    const labs = ['Min','Q1','Median','Q3','Max'];
    const tcols = ['var(--muted)','var(--teal)','var(--warn)','var(--teal)','var(--muted)'];
    document.getElementById('five-num').innerHTML = vals.map((v, i) => `
      <div style="text-align:center;">
        <div style="font-family:var(--font-head);font-size:1.1rem;font-weight:700;color:${tcols[i]}">₹${v}L</div>
        <div style="font-family:var(--font-mono);font-size:.58rem;color:var(--muted);margin-top:.2rem;">${labs[i]}</div>
      </div>`).join('');
  } catch(e) { console.warn('Box plot:', e); }
}

// ── SECTION 6: Hypothesis testing ─────────────────────────────
async function renderHypothesis() {
  const renderTest = (data, elId) => {
    const reject = data.reject_null;
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:.72rem;color:var(--muted);margin-bottom:.75rem;line-height:1.8;">
        ${data.group_a.name}: x̄ = ₹${data.group_a.mean}L, n = ${data.group_a.n}<br/>
        ${data.group_b.name}: x̄ = ₹${data.group_b.mean}L, n = ${data.group_b.n}<br/>
        Z = <strong style="color:var(--text)">${data.z_statistic}</strong> &nbsp;|&nbsp;
        p = <strong style="color:${reject?'var(--accent)':'var(--warn)'}">p ${data.p_value}</strong>
      </div>
      <div class="p-meter"><div class="p-fill" style="width:${Math.min(Math.abs(data.z_statistic)/5*100,100)}%"></div></div>
      <div class="hyp-result ${reject?'reject':'fail'}">
        <div class="hyp-icon">${reject?'✅':'⚠️'}</div>
        <div class="hyp-text"><strong>${reject?'Reject H₀':'Fail to Reject H₀'}</strong><br/>${data.conclusion}</div>
      </div>`;
  };
  try {
    const [h1, h2] = await Promise.all([
      get('/api/sml/hypothesis/data-engineers-vs-rest'),
      get('/api/sml/hypothesis/bangalore-vs-rest'),
    ]);
    renderTest(h1, 'hyp1-result');
    renderTest(h2, 'hyp2-result');
  } catch(e) { console.warn('Hypothesis:', e); }
}

// ── SECTION 7: Model evaluation ───────────────────────────────
async function renderModelEval() {
  try {
    const data = await get('/api/sml/model/evaluation');
    // Gauge thresholds are data-driven: MAE/RMSE relative to mean salary, R² standard cutoffs
    const meanSal = STATS.mean ?? (OVERALL ?? 10);
    const maeThresh  = meanSal * 0.30;  // acceptable if error < 30% of mean
    const rmseThresh = meanSal * 0.40;  // rmse is always ≥ mae, wider band
    const maeVerdict  = data.mae  < meanSal * 0.15 ? { cls:'good', lbl:'Good' }
                      : data.mae  < maeThresh       ? { cls:'ok',   lbl:'Acceptable' }
                      :                               { cls:'poor',  lbl:'High Error' };
    const rmseVerdict = data.rmse < meanSal * 0.20 ? { cls:'good', lbl:'Good' }
                      : data.rmse < rmseThresh       ? { cls:'ok',   lbl:'Acceptable' }
                      :                               { cls:'poor',  lbl:'High Error' };
    const r2Verdict   = data.r_squared >= 0.7 ? { cls:'good', lbl:'Strong' }
                      : data.r_squared >= 0.4 ? { cls:'ok',   lbl:'Moderate' }
                      :                         { cls:'poor',  lbl:'Low — data limit' };

    document.getElementById('eval-grid').innerHTML = [
      { name:'MAE',  val:`₹${data.mae}L`,     fill:Math.min(data.mae /maeThresh *100, 100),  color:'var(--accent)', verdict:maeVerdict,  def:`Off by ₹${data.mae}L on average across ${data.n} jobs.` },
      { name:'RMSE', val:`₹${data.rmse}L`,    fill:Math.min(data.rmse/rmseThresh*100, 100),  color:'var(--warn)',   verdict:rmseVerdict, def:'Penalises large errors more than MAE.' },
      { name:'R²',   val:`${data.r_squared}`, fill:Math.max(data.r_squared*100, 0.5),        color:'var(--danger)', verdict:r2Verdict,   def:`Explains ${(data.r_squared*100).toFixed(1)}% of variance. Expected given role-level salary bucketing.` },
    ].map(m => `
      <div class="card eval-gauge">
        <div class="gauge-val" style="color:${m.color}">${m.val}</div>
        <div class="gauge-name">${m.name}</div>
        <div class="gauge-bar"><div class="gauge-fill" style="width:${m.fill}%;background:${m.color}"></div></div>
        <div class="gauge-scale"><span>Best</span><span>Worst</span></div>
        <div class="verdict ${m.verdict.cls}">${m.verdict.lbl}</div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:.75rem;line-height:1.5;">${m.def}</div>
      </div>`).join('');

    if (data.sample?.length) {
      const actuals   = data.sample.map(d => +d.actual);
      const predicted = data.sample.map(d => +d.predicted);
      const minV = Math.min(...actuals, ...predicted) - 0.5;
      const maxV = Math.max(...actuals, ...predicted) + 0.5;
      new Chart(document.getElementById('actualVsPred'), {
        type: 'scatter',
        data: {
          datasets: [
            { label:'Predictions', data:actuals.map((a,i)=>({x:a,y:predicted[i]})), backgroundColor:'rgba(0,201,212,.35)', borderColor:'#00c9d4', pointRadius:5 },
            { label:'Perfect fit', data:[{x:minV,y:minV},{x:maxV,y:maxV}], type:'line', borderColor:'rgba(255,179,64,.4)', borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false }
          ]
        },
        options:{
          plugins:{ legend:{ labels:{ color:'#5a6075', font:{family:'DM Mono',size:10} } } },
          scales:{
            x:{ title:{ display:true, text:'Actual (LPA)', color:'#5a6075', font:{family:'DM Mono',size:10} }, ticks:{ color:'#5a6075', font:{family:'DM Mono',size:10}, callback:v=>'₹'+v+'L' }, grid:{ color:'#1a1f2e' } },
            y:{ title:{ display:true, text:'Predicted (LPA)', color:'#5a6075', font:{family:'DM Mono',size:10} }, ticks:{ color:'#5a6075', font:{family:'DM Mono',size:10}, callback:v=>'₹'+v+'L' }, grid:{ color:'#1a1f2e' } }
          }
        }
      });
    }
  } catch(e) { console.warn('Model eval:', e); }
}

// ── Scroll animations ─────────────────────────────────────────
function initScrollAnim() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if(e.isIntersecting){ e.target.style.opacity='1'; e.target.style.transform='none'; } });
  }, { threshold:.06 });
  document.querySelectorAll('.anim').forEach(el => obs.observe(el));
}

// Export for index.html router
// ── Exports for index.html ────────────────────────────────────
// index.html has its own simpler SML page with different element IDs
// These exports serve that page without affecting sml.html

export async function loadSML() {
  // Load salary charts for index.html's page-sml
  try {
    const [cities, roles] = await Promise.all([
      get('/api/sml/salary-by-city'),
      get('/api/sml/salary-by-role'),
    ]);

    // index.html uses renderBar from router.js — replicate inline here
    const renderIndexBar = (id, data, lk, vk) => {
      const el = document.getElementById(id);
      if (!el || !data?.length) return;
      const max  = Math.max(...data.map(d => d[vk]));
      const cols = ['#00e5a0','#4f8bff','#ffb340','#ff4f6b','#b57bee','#00d48a','#6ec6ff','#ffd080'];
      el.innerHTML = data.map((d, i) => `
        <div class="bar-row">
          <div class="bar-label" title="${d[lk]}">${d[lk]}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(d[vk]/max)*100}%;background:${cols[i%cols.length]}"></div></div>
          <div class="bar-val">${typeof d[vk]==='number'&&d[vk]%1!==0?d[vk].toFixed(1):d[vk]}</div>
        </div>`).join('');
    };

    renderIndexBar('sml-salary-city',  cities, 'city', 'avg_salary');
    renderIndexBar('sml-salary-title', roles.filter(r => r.role !== 'Other'), 'role', 'avg_salary');

    // Store for predictSalary to use
    window._SML_ROLE_MAP = {};
    window._SML_CITY_MAP = {};
    window._SML_OVERALL  = null;
    roles.forEach(r => { window._SML_ROLE_MAP[r.role] = r.avg_salary; });
    cities.forEach(c => { window._SML_CITY_MAP[c.city] = c.avg_salary; });
    const bench = await get('/api/dss/salary-benchmarks');
    // overall_avg from DB — if missing, derive from role averages
    window._SML_OVERALL = bench.overall_avg ?? (() => {
      const vals = Object.values(window._SML_ROLE_MAP);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    })();
    const reg = await get('/api/sml/regression/exp-vs-salary');
    window._SML_SLOPE = reg.slope ?? 0;   // 0 = no experience effect — valid neutral fallback
    window._SML_R2    = reg.r_squared ?? 0;
  } catch(e) { console.warn('loadSML (index):', e); }
}

export function predictSalary() {
  // Works with index.html element IDs: mlRole, mlLoc, mlExp, predValue, predRange, predResult
  const role = document.getElementById('mlRole')?.value;
  const loc  = document.getElementById('mlLoc')?.value;
  const exp  = +(document.getElementById('mlExp')?.value ?? 2);

  const roleMap  = window._SML_ROLE_MAP ?? {};
  const cityMap  = window._SML_CITY_MAP ?? {};
  const slope    = window._SML_SLOPE    ?? 0;
  const r2       = window._SML_R2       ?? 0;

  // Derive overall from role map if not fetched yet
  const storedOverall = window._SML_OVERALL;
  const roleVals = Object.values(roleMap);
  const overall  = storedOverall ?? (roleVals.length ? roleVals.reduce((a, b) => a + b, 0) / roleVals.length : 0);

  const base      = roleMap[role]  ?? overall;
  const cityAvg   = cityMap[loc]   ?? overall;
  const cityAdj   = cityAvg - overall;
  const expFactor = Math.max(1 + (exp * slope / (base || 1)), 0.85);
  const salary    = ((base + cityAdj) * expFactor).toFixed(1);
  const lo        = (salary * 0.88).toFixed(1);
  const hi        = (salary * 1.12).toFixed(1);

  const valEl   = document.getElementById('predValue');
  const rangeEl = document.getElementById('predRange');
  const resEl   = document.getElementById('predResult');

  if (valEl)   valEl.textContent   = `₹${salary} LPA`;
  if (rangeEl) rangeEl.textContent = `Confidence range: ₹${lo}L – ₹${hi}L  |  Model R²: ${r2} (real data)`;
  if (resEl)   resEl.classList.add('show');
}

// ── BOOT — only self-executes on sml.html ─────────────────────
// Guard: sml.html has #stat-strip, index.html does not
if (document.getElementById('stat-strip')) {
  (async () => {
    await checkAPI();
    initScrollAnim();
    loadRowCount();
    loadFooterStats();
    await renderStatStrip();
    await initPredictor();
    await Promise.all([
      renderRegression(),
      renderFeatureImportance(),
      renderDistribution(),
      renderHypothesis(),
      renderModelEval(),
    ]);
  })();
}