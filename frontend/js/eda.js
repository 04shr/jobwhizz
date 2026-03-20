import { apiFetch, API } from './api.js';
const get = (ep) => apiFetch(ep);

/* ───────────────── BAR RENDERER ───────────────── */

const COLORS = [
"#00e5a0","#4f8bff","#ffb340","#ff4f6b",
"#b57bee","#00d48a","#6ec6ff","#ffd080"
];

function renderBars(id,data,label,value,suffix=""){
  const el = document.getElementById(id);
  if(!el) return;

  if(!data?.length){
    el.innerHTML = "No data";
    return;
  }

  const max = Math.max(...data.map(d => d[value]));

  el.innerHTML = data.map((d,i)=>`
    <div class="bar-row">
      <div class="bar-label">${d[label]}</div>
      <div class="bar-track">
        <div class="bar-fill"
             style="width:${(d[value]/max)*100}%;
                    background:${COLORS[i%COLORS.length]}"></div>
      </div>
      <div class="bar-val">${d[value]}${suffix}</div>
    </div>
  `).join("");
}

/* ───────────────── KPI SUMMARY ───────────────── */

async function loadKPIs(){

  const s = await get("/api/eda/summary");

  const missingPct =
    ((s.missing_salary / s.total_jobs) * 100).toFixed(1);

  document.getElementById("kpi-grid").innerHTML = `
    <div class="kpi-cell">
      <div class="kpi-val">${s.total_jobs}</div>
      <div class="kpi-label">Total Jobs</div>
    </div>

    <div class="kpi-cell">
      <div class="kpi-val blue">${s.unique_companies}</div>
      <div class="kpi-label">Companies</div>
    </div>

    <div class="kpi-cell">
      <div class="kpi-val warn">${s.unique_cities}</div>
      <div class="kpi-label">Cities</div>
    </div>

    <div class="kpi-cell">
      <div class="kpi-val">₹${s.mean_salary || "—"}L</div>
      <div class="kpi-label">Mean Salary</div>
    </div>

    <div class="kpi-cell">
      <div class="kpi-val">${s.missing_salary}</div>
      <div class="kpi-label">Null Salaries</div>
      <div class="kpi-insight">${missingPct}% missing</div>
    </div>

    <div class="kpi-cell">
      <div class="kpi-val">${s.date_range_days}</div>
      <div class="kpi-label">Days of Data</div>
    </div>
  `;

}

/* ───────────────── DATA QUALITY (REALTIME) ───────────────── */

async function loadDataQuality(){

  const schema = await get("/api/eda/schema");
  const quality = await get("/api/eda/data-quality");

  const total = (await get("/api/eda/summary")).total_jobs;

  const qMap = {};
  quality.forEach(q => qMap[q.column] = q.nulls);

  const caveats = {
  salary_avg: "warn",
  salary_max: "warn",
  city: "warn",
  date_posted: "warn",
  employment_type: "info"
};

const notes = {
  id: "Auto-increment primary key",
  title: "All listings contain titles",
  company: "Company names extracted from Adzuna API",
  city: "Some rows contain region names instead of cities",
  salary_avg: "Adzuna role-level estimate — not individual salaries",
  salary_max: "Derived from Adzuna salary benchmark",
  salary_currency: "Currency returned by API",
  experience_min: "Extracted from job description using regex",
  experience_max: "Extracted from job description using regex",
  date_posted: "Older listings default to fetch date due to API limitation",
  employment_type: "Adzuna does not return this field for India",
  description: "Used for skill extraction via regex/NLP"
};

const visibleColumns = [
"id",
"title",
"company",
"city",
"salary_avg",
"experience_min",
"experience_max",
"date_posted",
"employment_type",
"description"
];

const rows = schema
  .filter(col => visibleColumns.includes(col.column_name))
  .map(col =>{

  const nulls = qMap[col.column_name] || 0;
  const coverage = ((total-nulls)/total*100).toFixed(1);

  const status =
    caveats[col.column_name] ||
    (nulls === 0 ? "ok" :
     coverage > 90 ? "warn" : "info");

    return `
    <tr>
      <td style="color:var(--accent2);font-weight:500">${col.column_name}</td>
      <td style="color:var(--muted)">${col.data_type.toUpperCase()}</td>
      <td>${nulls}</td>
      <td>${coverage}%</td>
      <td>
        <span class="badge badge-${status}">
          ${status==="ok"?"✓ Clean":status==="warn"?"⚠ Caveat":"ℹ Note"}
        </span>
      </td>
      <td style="color:var(--muted);font-size:.7rem;">
        ${notes[col.column_name] || "Detected from database schema"}
      </td>
    </tr>
    `;

  });

  document.getElementById("dq-tbody").innerHTML = rows.join("");

}

/* ───────────────── CITY DISTRIBUTION ───────────────── */

