// EZ JOBS scanner - pulls Environmental / MEAL / M&E / Social-Environmental jobs
// for Vientiane Capital from 108.jobs (client API) + web search (DuckDuckGo/Google index).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const VIENTIANE_CAPITAL_ID = '5eb8cb58f2913809f730ce9c'; // 108.jobs workingLocation _id

// ---- keyword profile (what she is looking for) ----
const KEYWORD_GROUPS = {
  'Environment': ['environment', 'environmental', 'climate', 'biodiversity', 'conservation', 'natural resource', 'esia', 'esg'],
  'MEAL / M&E': ['meal', 'm&e', 'monitoring and evaluation', 'monitoring & evaluation', 'monitoring, evaluation', 'evaluation officer', 'mel officer', 'accountability and learning'],
  'Social / Safeguards': ['safeguard', 'social development', 'social officer', 'social performance', 'community development', 'gender', 'livelihood', 'social impact'],
  'Consultant / NGO': ['consultant', 'programme officer', 'program officer', 'project officer', 'ngo', 'development officer', 'sustainability'],
};

// searches run against the 108.jobs title index (their API matches title only)
const JOB108_TITLE_QUERIES = [
  'environment', 'environmental', 'MEAL', 'monitoring', 'evaluation',
  'safeguard', 'social', 'consultant', 'climate', 'sustainability', 'community',
];

// web search queries (DuckDuckGo HTML endpoint - carries Google-indexed NGO/UN/LinkedIn pages)
const WEB_QUERIES = [
  '"MEAL" OR "M&E officer" job Vientiane Laos',
  '"monitoring and evaluation" vacancy Vientiane Laos',
  'environmental consultant job Vientiane Laos',
  'environmental specialist vacancy Vientiane Lao PDR',
  '"social safeguards" OR "environmental safeguards" specialist Vientiane',
  'site:reliefweb.int/job "Lao People\'s Democratic Republic"',
  'site:la.linkedin.com/jobs environment OR MEAL OR evaluation Vientiane',
  'NGO job Vientiane environment "monitoring"',
];

// hosts that are never job postings
const JUNK_HOSTS = ['duckduckgo.com', 'wikipedia.org', 'facebook.com', 'youtube.com', 'google.com'];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// which of her interest categories does this text hit?
function matchCategories(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  const cats = [];
  for (const [cat, words] of Object.entries(KEYWORD_GROUPS)) {
    if (words.some(w => t.includes(w.toLowerCase()))) cats.push(cat);
  }
  return cats;
}

async function fetchWithTimeout(url, opts = {}, ms = 25000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } finally { clearTimeout(timer); }
}

// ---------- source 1: 108.jobs ----------
async function scan108() {
  const found = new Map();
  for (const q of JOB108_TITLE_QUERIES) {
    const body = {
      jobFunctionIds: [], industryIds: [],
      workingLocationIds: [VIENTIANE_CAPITAL_ID],
      jobExperienceId: [], jobLanguageId: [], jobEducationLevelId: [], jobLevelId: [],
      title: q, disabledPeople: '', token: '', page: 1, perPage: 50,
    };
    try {
      const res = await fetchWithTimeout('https://db.108.jobs/client-api/get-job-search-web?lang=EN', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const j of data.allJob || []) {
        if (!j || j.type === 'ads' || !j.title || !j._id) continue;
        const cats = matchCategories(j.title + ' ' + (j.jobFunctionId || []).map(f => f.name).join(' '));
        if (!cats.length) continue;
        found.set(j._id, {
          id: '108-' + j._id,
          source: '108.jobs',
          title: j.title.trim(),
          org: j.companyName || '',
          location: j.workingLocations || 'Vientiane Capital',
          url: 'https://108.jobs/job_detail/' + j._id,
          closingDate: j.closingDate || null,
          categories: cats,
        });
      }
    } catch (e) {
      console.error('[scan] 108.jobs query "' + q + '" failed:', e.message);
    }
    await new Promise(r => setTimeout(r, 600)); // be polite
  }
  return [...found.values()];
}

