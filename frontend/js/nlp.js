// ─── nlp.js ───────────────────────────────────────────────────
import { getKeywordFreq } from './api.js';
import { renderBar } from './router.js';
import { checkHealth, getDashKPIs, API } from './api.js';

const KNOWN_SKILLS = [
  'python','r','scala','sql','mysql','postgresql','mongodb','snowflake',
  'power bi','tableau','looker','excel','matplotlib','plotly',
  'aws','azure','gcp','databricks','machine learning','deep learning',
  'nlp','tensorflow','pytorch','scikit-learn','spark','kafka',
  'airflow','dbt','pandas','numpy','hadoop','javascript',
  'docker','kubernetes','git','fastapi','flask','statistics',
  'regression','classification','pyspark'
];

const ROLE_MAP = {
  'Data Scientist':  ['machine learning','deep learning','tensorflow','pytorch','nlp'],
  'Data Analyst':    ['sql','power bi','tableau','excel','looker'],
  'Data Engineer':   ['spark','kafka','airflow','hadoop','dbt','databricks'],
  'ML Engineer':     ['tensorflow','pytorch','deep learning','kubernetes','docker'],
};

export async function loadNLP() {
  try {
    const s = await getKeywordFreq();
    renderBar('nlp-skills', s.slice(0, 12), 'skill_name', 'frequency');
  } catch (e) { console.warn('NLP:', e); }
}

export function extractSkills() {
  const text = document.getElementById('jdInput').value.toLowerCase();
  if (!text.trim()) { alert('Please paste a job description first!'); return; }

  const found = KNOWN_SKILLS.filter(s => {
    const pattern = new RegExp('\\b' + s.replace(/ /g, '\\s+') + '\\b');
    return pattern.test(text);
  });

  let detectedRole = 'Data Analyst', maxHits = 0;
  for (const [role, kws] of Object.entries(ROLE_MAP)) {
    const hits = kws.filter(k => text.includes(k)).length;
    if (hits > maxHits) { maxHits = hits; detectedRole = role; }
  }

  document.getElementById('skillOutput').innerHTML = found.length
    ? found.map((s, i) => `<span class="skill-chip" style="animation-delay:${i * .05}s">${s.charAt(0).toUpperCase() + s.slice(1)}</span>`).join('')
    : '<p style="font-family:var(--font-mono);font-size:.72rem;color:var(--muted);">No skills found. Try a real job description.</p>';

  document.getElementById('roleOutput').innerHTML =
    `<span class="skill-chip" style="background:rgba(79,139,255,.1);border-color:rgba(79,139,255,.3);color:var(--accent2)">🏷 ${detectedRole}</span>`;
}


// ── STATE ──────────────────────────────────────────────────────
let resumeText    = '';
let selectedJD    = null;
let selectedTone  = 'normal';
let scoreRingInst = null;
let parsedData    = null;

// ── HELPERS ───────────────────────────────────────────────────
async function post(endpoint, formData) {
  const r = await fetch(API + endpoint, { method: 'POST', body: formData });
  if (!r.ok) { const err = await r.json(); throw new Error(err.detail || 'API error'); }
  return r.json();
}
async function get(ep) {
  const r = await fetch(API + ep);
  if (!r.ok) throw new Error(ep);
  return r.json();
}
function toggleLearn(id) {
  const box = document.getElementById(id);
  box.classList.toggle('open');
}

// ── FILE UPLOAD ────────────────────────────────────────────────
async function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return;

  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = (file.size / 1024).toFixed(1) + ' KB · Extracting...';
  document.getElementById('fileInfo').classList.add('show');
  document.getElementById('uploadZone').classList.add('has-file');

  // TXT — read directly in browser
  if (file.name.toLowerCase().endsWith('.txt')) {
    resumeText = await file.text();
    document.getElementById('fileSize').textContent = (file.size / 1024).toFixed(1) + ' KB · Ready';
    await parseResumeAndMatch();
    return;
  }

  // PDF — send to backend for proper pdfplumber extraction
  if (file.name.toLowerCase().endsWith('.pdf')) {
    document.getElementById('parsedCard').classList.add('show');
    document.getElementById('parsedContent').innerHTML = '<div class="loading-inline"><div class="spinner-sm"></div>Extracting PDF text on server...</div>';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(API + '/api/nlp/extract-pdf', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) {
        document.getElementById('parsedContent').innerHTML = `<p style="font-family:var(--font-mono);font-size:.75rem;color:var(--warn);">⚠️ ${data.detail}<br/><br/><span style="color:var(--muted)">Please paste your resume text in the box on the right instead.</span></p>`;
        return;
      }
      resumeText = data.text;
      document.getElementById('fileSize').textContent = `${(file.size/1024).toFixed(1)} KB · ${data.pages} page${data.pages>1?'s':''} · ${data.char_count} chars extracted`;
      await parseResumeAndMatch();
    } catch (e) {
      document.getElementById('parsedContent').innerHTML = `<p style="font-family:var(--font-mono);font-size:.72rem;color:var(--danger);">Extraction failed: ${e.message}</p>`;
    }
    return;
  }

  alert('Please upload a PDF or TXT. For DOCX, paste your resume text instead.');
}

