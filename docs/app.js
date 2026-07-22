// EZ JOBS frontend
// Two modes: local server (API + JSON files) or GitHub Pages (static jobs.json,
// notes/hidden/seen state in this device's localStorage).
const STATIC = location.hostname.endsWith('github.io') || location.protocol === 'file:';
let jobs = [];
let notes = [];
let lastScan = null;

const LS = {
  get(k, fb) { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

const $ = id => document.getElementById(id);
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];
const STEPS = ['Saved', 'Applied', 'Interview', 'Offer']; // stepper order (Rejected shown as bar)

const today = () => new Date().toISOString().slice(0, 10);

function daysAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const days = Math.floor((new Date().setHours(0,0,0,0) - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

function fmtShort(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---------- tabs ----------
function showTab(t) {
  $('tabJobs').style.display = t === 'jobs' ? '' : 'none';
  $('tabNotes').style.display = t === 'notes' ? '' : 'none';
  $('tabJobsBtn').classList.toggle('active', t === 'jobs');
  $('tabNotesBtn').classList.toggle('active', t === 'notes');
  if (t === 'jobs') markSeenSoon();
}

// ---------- jobs ----------
async function loadJobs() {
  try {
    if (STATIC) {
      const [store, meta] = await Promise.all([
        fetch('data/jobs.json?t=' + Date.now()).then(r => r.json()).catch(() => ({ jobs: {} })),
        fetch('data/meta.json?t=' + Date.now()).then(r => r.json()).catch(() => ({})),
      ]);
      const hidden = new Set(LS.get('ezjobs_hidden', []));
      const favs = new Set(LS.get('ezjobs_favs', []));
      const lastVisit = LS.get('ezjobs_lastvisit', null);
      jobs = Object.values(store.jobs || {})
        .filter(j => !hidden.has(j.id))
        .map(j => ({ ...j, fav: favs.has(j.id), isNew: !lastVisit || (j.firstSeen || '') > lastVisit }))
        .sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''));
      lastScan = meta.lastScan || null;
      renderJobs();
      renderMeta({ scanning: false });
    } else {
      const r = await fetch('api/jobs');
      const d = await r.json();
      jobs = d.jobs || [];
      lastScan = d.lastScan;
      renderJobs();
      renderMeta(d);
    }
  } catch (e) { console.error(e); }
}

function renderMeta(d) {
  const el = $('lastScan');
  if (d.scanning) { el.innerHTML = '<span class="spin"></span>scanning...'; return; }
  if (!lastScan) { el.textContent = 'no scan yet'; return; }
  const dt = new Date(lastScan);
  el.textContent = 'last scan\n' + dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  el.style.whiteSpace = 'pre';
}

function renderJobs() {
  const list = $('jobList');
  const q = ($('jobFilter').value || '').toLowerCase();
  const src = $('srcFilter').value;

  // populate source dropdown (keep selection)
  const sources = [...new Set(jobs.map(j => j.source))].sort();
  const sel = $('srcFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All sources</option>'
    + `<option value="__fav" ${cur==='__fav'?'selected':''}>⭐ Favorites</option>`
    + sources.map(s => `<option ${s===cur?'selected':''}>${esc(s)}</option>`).join('');

  const newCount = jobs.filter(j => j.isNew).length;
  $('newBadge').innerHTML = newCount ? `<span class="badge">${newCount} new</span>` : '';

  const shown = jobs.filter(j =>
    (src === '__fav' ? j.fav : (!src || j.source === src)) &&
    (!q || (j.title + ' ' + j.org + ' ' + (j.categories||[]).join(' ')).toLowerCase().includes(q))
  );

  if (!shown.length) {
    list.innerHTML = `<div class="empty">${
      src === '__fav' ? 'No favorites yet.<br>Tap the ☆ star on a job to keep it here ⭐'
      : jobs.length ? 'No jobs match the filter.'
      : 'No jobs yet.<br>Press <b>Scan Now</b> to run the first scan 🌱'}</div>`;
    return;
  }

  const trackedUrls = new Set(notes.map(n => n.url));
  list.innerHTML = shown.map(j => {
    const closing = j.closingDate ? new Date(j.closingDate) : null;
    const closingTxt = closing ? closing.toLocaleDateString(undefined, {day:'numeric',month:'short',year:'numeric'}) : '';
    const expired = closing && closing < new Date();
    const tracked = trackedUrls.has(j.url);
    return `
    <div class="card ${j.isNew ? 'new' : ''}">
      <div class="job-head">
        <div class="job-title">
          <a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
          ${j.isNew ? '<span class="tag-new">NEW</span>' : ''}
        </div>
        <button class="star-btn ${j.fav ? 'on' : ''}" title="Favorite" onclick="toggleFav('${esc(j.id)}')">${j.fav ? '★' : '☆'}</button>
      </div>
      <div class="job-meta">
        <b>${esc(j.org)}</b> · ${esc(j.location)}
        ${closingTxt ? ` · closes <b style="${expired?'color:var(--red)':''}">${closingTxt}</b>` : ''}
        · via ${esc(j.source)}
      </div>
      ${j.snippet ? `<div class="snippet">${esc(j.snippet)}</div>` : ''}
      <div class="cats">${(j.categories||[]).map(c => `<span class="cat">${esc(c)}</span>`).join('')}</div>
      <div class="job-actions">
        ${tracked
          ? '<button class="btn ghost" disabled>✓ Tracked</button>'
          : `<button class="btn" onclick="trackJob('${esc(j.id)}')">+ Track</button>`}
        <button class="btn danger" onclick="hideJob('${esc(j.id)}')">Hide</button>
      </div>
    </div>`;
  }).join('');
}

async function toggleFav(id) {
  const j = jobs.find(x => x.id === id);
  if (!j) return;
  j.fav = !j.fav;
  if (STATIC) {
    const favs = LS.get('ezjobs_favs', []).filter(f => f !== id);
    if (j.fav) favs.push(id);
    LS.set('ezjobs_favs', favs);
  } else {
    await fetch('api/jobs/' + encodeURIComponent(id) + '/fav', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ fav: j.fav }),
    });
  }
  renderJobs();
}

