// ─── PAGE ROUTING ─────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
  window.scrollTo(0, 0);
}

// ─── COUNTER ANIMATION ────────────────────────────────────────
function animateCounters() {
  document.querySelectorAll('[data-target]').forEach(el => {
    const target = +el.dataset.target;
    const suffix = el.textContent.includes('%') ? '%' : '';
    let current = 0;
    const step = target / 60;
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = Math.floor(current).toLocaleString() + suffix;
      if (current >= target) clearInterval(timer);
    }, 16);
  });
}
setTimeout(animateCounters, 400);

// ─── SKILLS CHART ─────────────────────────────────────────────
const skillsData = [
  { name: 'Python',    val: 500, color: '#00e5a0' },
  { name: 'SQL',       val: 420, color: '#4f8bff' },
  { name: 'Power BI',  val: 320, color: '#ffb340' },
  { name: 'Excel',     val: 290, color: '#ff4f6b' },
  { name: 'Tableau',   val: 240, color: '#b57bee' },
  { name: 'R',         val: 180, color: '#00e5a0' },
  { name: 'Spark',     val: 150, color: '#4f8bff' },
];

function renderBarChart(containerId, data) {
  const max = Math.max(...data.map(d => d.val));
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = data.map(d => `
    <div class="bar-row">
      <div class="bar-label">${d.name}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(d.val/max)*100}%;background:${d.color}"></div>
      </div>
      <div class="bar-val">${d.val}</div>
    </div>
  `).join('');
}

const locationData = [
  { name: 'Bangalore', val: 4200, color: '#00e5a0' },
  { name: 'Mumbai',    val: 2800, color: '#4f8bff' },
  { name: 'Delhi NCR', val: 2400, color: '#ffb340' },
  { name: 'Hyderabad', val: 1800, color: '#ff4f6b' },
  { name: 'Pune',      val: 1200, color: '#b57bee' },
];

renderBarChart('skillsChart', skillsData);
renderBarChart('locationChart', locationData);
renderBarChart('edaSkillsChart', skillsData);

// ─── SALARY HISTOGRAM ─────────────────────────────────────────
function renderHistogram(id, heights) {
  const el = document.getElementById(id);
  if (!el) return;
  const max = Math.max(...heights);
  el.innerHTML = heights.map((h, i) => {
    const colors = ['#4f8bff','#00e5a0','#00e5a0','#00e5a0','#ffb340','#ff4f6b','#b57bee'];
    return `<div class="hist-bar" style="height:${(h/max)*100}%;background:${colors[i%colors.length]}"></div>`;
  }).join('');
}

renderHistogram('salaryHist',  [20, 60, 100, 90, 70, 40, 15]);
renderHistogram('edaSalaryHist', [18, 55, 100, 88, 65, 35, 12]);

// ─── NLP DEMO ─────────────────────────────────────────────────
const knownSkills = [
  'python','sql','power bi','tableau','excel','r','spark','aws','azure','gcp',
  'machine learning','deep learning','tensorflow','pytorch','pandas','numpy',
  'scikit-learn','matplotlib','plotly','looker','dbt','airflow','kafka',
  'hadoop','hive','scala','java','javascript','react','fastapi','flask',
  'docker','kubernetes','git','mongodb','postgresql','mysql','snowflake',
  'databricks','pyspark','nlp','statistics','regression','classification'
];

function extractSkills() {
  const text = document.getElementById('jdInput').value.toLowerCase();
  if (!text.trim()) {
    alert('Please paste a job description first!');
    return;
  }
  const found = knownSkills.filter(s => text.includes(s));
  const roleKeywords = {
    'Data Scientist': ['machine learning','deep learning','tensorflow','pytorch','nlp'],
    'Data Analyst': ['sql','power bi','tableau','excel','looker'],
    'Data Engineer': ['spark','kafka','airflow','hadoop','dbt','databricks'],
    'ML Engineer': ['tensorflow','pytorch','kubernetes','docker'],
  };
  let detectedRole = 'Data Analyst';
  let maxHits = 0;
  for (const [role, kws] of Object.entries(roleKeywords)) {
    const hits = kws.filter(k => text.includes(k)).length;
    if (hits > maxHits) { maxHits = hits; detectedRole = role; }
  }

  const skillDiv = document.getElementById('skillOutput');
  const roleDiv  = document.getElementById('roleOutput');

  if (found.length === 0) {
    skillDiv.innerHTML = '<p style="font-family:var(--font-mono);font-size:0.72rem;color:var(--muted);">No known skills detected. Try pasting a real job description.</p>';
  } else {
    skillDiv.innerHTML = found.map((s, i) =>
      `<span class="skill-chip" style="animation-delay:${i*0.05}s">${s.charAt(0).toUpperCase()+s.slice(1)}</span>`
    ).join('');
  }

  roleDiv.innerHTML = `
    <div class="skill-chip" style="background:rgba(79,139,255,0.1);border-color:rgba(79,139,255,0.3);color:var(--accent2)">
      🏷️ ${detectedRole}
    </div>
  `;
}

// ─── SALARY PREDICTION ────────────────────────────────────────
function predictSalary() {
  const exp   = +document.getElementById('mlExp').value;
  const loc   = document.getElementById('mlLoc').value;
  const role  = document.getElementById('mlRole').value;

  const base = { 'Data Analyst': 6, 'Data Scientist': 8, 'Data Engineer': 9, 'BI Analyst': 6.5 }[role] || 7;
  const locBonus = { 'Bangalore': 1.4, 'Mumbai': 1.2, 'Delhi NCR': 1.1, 'Hyderabad': 1.15, 'Pune': 1.0, 'Chennai': 1.0 }[loc] || 1;
  const expBonus = 1 + exp * 0.12;
  const noise = 0.9 + Math.random() * 0.2;
  const salary = (base * locBonus * expBonus * noise).toFixed(1);
  const lo = (salary * 0.87).toFixed(1);
  const hi = (salary * 1.13).toFixed(1);

  const res = document.getElementById('predResult');
  document.getElementById('predValue').textContent = `₹${salary} LPA`;
  document.getElementById('predRange').textContent = `Confidence range: ₹${lo}L – ₹${hi}L  |  Model R²: 0.82 (simulated)`;
  res.classList.add('show');
}
