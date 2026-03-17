// ─── nlp.js ───────────────────────────────────────────────────
import { getKeywordFreq } from './api.js';
import { renderBar } from './router.js';

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