async function scanNow() {
  const b = $('scanBtn');
  b.disabled = true;
  b.innerHTML = '<span class="spin"></span>Scanning...';
  $('lastScan').innerHTML = '<span class="spin"></span>scanning...';
  try {
    await fetch('api/scan', { method: 'POST' });
    await loadJobs();
  } finally {
    b.disabled = false;
    b.textContent = 'Scan Now';
  }
}

async function hideJob(id) {
  if (STATIC) {
    const hidden = LS.get('ezjobs_hidden', []);
    if (!hidden.includes(id)) hidden.push(id);
    LS.set('ezjobs_hidden', hidden);
  } else {
    await fetch('api/jobs/' + encodeURIComponent(id), { method: 'DELETE' });
  }
  jobs = jobs.filter(j => j.id !== id);
  renderJobs();
}

async function trackJob(id) {
  const j = jobs.find(x => x.id === id);
  if (!j) return;
  await createNote({ title: j.title, org: j.org, url: j.url, status: 'Saved' });
  renderJobs();
  renderNotes();
  showTab('notes');
}

// mark NEW as seen a few seconds after she looks at the list
let seenTimer = null;
function markSeenSoon() {
  if (seenTimer || !jobs.some(j => j.isNew)) return;
  seenTimer = setTimeout(async () => {
    if (STATIC) {
      LS.set('ezjobs_lastvisit', new Date().toISOString());
    } else {
      await fetch('api/jobs/seen', { method: 'POST' });
    }
    jobs.forEach(j => { j.isNew = false; });
    seenTimer = null;
    // keep cards highlighted this visit; badge clears next reload
  }, 8000);
}

// ---------- notes ----------
function makeNote(data) {
  const status = data.status || 'Saved';
  return {
    id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: data.title || '', org: data.org || '', url: data.url || '',
    status, feedback: data.feedback || 'No',
    salary: data.salary || '', note: data.note || '',
    statusDates: data.statusDates || { [status]: today() },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

async function createNote(data) {
  if (STATIC) {
    const n = makeNote(data);
    notes.unshift(n);
    LS.set('ezjobs_notes', notes);
    return n;
  }
  const r = await fetch('api/notes', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data),
  });
  const n = await r.json();
  notes.unshift(n);
  return n;
}

async function loadNotes() {
  try {
    if (STATIC) {
      notes = LS.get('ezjobs_notes', []);
    } else {
      const r = await fetch('api/notes');
      notes = (await r.json()).notes || [];
    }
    // backfill: notes created before status dates existed get their creation date
    for (const n of notes) {
      if (!n.statusDates || !Object.keys(n.statusDates).length) {
        n.statusDates = { [n.status]: (n.createdAt || new Date().toISOString()).slice(0, 10) };
        saveNote(n.id, { statusDates: n.statusDates });
      }
    }
    renderNotes();
  } catch (e) { console.error(e); }
}

function stepperHtml(n) {
  const sd = n.statusDates || {};
  if (n.status === 'Rejected') {
    const d = sd.Rejected;
    return `<div class="rejected-bar">✕ Rejected${d ? ' · ' + fmtShort(d) + ' (' + daysAgo(d) + ')' : ''}</div>`;
  }
  const curIdx = STEPS.indexOf(n.status);
  const steps = STEPS.map((s, i) => `
    <div class="step ${i <= curIdx ? 'done' : ''}">
      <div class="dot"></div>
      <div class="sname">${s}</div>
      <div class="sdate">${sd[s] ? fmtShort(sd[s]) : ''}</div>
    </div>`).join('');
  const curDate = sd[n.status];
  const ago = curDate ? `<div class="ago-bar">📌 ${esc(n.status)} · ${daysAgo(curDate)}</div>` : '';
  return `<div class="stepper">${steps}</div>${ago}`;
}

