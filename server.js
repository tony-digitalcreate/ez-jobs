// EZ JOBS - daily 9am job scanner + application tracker for Vientiane Capital
// Environmental / MEAL / M&E / Social-Environmental roles. Runs locally on port 3796.
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const os = require('os');
const { runScan, JOBS_FILE, META_FILE, readJson, writeJson, DATA_DIR } = require('./scanner');

const PORT = 3796;
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'docs')));

let scanning = false;
async function safeScan(trigger) {
  if (scanning) return { busy: true };
  scanning = true;
  try { return await runScan(trigger); }
  finally { scanning = false; }
}

// ---- API: jobs ----
app.get('/api/jobs', (req, res) => {
  const store = readJson(JOBS_FILE, { jobs: {} });
  const meta = readJson(META_FILE, {});
  const jobs = Object.values(store.jobs).sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''));
  res.json({ jobs, lastScan: meta.lastScan || null, lastScanNew: meta.lastScanNew || 0, scanning });
});

app.post('/api/scan', async (req, res) => {
  const result = await safeScan('manual');
  res.json(result);
});

// mark all current NEW jobs as seen (called when she views the list)
app.post('/api/jobs/seen', (req, res) => {
  const store = readJson(JOBS_FILE, { jobs: {} });
  for (const j of Object.values(store.jobs)) j.isNew = false;
  writeJson(JOBS_FILE, store);
  res.json({ ok: true });
});

app.put('/api/jobs/:id/fav', (req, res) => {
  const store = readJson(JOBS_FILE, { jobs: {} });
  const job = store.jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'not found' });
  job.fav = !!req.body.fav;
  writeJson(JOBS_FILE, store);
  res.json({ ok: true, fav: job.fav });
});

app.delete('/api/jobs/:id', (req, res) => {
  const store = readJson(JOBS_FILE, { jobs: {} });
  delete store.jobs[req.params.id];
  writeJson(JOBS_FILE, store);
  res.json({ ok: true });
});

// ---- API: notes / tracker ----
app.get('/api/notes', (req, res) => {
  res.json(readJson(NOTES_FILE, { notes: [] }));
});

app.post('/api/notes', (req, res) => {
  const store = readJson(NOTES_FILE, { notes: [] });
  const note = {
    id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: String(req.body.title || '').slice(0, 200),
    org: String(req.body.org || '').slice(0, 200),
    url: String(req.body.url || '').slice(0, 500),
    status: String(req.body.status || 'Saved'),
    feedback: String(req.body.feedback || 'No'),
    salary: String(req.body.salary || '').slice(0, 100),
    note: String(req.body.note || '').slice(0, 2000),
    statusDates: (req.body.statusDates && typeof req.body.statusDates === 'object')
      ? req.body.statusDates
      : { [String(req.body.status || 'Saved')]: new Date().toISOString().slice(0, 10) },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.notes.unshift(note);
  writeJson(NOTES_FILE, store);
  res.json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const store = readJson(NOTES_FILE, { notes: [] });
  const note = store.notes.find(n => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: 'not found' });
  for (const k of ['title', 'org', 'url', 'status', 'feedback', 'salary', 'note']) {
    if (req.body[k] !== undefined) note[k] = String(req.body[k]);
  }
  if (req.body.statusDates && typeof req.body.statusDates === 'object') {
    note.statusDates = req.body.statusDates;
  }
  note.updatedAt = new Date().toISOString();
  writeJson(NOTES_FILE, store);
  res.json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  const store = readJson(NOTES_FILE, { notes: [] });
  store.notes = store.notes.filter(n => n.id !== req.params.id);
  writeJson(NOTES_FILE, store);
  res.json({ ok: true });
});

// ---- daily scan at 9:00 AM ----
cron.schedule('0 9 * * *', () => safeScan('daily-9am'));

// catch-up: if the PC was off at 9am, scan on startup when today's 9am scan was missed
function catchUp() {
  const meta = readJson(META_FILE, {});
  const now = new Date();
  const nineAmToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  const last = meta.lastScan ? new Date(meta.lastScan) : null;
  if (now >= nineAmToday && (!last || last < nineAmToday)) {
    console.log('[scan] catch-up: missed today\'s 9am scan, running now');
    safeScan('catch-up');
  } else if (!last) {
    safeScan('first-run');
  }
}

app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let lan = null;
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal && !lan) lan = n.address;
    }
  }
  console.log('EZ JOBS running:');
  console.log('  PC:    http://localhost:' + PORT);
  if (lan) console.log('  Phone: http://' + lan + ':' + PORT + '  (same Wi-Fi)');
  console.log('Daily scan: 9:00 AM (+ catch-up on startup)');
  catchUp();
});