async function loadCities(){

  const data = await get("/api/dashboard/jobs-by-city");

  renderBars("city-bars",data,"city","job_count");

  if(!data.length) return;

  const top = data[0];
  const second = data[1];

  const ratio = second
    ? (top.job_count / second.job_count).toFixed(1)
    : "—";

  document.getElementById("city-insight").innerHTML =
    `<strong>${top.city}</strong> dominates with 
    <strong>${top.job_count}</strong> listings — 
    ${ratio}× more than ${second?.city || "the next city"}.
    This reflects India's tech hiring concentration in major hubs.`;
}
/* ───────────────── SKILLS (NO HARDCODED GROUPS) ───────────────── */

async function loadSkills(){

  const skills = await get("/api/eda/skills");

  renderBars("skills-grouped",skills,"skill_name","frequency");

}

/* ───────────────── SALARY HISTOGRAM ───────────────── */

async function loadSalaryHist(){

  const data = await get("/api/dashboard/salary-distribution");

  new Chart(document.getElementById("salaryHistChart"),{

    type:"bar",

    data:{
      labels:data.map(d=>d.salary_range),

      datasets:[{
        data:data.map(d=>d.count),
        backgroundColor:"#00e5a0"
      }]
    },

    options:{
      plugins:{legend:{display:false}}
    }

  });

}

/* ───────────────── ROLE vs SALARY ───────────────── */

async function loadBivariate(){

  const roles = await get("/api/eda/salary-by-role");

  renderBars(
    "role-salary-bars",
    roles,
    "role",
    "avg_salary",
    "L"
  );

  const cities = await get("/api/eda/salary-by-city");

  renderBars(
    "city-salary-bars",
    cities,
    "city",
    "avg_salary",
    "L"
  );

}

/* ───────────────── EXPERIENCE vs SALARY ───────────────── */

function pearsonCorrelation(x,y){

  const n = x.length;

  const sumX = x.reduce((a,b)=>a+b,0);
  const sumY = y.reduce((a,b)=>a+b,0);

  const sumXY = x.reduce((s,v,i)=>s+v*y[i],0);

  const sumX2 = x.reduce((s,v)=>s+v*v,0);
  const sumY2 = y.reduce((s,v)=>s+v*v,0);

  const numerator =
    n*sumXY - sumX*sumY;

  const denominator =
    Math.sqrt(
      (n*sumX2 - sumX*sumX) *
      (n*sumY2 - sumY*sumY)
    );

  return numerator / denominator;
}

async function loadExpSalary(){

  const raw = await get("/api/eda/experience-vs-salary");

  const data = raw.filter(d => d.experience_years <= 20);

  new Chart(document.getElementById("expSalaryChart"),{

    type:"line",

    data:{
      labels:data.map(d=>d.experience_years),

      datasets:[{
        label:"Salary",
        data:data.map(d=>d.avg_salary),
        borderColor:"#4f8bff",
        tension:.4
      }]
    },

    options:{
      plugins:{legend:{display:false}},
      scales:{
        x:{title:{display:true,text:"Experience (years)"}},
        y:{title:{display:true,text:"Average Salary (LPA)"}}
      }
    }

  });

  // ─── CORRELATION CALCULATION ───

  const x = data.map(d => d.experience_years);
  const y = data.map(d => d.avg_salary);

  const r = pearsonCorrelation(x,y).toFixed(2);

  document.getElementById("corr-badge").innerHTML =
    `📊 Correlation r = ${r}`;
}


/* ───────────────── COMPANIES ───────────────── */

async function loadCompanies(){

  const data = await get("/api/dashboard/top-companies");

  renderBars(
    "company-bars",
    data,
    "company",
    "job_count"
  );

}

/* ───────────────── JOB TABLE ───────────────── */

async function loadJobs(){

  const jobs = await get("/api/jobs?limit=50");

  document.getElementById("jobs-tbody").innerHTML =
    jobs.map(j=>`
      <tr>
        <td>${j.title}</td>
        <td>${j.company}</td>
        <td>${j.city}</td>
        <td>₹${j.salary_avg}L</td>
      <td>
${
  (j.experience_min === 0 && j.experience_max === 0) ||
  j.experience_min === null ||
  j.experience_max === null
  ? '<span style="color:var(--warn)">Not specified</span>'
  : `${j.experience_min}-${j.experience_max}`
}
</td>
        <td>${j.date_posted}</td>
      </tr>
    `).join("");

}

/* ───────────────── API STATUS ───────────────── */

async function checkAPI(){

  try{
    await get("/");
    document.getElementById("apiLabel").textContent = "API Live";
  }
  catch{
    document.getElementById("apiLabel").textContent = "API Offline";
  }

}

/* ───────────────── BOOT ───────────────── */

export async function loadEDA() {

  await checkAPI();

  await Promise.all([
    loadKPIs(),
    loadDataQuality(),
    loadCities(),
    loadSkills(),
    loadSalaryHist(),
    loadBivariate(),
    loadExpSalary(),
    loadCompanies(),
    loadJobs()
  ]);

  // refresh loop (only when page is active)
  setInterval(() => {
    loadJobs();
    loadKPIs();
    loadCities();
  }, 10000);
}

