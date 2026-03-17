// ─── dashboard.js ─────────────────────────────────────────────
import { getDashKPIs, getTopSkills, getJobsByCity, getSalaryDist } from './api.js';
import { renderBar } from './router.js';

let salaryChartInst = null;

export async function loadDashboard() {
  try {
    // KPIs
    const k = await getDashKPIs();
    document.getElementById('dash-kpis').innerHTML = `
      <div class="kpi"><div class="kpi-val">${Number(k.total_jobs).toLocaleString()}</div><div class="kpi-label">TOTAL JOBS</div></div>
      <div class="kpi"><div class="kpi-val">${k.avg_salary ? '₹' + k.avg_salary + 'L' : '—'}</div><div class="kpi-label">AVG SALARY</div></div>
      <div class="kpi"><div class="kpi-val">${k.total_companies}</div><div class="kpi-label">COMPANIES</div></div>
      <div class="kpi"><div class="kpi-val">${k.total_cities}</div><div class="kpi-label">CITIES</div></div>`;

    // Skills bar
    const skills = await getTopSkills(10);
    renderBar('dash-skills', skills, 'skill_name', 'frequency');

    // Cities bar
    const cities = await getJobsByCity();
    renderBar('dash-cities', cities, 'city', 'job_count');

    // Salary distribution chart
    const sal = await getSalaryDist();
    if (salaryChartInst) salaryChartInst.destroy();
    salaryChartInst = new Chart(document.getElementById('salaryChart'), {
      type: 'bar',
      data: {
        labels: sal.map(d => d.salary_range),
        datasets: [{
          label: 'Jobs',
          data: sal.map(d => d.count),
          backgroundColor: 'rgba(0,229,160,.5)',
          borderColor: '#00e5a0',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#5a6075', font: { family: 'DM Mono', size: 11 } }, grid: { color: '#1e2230' } },
          y: { ticks: { color: '#5a6075', font: { family: 'DM Mono', size: 11 } }, grid: { color: '#1e2230' } }
        }
      }
    });

  } catch (e) { console.warn('Dashboard:', e); }
}