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
  'Agriculture': ['agriculture', 'agricultural', 'agri-', 'agroforestry', 'agronomy', 'farming', 'forestry', 'fisheries', 'livestock', 'food security', 'rural development', 'irrigation', 'crop', 'value chain'],
};

// searches run against the 108.jobs title index (their API matches title only)
const JOB108_TITLE_QUERIES = [
  'environment', 'environmental', 'MEAL', 'monitoring', 'evaluation',
  'safeguard', 'social', 'consultant', 'climate', 'sustainability', 'community',
  'agri', 'forestry', 'fisheries', 'livestock', 'farm',
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
  'agriculture OR forestry officer vacancy Vientiane Laos',
  '"food security" OR "rural development" job Vientiane Lao PDR',
];

// hosts that are never job postings, plus bot-blocked aggregators that
// re-list expired jobs and can't be date-verified (the real orgs' pages are covered anyway)
const JUNK_HOSTS = ['duckduckgo.com', 'wikipedia.org', 'facebook.com', 'youtube.com', 'google.com',
  'tealhq.com', 'visaboards.com', 'jobrapido.com', 'jooble.org', 'glassdoor.com'];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// freshness: reject expired or clearly old postings (he saw a 2025 job resurface)
function isFresh(job) {
  // jobs with a closing date: expired more than 7 days ago = stale
  if (job.closingDate) {
    return new Date(job.closingDate).getTime() > Date.now() - 7 * 24 * 3600 * 1000;
  }
  // web results have no closing date - look for "Jul 2025"-style dates in title/snippet;
  // if every dated mention is from a previous year, the posting is old news
  const text = job.title + ' ' + (job.snippet || '');
  const monthYears = [...text.matchAll(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(20\d{2})\b/gi)]
    .map(m => +m[1]);
  if (monthYears.length && Math.max(...monthYears) < new Date().getFullYear()) return false;
  return true;
}

// ---- deep verification: fetch a web result's page and judge from its real dates ----
const MONTH_RE = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
function extractDates(text) {
  const out = [];
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) out.push(new Date(+m[1], +m[2] - 1, +m[3]));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_RE})\\.?,?\\s+(20\\d{2})\\b`, 'gi')))
    out.push(new Date(`${m[2].slice(0, 3)} ${m[1]} ${m[3]}`));
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, 'gi')))
    out.push(new Date(`${m[1].slice(0, 3)} ${m[2]} ${m[3]}`));
  return out.filter(d => !isNaN(d) && d.getFullYear() > 2015 && d.getFullYear() < 2100);
}

// fetches the job page; returns {fresh, closingDate?}. Lenient: unreachable/odd pages pass.
async function verifyWebJob(job) {
  try {
    const res = await fetchWithTimeout(job.url, {}, 15000);
    if (res.status === 404 || res.status === 410) return { fresh: false }; // posting removed
    if (!res.ok) return { fresh: true }; // blocked/error - benefit of the doubt
    const html = (await res.text()).replace(/<[^>]+>/g, ' ');
    const now = Date.now();
    const dl = [], posted = [];
    // dates sitting next to deadline-ish words (incl. JSON-LD validThrough/datePosted)
    for (const m of html.matchAll(/(deadline|closing date|validThrough|apply before|apply by|expires?|close[sd]? on)/gi))
      dl.push(...extractDates(html.slice(Math.max(0, m.index - 60), m.index + 160)));
    for (const m of html.matchAll(/(datePosted|posted|published|date issued|opening date)/gi))
      posted.push(...extractDates(html.slice(Math.max(0, m.index - 60), m.index + 160)));
    if (dl.length) {
      const latest = Math.max(...dl.map(d => d.getTime()));
      if (latest < now - 7 * 24 * 3600 * 1000) return { fresh: false };
      return { fresh: true, closingDate: new Date(latest).toISOString() };
    }
    if (posted.length) {
      const latest = Math.max(...posted.map(d => d.getTime()));
      return { fresh: latest > now - 90 * 24 * 3600 * 1000 };
    }
    const all = extractDates(html);
    if (all.length && Math.max(...all.map(d => d.getTime())) < now - 120 * 24 * 3600 * 1000)
      return { fresh: false };
    return { fresh: true };
  } catch { return { fresh: true }; }
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
        // skip already-closed postings
        if (j.closingDate && new Date(j.closingDate).getTime() < Date.now()) continue;
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
      // df=m restricts results to pages indexed in the past month - keeps postings current
      const res = await fetchWithTimeout('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&df=m');
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
        if (!isFresh({ title, snippet })) continue; // old posting from a previous year
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

  // stale blocklist: web URLs already verified as old postings - never re-add
  store.stale = store.stale || {};
  const nowMs = Date.now();
  for (const [id, t] of Object.entries(store.stale)) {
    if (nowMs - new Date(t).getTime() > 60 * 24 * 3600 * 1000) delete store.stale[id];
  }

  let added = 0;
  for (const job of results) {
    if (store.stale[job.id]) continue;
    if (store.jobs[job.id]) {
      Object.assign(store.jobs[job.id], job, { lastSeen: now });
    } else {
      // web results carry no closing date - fetch the page and check its real dates
      if (job.id.startsWith('web-')) {
        const v = await verifyWebJob(job);
        if (!v.fresh) {
          console.log('[scan] stale posting rejected:', job.title, '(' + job.url + ')');
          store.stale[job.id] = now;
          continue;
        }
        if (v.closingDate) job.closingDate = v.closingDate;
        job.verifiedAt = now;
        await new Promise(r => setTimeout(r, 400));
      }
      store.jobs[job.id] = { ...job, firstSeen: now, lastSeen: now, isNew: true };
      added++;
    }
  }

  // re-verify stored web jobs weekly; drop the ones that turned stale
  for (const [id, j] of Object.entries(store.jobs)) {
    if (!id.startsWith('web-') || j.fav) continue;
    if (j.verifiedAt && nowMs - new Date(j.verifiedAt).getTime() < 7 * 24 * 3600 * 1000) continue;
    const v = await verifyWebJob(j);
    if (!v.fresh) {
      console.log('[scan] stored job went stale, removing:', j.title);
      store.stale[id] = now;
      delete store.jobs[id];
    } else {
      if (v.closingDate) j.closingDate = v.closingDate;
      j.verifiedAt = now;
    }
    await new Promise(r => setTimeout(r, 400));
  }

  // prune: 60 days unseen, expired, dated last-year, or junk-host - but never favorites
  const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
  for (const [id, j] of Object.entries(store.jobs)) {
    if (j.fav) continue;
    const junk = JUNK_HOSTS.some(h => (j.source || '').includes(h) || (j.url || '').includes(h));
    if (junk || new Date(j.lastSeen).getTime() < cutoff || !isFresh(j)) delete store.jobs[id];
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