function clearFile() {
  resumeText = '';
  selectedJD = null;
  parsedData = null;
  document.getElementById('resumeFile').value = '';
  document.getElementById('fileInfo').classList.remove('show');
  document.getElementById('uploadZone').classList.remove('has-file');
  document.getElementById('parsedCard').classList.remove('show');
  document.getElementById('jdMatchesWrap').innerHTML = '<div class="loading-inline"><div class="spinner-sm"></div>Finding best matches...</div>';
  document.getElementById('analyseBtn').disabled = true;
  document.getElementById('resultsPanel').classList.remove('show');
  document.getElementById('loadingState').classList.remove('show');
}

async function parseResumeText() {
  const text = document.getElementById('resumePaste').value.trim();
  if (!text) { alert('Please paste some resume text first.'); return; }
  resumeText = text;
  await parseResumeAndMatch();
}

// ── PARSE + MATCH ──────────────────────────────────────────────
async function parseResumeAndMatch() {
  if (!resumeText || resumeText.length < 50) {
    alert('Could not extract enough text. For PDFs, please use the paste option and copy-paste your resume text.');
    return;
  }

  // Show parsed card loading
  document.getElementById('parsedCard').classList.add('show');
  document.getElementById('parsedContent').innerHTML = '<div class="loading-inline"><div class="spinner-sm"></div>Parsing with Groq...</div>';

  try {
    // Step 1: Parse resume
    const fd = new FormData();
    fd.append('resume_text', resumeText);
    parsedData = await post('/api/nlp/parse-resume', fd);

    // Show parsed info
    document.getElementById('parsedContent').innerHTML = `
      <div class="parsed-row"><span class="parsed-key">Detected Role</span><span class="parsed-val" style="color:var(--purple)">${parsedData.detected_role}</span></div>
      <div class="parsed-row"><span class="parsed-key">Experience</span><span class="parsed-val">${parsedData.years_experience} year${parsedData.years_experience !== 1 ? 's' : ''}</span></div>
      <div class="parsed-row"><span class="parsed-key">Education</span><span class="parsed-val">${parsedData.education}</span></div>
      <div class="parsed-row"><span class="parsed-key">Top Skills</span><span class="parsed-val">${parsedData.top_skills?.join(', ') || '—'}</span></div>
      <div class="parsed-row" style="border:none"><span class="parsed-key">Summary</span><span class="parsed-val" style="font-size:.72rem;color:var(--muted);max-width:280px;text-align:right;">${parsedData.summary}</span></div>`;

    // Step 2: Fetch matching JDs
    document.getElementById('jdMatchesWrap').innerHTML = '<div class="loading-inline"><div class="spinner-sm"></div>Querying database for matching jobs...</div>';

    const fd2 = new FormData();
    fd2.append('role', parsedData.detected_role || '');
    fd2.append('skills', parsedData.top_skills?.join(', ') || '');
    const jds = await post('/api/nlp/match-jds', fd2);

    renderJDMatches(jds);
    updateAnalyseButton();

  } catch (e) {
    document.getElementById('parsedContent').innerHTML = `<p style="font-family:var(--font-mono);font-size:.72rem;color:var(--danger);">Error: ${e.message}</p>`;
    console.error(e);
  }
}

// ── RENDER JD MATCHES ─────────────────────────────────────────
function renderJDMatches(jds) {
  if (!jds?.length) {
    document.getElementById('jdMatchesWrap').innerHTML = '<p style="font-family:var(--font-mono);font-size:.72rem;color:var(--muted);">No matching JDs found. Try a different role keyword.</p>';
    return;
  }

  const html = `<div class="jd-grid">${jds.map((jd, i) => `
    <div class="jd-card" onclick="selectJD(this, ${i})" data-idx="${i}" data-jd='${JSON.stringify(jd).replace(/'/g,"&#39;")}'>
      <div class="jd-title">${jd.title}</div>
      <div class="jd-company">${jd.company} · ${jd.city || 'India'}</div>
      <div class="jd-meta">
        <span class="jd-tag green">₹${jd.salary_avg}L avg</span>
        <span class="jd-tag">${jd.experience_min ?? 0}–${jd.experience_max ?? '?'} yr exp</span>
      </div>
    </div>`).join('')}</div>`;

  document.getElementById('jdMatchesWrap').innerHTML = html;

  // Auto-select first
  const first = document.querySelector('.jd-card');
  if (first) { first.classList.add('selected'); selectedJD = jds[0]; }
  updateAnalyseButton();
}