function changeStatus(id, status) {
  const n = notes.find(x => x.id === id);
  if (!n) return;
  const sd = { ...(n.statusDates || {}) };
  if (!sd[status]) sd[status] = today(); // auto-stamp first time this status is reached
  saveNote(id, { status, statusDates: sd });
  renderNotes();
}

function changeStatusDate(id, dateVal) {
  const n = notes.find(x => x.id === id);
  if (!n || !dateVal) return;
  const sd = { ...(n.statusDates || {}), [n.status]: dateVal };
  saveNote(id, { statusDates: sd });
  renderNotes();
}

function renderNotes() {
  const list = $('noteList');
  if (!notes.length) {
    list.innerHTML = '<div class="empty">Nothing tracked yet.<br>Add a note here or press <b>+ Track</b> on a job in the scanner tab 💙</div>';
    return;
  }
  list.innerHTML = notes.map(n => {
    const sd = n.statusDates || {};
    return `
    <div class="card" id="note-${n.id}">
      <div class="note-head">
        <input class="title-in" value="${esc(n.title)}" placeholder="Job title"
               onchange="saveNote('${n.id}', {title: this.value})">
        <span class="pill st-${esc(n.status)}">${esc(n.status)}</span>
      </div>
      <div class="job-meta" style="margin-top:2px">
        <input style="background:transparent;border:none;color:var(--dim);font-size:12px;width:100%;outline:none"
               value="${esc(n.org)}" placeholder="Organization"
               onchange="saveNote('${n.id}', {org: this.value})">
      </div>
      ${n.url ? `<a class="open-link" href="${esc(n.url)}" target="_blank" rel="noopener">🔗 Open job posting <span style="font-size:14px">↗</span></a>` : ''}
      ${stepperHtml(n)}
      <div class="note-grid">
        <div>
          <label>Status</label>
          <select onchange="changeStatus('${n.id}', this.value)">
            ${STATUSES.map(s => `<option ${s===n.status?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>${esc(n.status)} date</label>
          <input type="date" value="${esc(sd[n.status] || '')}"
                 onchange="changeStatusDate('${n.id}', this.value)">
        </div>
        <div>
          <label>Feedback reply</label>
          <select onchange="saveNote('${n.id}', {feedback: this.value})">
            <option ${n.feedback==='No'?'selected':''}>No</option>
            <option ${n.feedback==='Yes'?'selected':''}>Yes</option>
          </select>
        </div>
        <div>
          <label>Salary range</label>
          <input value="${esc(n.salary)}" placeholder="e.g. $800-1200 or 8-12M LAK"
                 onchange="saveNote('${n.id}', {salary: this.value})">
        </div>
        <div style="grid-column:1 / -1">
          <label>Link</label>
          <input value="${esc(n.url)}" placeholder="https://..."
                 onchange="saveNote('${n.id}', {url: this.value}); renderNotes()">
        </div>
      </div>
      <textarea placeholder="Notes... (contact person, interview date, documents sent)"
                onchange="saveNote('${n.id}', {note: this.value})">${esc(n.note)}</textarea>
      <div class="job-actions" style="justify-content:space-between">
        <span class="saved-hint" id="saved-${n.id}">saved ✓</span>
        <button class="btn danger" onclick="deleteNote('${n.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function addNote() {
  await createNote({ title: '', status: 'Saved' });
  renderNotes();
  const first = document.querySelector('.title-in');
  if (first) first.focus();
}

async function saveNote(id, patch) {
  const n = notes.find(x => x.id === id);
  if (!n) return;
  Object.assign(n, patch, { updatedAt: new Date().toISOString() });
  if (STATIC) {
    LS.set('ezjobs_notes', notes);
  } else {
    await fetch('api/notes/' + encodeURIComponent(id), {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(patch),
    });
  }
  const hint = $('saved-' + id);
  if (hint) { hint.classList.add('show'); setTimeout(() => hint.classList.remove('show'), 1500); }
}

async function deleteNote(id) {
  if (!confirm('Delete this entry?')) return;
  if (STATIC) {
    notes = notes.filter(n => n.id !== id);
    LS.set('ezjobs_notes', notes);
  } else {
    await fetch('api/notes/' + encodeURIComponent(id), { method: 'DELETE' });
    notes = notes.filter(n => n.id !== id);
  }
  renderNotes();
}

// ---------- init ----------
if (STATIC) {
  // hosted version: scans run in the cloud at 9am, no manual scan button
  $('scanBtn').style.display = 'none';
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
loadNotes().then(loadJobs);
setInterval(loadJobs, 5 * 60 * 1000); // refresh every 5 min in case daily scan ran