// ---------- source 2: web search (DDG html = Google-indexed pages) ----------
function decodeDdgUrl(href) {
  // //duckduckgo.com/l/?uddg=<encoded>&rut=...
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return null; } }
  return href.startsWith('http') ? href : null;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function scanWeb() {
  const found = new Map();
  for (const q of WEB_QUERIES) {
    try {
      const res = await fetchWithTimeout('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q));
      if (!res.ok) continue;
      const html = await res.text();
      // each result: <a class="result__a" href="...">title</a> ... <a class="result__snippet"...>snippet</a>
      const blocks = html.split('result__body');
      for (const block of blocks.slice(1, 12)) {
        const linkM = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!linkM) continue;
        const url = decodeDdgUrl(linkM[1]);
        if (!url) continue;
        let host; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { continue; }
        if (JUNK_HOSTS.some(h => host.includes(h))) continue;
        const title = stripTags(linkM[2]);
        const snipM = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
        const snippet = snipM ? stripTags(snipM[1]) : '';
        const all = title + ' ' + snippet;
        const cats = matchCategories(all);
        if (!cats.length) continue;
        // must look Laos/Vientiane-related
        if (!/vientiane|laos|lao pdr|lao people/i.test(all + ' ' + url)) continue;
        const key = url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
        if (found.has(key)) continue;
        found.set(key, {
          id: 'web-' + Buffer.from(key).toString('base64url').slice(0, 24),
          source: host,
          title: title.slice(0, 160),
          org: host,
          location: /vientiane/i.test(all) ? 'Vientiane' : 'Laos',
          url,
          closingDate: null,
          snippet: snippet.slice(0, 300),
          categories: cats,
        });
      }
    } catch (e) {
      console.error('[scan] web query failed:', q, e.message);
    }
    await new Promise(r => setTimeout(r, 1200)); // be polite to DDG
  }
  return [...found.values()];
}

// ---------- orchestrator ----------
async function runScan(trigger = 'manual') {
  console.log('[scan] starting (' + trigger + ') at', new Date().toLocaleString());
  const store = readJson(JOBS_FILE, { jobs: {} });
  const now = new Date().toISOString();

  const results = [];
  const [r108, rweb] = await Promise.allSettled([scan108(), scanWeb()]);
  if (r108.status === 'fulfilled') results.push(...r108.value); else console.error('[scan] 108.jobs failed entirely:', r108.reason);
  if (rweb.status === 'fulfilled') results.push(...rweb.value); else console.error('[scan] web search failed entirely:', rweb.reason);

  let added = 0;
  for (const job of results) {
    if (store.jobs[job.id]) {
      Object.assign(store.jobs[job.id], job, { lastSeen: now });
    } else {
      store.jobs[job.id] = { ...job, firstSeen: now, lastSeen: now, isNew: true };
      added++;
    }
  }

  // expired 108 jobs (past closing date) get dropped after 60 days unseen
  const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
  for (const [id, j] of Object.entries(store.jobs)) {
    if (new Date(j.lastSeen).getTime() < cutoff) delete store.jobs[id];
  }

  writeJson(JOBS_FILE, store);
  const meta = readJson(META_FILE, {});
  meta.lastScan = now;
  meta.lastScanTrigger = trigger;
  meta.lastScanFound = results.length;
  meta.lastScanNew = added;
  writeJson(META_FILE, meta);
  console.log('[scan] done: ' + results.length + ' matches, ' + added + ' new');
  return { found: results.length, added };
}

module.exports = { runScan, JOBS_FILE, META_FILE, readJson, writeJson, DATA_DIR };

// CLI / GitHub Actions entry: `node scanner.js`
if (require.main === module) {
  runScan(process.env.GITHUB_ACTIONS ? 'github-actions' : 'cli')
    .then(r => console.log('[scan] result:', JSON.stringify(r)))
    .catch(e => { console.error(e); process.exit(1); });
}