function selectJD(el, idx) {
  document.querySelectorAll('.jd-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedJD = JSON.parse(el.dataset.jd);
  updateAnalyseButton();
}

// ── TONE SELECTOR ─────────────────────────────────────────────
function selectTone(tone, btn) {
  document.querySelectorAll('.tone-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedTone = tone;

  const btn2 = document.getElementById('analyseBtn');
  btn2.className = `analyse-btn ${tone}-btn`;
  const labels = { normal:'🎯 Analyse Resume', roast:'🔥 Roast My Resume', hype:'🚀 Hype Me Up', interviewer:'😤 Interview Me' };
  btn2.textContent = labels[tone];
}

function updateAnalyseButton() {
  const btn = document.getElementById('analyseBtn');
  btn.disabled = !(resumeText && selectedJD);
}

// ── ANALYSE ───────────────────────────────────────────────────
async function analyseResume() {
  if (!resumeText || !selectedJD) return;

  document.getElementById('resultsPanel').classList.remove('show');
  document.getElementById('loadingState').classList.add('show');

  const toneMessages = {
    normal:      ['Analysing your resume...', 'Comparing against JD requirements...'],
    roast:       ['Sharpening knives...', 'Preparing to absolutely destroy your resume...'],
    hype:        ['Finding all your wins...', 'Building your confidence...'],
    interviewer: ['Putting on stern face...', 'Preparing tough questions...'],
  };
  const msgs = toneMessages[selectedTone];
  document.getElementById('loadingText').textContent    = msgs[0];
  document.getElementById('loadingSubtext').textContent = msgs[1];

  // Pulse ring color by tone
  const ringColors = { normal:'#4f8bff', roast:'#ff4f6b', hype:'#ffb340', interviewer:'#b57bee' };
  document.getElementById('loadingRing').style.borderTopColor = ringColors[selectedTone];

  try {
    const fd = new FormData();
    fd.append('resume_text', resumeText);
    fd.append('jd_text', selectedJD.description || JSON.stringify(selectedJD));
    fd.append('tone', selectedTone);

    const result = await post('/api/nlp/analyse-resume', fd);
    renderResults(result);

  } catch (e) {
    document.getElementById('loadingState').classList.remove('show');
    alert('Analysis failed: ' + e.message);
  }
}

function quickRetone(tone) {
  document.querySelectorAll('.tone-btn').forEach(b => {
    b.classList.remove('active');
    if (b.classList.contains(tone)) b.classList.add('active');
  });
  selectedTone = tone;
  const btn = document.getElementById('analyseBtn');
  btn.className = `analyse-btn ${tone}-btn`;
  analyseResume();
}

// ── RENDER RESULTS ─────────────────────────────────────────────
function renderResults(r) {
  document.getElementById('loadingState').classList.remove('show');
  document.getElementById('resultsPanel').classList.add('show');

  // Score ring
  const score = r.match_score ?? 0;
  const toneColors = { normal:'#4f8bff', roast:'#ff4f6b', hype:'#ffb340', interviewer:'#b57bee' };
  const col = toneColors[r.tone] || '#4f8bff';

  document.getElementById('scoreNum').textContent = score;
  document.getElementById('scoreNum').style.color = score >= 70 ? 'var(--accent)' : score >= 45 ? 'var(--warn)' : 'var(--danger)';
  document.getElementById('scoreRole').textContent = r.detected_role || '—';
  document.getElementById('scoreOneliner').textContent = r.one_liner || '—';
  document.getElementById('scoreSummary').textContent = r.summary || '—';

  // Doughnut ring
  const canvas = document.getElementById('scoreRing');
  if (scoreRingInst) scoreRingInst.destroy();
  scoreRingInst = new Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [score, 100 - score],
        backgroundColor: [col, 'rgba(30,34,48,1)'],
        borderWidth: 0,
        borderRadius: 4,
      }]
    },
    options: { cutout: '72%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: { duration: 800 } }
  });

  // Pros
  document.getElementById('prosList').innerHTML = (r.pros || []).map(p =>
    `<div class="pc-item"><div class="pc-dot"></div><span>${p}</span></div>`).join('');

  // Cons
  document.getElementById('consList').innerHTML = (r.cons || []).map(c =>
    `<div class="pc-item"><div class="pc-dot"></div><span>${c}</span></div>`).join('');

  // Matched skills
  document.getElementById('matchedChips').innerHTML = (r.matched_skills || []).map(s =>
    `<span class="chip chip-match">✓ ${s}</span>`).join('');

  // Missing skills
  document.getElementById('missingChips').innerHTML = (r.missing_skills || []).map(s =>
    `<span class="chip chip-miss">+ ${s}</span>`).join('');

  // ATS flags
  document.getElementById('atsFlags').innerHTML = (r.ats_flags || []).length
    ? (r.ats_flags || []).map(f => `<span class="chip chip-flag" style="display:inline-flex;margin:.2rem;">⚑ ${f}</span>`).join('')
    : '<p style="font-family:var(--font-mono);font-size:.72rem;color:var(--accent)">No major ATS flags detected ✓</p>';

  // Action items
  document.getElementById('actionItems').innerHTML = (r.action_items || []).map((a, i) =>
    `<div class="action-item"><div class="action-num">${i + 1}</div><span>${a}</span></div>`).join('');

  // Scroll to results
  document.getElementById('resultsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── SKILL FREQUENCY FROM DB ───────────────────────────────────
const COLORS = ['#00e5a0','#4f8bff','#ffb340','#ff4f6b','#b57bee','#00d48a','#6ec6ff','#ffd080','#ff8a65','#a5d6a7'];

function renderBars(id, data, lk, vk) {
  const el = document.getElementById(id);
  if (!el || !data?.length) return;
  const max = Math.max(...data.map(d => +d[vk]));
  el.innerHTML = data.map((d, i) => `
    <div class="bar-row">
      <div class="bar-label" title="${d[lk]}">${d[lk]}</div>
      <div class="bar-track"><div class="bar-fill" style="width:0%;background:${COLORS[i%COLORS.length]}" data-w="${(+d[vk]/max)*100}"></div></div>
      <div class="bar-val">${d[vk]}</div>
    </div>`).join('');
  setTimeout(() => el.querySelectorAll('.bar-fill').forEach(b => b.style.width = b.dataset.w + '%'), 60);
}

async function loadSkillStats() {
  try {
    const skills = await get('/api/nlp/keyword-frequency');
    renderBars('skillFreqBars', skills.slice(0,12), 'skill_name', 'frequency');
  } catch(e) { console.warn('Skills:', e); }

  try {
    const byRole = await get('/api/skills/by-role');
    const roles = [...new Set(byRole.map(d => d.role))].filter(r => r !== 'Other');
    let html = '';
    for (const role of roles) {
      const items = byRole.filter(d => d.role === role).slice(0, 4);
      html += `<div style="margin-bottom:1.25rem;">
        <div style="font-family:var(--font-mono);font-size:.62rem;color:var(--muted2);letter-spacing:.08em;text-transform:uppercase;margin-bottom:.5rem;padding-bottom:.3rem;border-bottom:1px solid var(--border);">${role}</div>
        ${items.map((d, i) => `
          <div class="bar-row" style="margin-bottom:.4rem;">
            <div class="bar-label">${d.skill_name}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${(d.frequency/items[0].frequency)*100}%;background:${COLORS[i]}"></div></div>
            <div class="bar-val">${d.frequency}</div>
          </div>`).join('')}
      </div>`;
    }
    document.getElementById('skillsByRoleWrap').innerHTML = html;
  } catch(e) { console.warn('Skills by role:', e); }
}

// ── API STATUS ─────────────────────────────────────────────────
async function checkAPI() {
  try {
    await get('/');
    document.getElementById('apiDot').classList.add('live');
    document.getElementById('apiLabel').textContent = 'API Live';
    document.getElementById('apiLabel').style.color = 'var(--accent)';
  } catch {
    document.getElementById('apiLabel').textContent = 'API Offline';
    document.getElementById('apiLabel').style.color = 'var(--danger)';
  }
}

// ── BOOT ──────────────────────────────────────────────────────
checkAPI();
loadSkillStats();

// Scroll animations
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.style.opacity='1'; e.target.style.transform='none'; } });
}, { threshold: 0.06 });
document.querySelectorAll('.anim').forEach(el => observer.observe(el));

// ── EXPOSE FUNCTIONS TO HTML ─────────────────────────
window.handleFileUpload = handleFileUpload;
window.clearFile = clearFile;
window.parseResumeText = parseResumeText;
window.selectJD = selectJD;
window.selectTone = selectTone;
window.analyseResume = analyseResume;
window.quickRetone = quickRetone;
window.toggleLearn = toggleLearn;

