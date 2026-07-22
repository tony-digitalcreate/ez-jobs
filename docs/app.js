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

// favorites: authoritative in-memory set of job ids, synced across devices via cloud
let favSet = new Set(LS.get('ezjobs_favs', []));

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
      const lastVisit = LS.get('ezjobs_lastvisit', null);
      jobs = Object.values(store.jobs || {})
        .filter(j => !hidden.has(j.id))
        .map(j => ({ ...j, fav: favSet.has(j.id), isNew: !lastVisit || (j.firstSeen || '') > lastVisit }))
        .sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''));
      lastScan = meta.lastScan || null;
      renderJobs();
      renderMeta({ scanning: false });
    } else {
      const r = await fetch('api/jobs');
      const d = await r.json();
      jobs = d.jobs || [];
      // merge server fav flags with the synced set, then mark uniformly
      jobs.forEach(j => { if (j.fav) favSet.add(j.id); });
      jobs.forEach(j => { j.fav = favSet.has(j.id); });
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
  if (j.fav) favSet.add(id); else favSet.delete(id);
  persistFavsLocal(id, j.fav);
  cloudPushState();
  renderJobs();
}

function persistFavsLocal(changedId, fav) {
  LS.set('ezjobs_favs', [...favSet]);
  if (!STATIC && changedId !== undefined) {
    fetch('api/jobs/' + encodeURIComponent(changedId) + '/fav', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ fav }),
    }).catch(() => {});
  }
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
  let n;
  if (STATIC) {
    n = makeNote(data);
    notes.unshift(n);
    LS.set('ezjobs_notes', notes);
  } else {
    const r = await fetch('api/notes', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data),
    });
    n = await r.json();
    notes.unshift(n);
  }
  cloudPushNote(n);
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
  cloudPushNote(n);
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
  cloudDeleteNote(id);
  renderNotes();
}

// ---------- cloud sync (Firebase Firestore, same project as EZ LOTTO) ----------
// Shares her tracker + favorites between phone and PC. Fully optional:
// if Firestore is unreachable the app keeps working local-only.
// Data model: ezjobs_notes/{noteId} = note; ezjobs_state/main = {favs, updatedAt}.
const firebaseConfig = {
  apiKey: "AIzaSyBryg9p-xcnNR4Ui-6DWPuYU7xpjZodHrA",
  authDomain: "ez-lotto-testing.firebaseapp.com",
  projectId: "ez-lotto-testing",
  storageBucket: "ez-lotto-testing.firebasestorage.app",
  messagingSenderId: "644914912791",
  appId: "1:644914912791:web:ab567d8e5ee529fa7d0652"
};
const NOTES_COL = 'ezjobs_notes';
let cloud = null, cloudBusy = false, cloudUnsubs = [], lastStatePush = 0;

function cloudPill(cls, txt) { const p = $('cloudStat'); if (p) { p.className = 'cloudstat ' + cls; p.textContent = txt; } }
function markSynced() { cloudPill('ok', '☁ synced'); }

async function persistNotesLocal() {
  if (STATIC) {
    LS.set('ezjobs_notes', notes);
  } else {
    await fetch('api/notes/bulk', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ notes }),
    }).catch(() => {});
  }
}

function noteTime(n) { return Date.parse(n && n.updatedAt || 0) || 0; }

function cloudPushNote(n) {
  if (!cloud || !n) return;
  cloud.setDoc(cloud.doc(cloud.db, NOTES_COL, n.id), JSON.parse(JSON.stringify(n))).catch(() => {});
}
function cloudDeleteNote(id) {
  if (!cloud) return;
  cloud.deleteDoc(cloud.doc(cloud.db, NOTES_COL, id)).catch(() => {});
}
function cloudPushState() {
  if (!cloud) return;
  lastStatePush = Date.now();
  cloud.setDoc(cloud.doc(cloud.db, 'ezjobs_state', 'main'),
    { favs: [...favSet], updatedAt: lastStatePush }, { merge: true }).catch(() => {});
}

function applyRemoteFavs(favArr) {
  favSet = new Set(favArr || []);
  LS.set('ezjobs_favs', [...favSet]);
  let changed = false;
  jobs.forEach(j => {
    const f = favSet.has(j.id);
    if (j.fav !== f) { j.fav = f; changed = true; if (!STATIC) persistFavsLocal(j.id, f); }
  });
  if (changed) renderJobs();
}

async function initCloud() {
  if (cloud || cloudBusy) return;
  cloudBusy = true;
  try {
    cloudPill('sync', '☁ connecting…');
    const [appM, fsM, authM] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    ]);
    const fbApp = appM.getApps().length ? appM.getApp() : appM.initializeApp(firebaseConfig);
    try { await authM.signInAnonymously(authM.getAuth(fbApp)); } catch (e) {}
    const db = fsM.getFirestore(fbApp);
    cloud = { db, doc: fsM.doc, collection: fsM.collection, getDocs: fsM.getDocs, getDoc: fsM.getDoc,
              setDoc: fsM.setDoc, deleteDoc: fsM.deleteDoc, onSnapshot: fsM.onSnapshot };
    await Promise.race([
      reconcileCloud(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Firestore not reachable')), 20000)),
    ]);
    listenCloud();
    markSynced();
  } catch (e) {
    cloud = null;
    cloudPill('off', '☁ local only');
    console.warn('Cloud sync unavailable:', e.message || e);
  } finally { cloudBusy = false; }
}

// first contact: two-way merge - newer updatedAt wins per note, favorites union
async function reconcileCloud() {
  const snap = await cloud.getDocs(cloud.collection(cloud.db, NOTES_COL));
  const remote = new Map();
  snap.forEach(d => remote.set(d.id, d.data()));
  let localChanged = false;
  // pull remote notes that are new or newer
  for (const [id, rn] of remote) {
    const ln = notes.find(n => n.id === id);
    if (!ln) { notes.push(rn); localChanged = true; }
    else if (noteTime(rn) > noteTime(ln)) { Object.assign(ln, rn); localChanged = true; }
  }
  // push local notes that are missing or newer remotely
  for (const n of notes) {
    const rn = remote.get(n.id);
    if (!rn || noteTime(n) > noteTime(rn)) cloudPushNote(n);
  }
  if (localChanged) {
    notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    await persistNotesLocal();
    renderNotes(); renderJobs();
  }
  // favorites: union both sides on first contact
  const sref = cloud.doc(cloud.db, 'ezjobs_state', 'main');
  const ssnap = await cloud.getDoc(sref);
  const remoteFavs = ssnap.exists() ? (ssnap.data().favs || []) : [];
  const before = favSet.size;
  remoteFavs.forEach(id => favSet.add(id));
  if (favSet.size !== before || !ssnap.exists()) cloudPushState();
  applyRemoteFavs([...favSet]);
}

function listenCloud() {
  cloudUnsubs.forEach(u => u()); cloudUnsubs = [];
  // live notes: adopt newer versions, drop deletions
  cloudUnsubs.push(cloud.onSnapshot(cloud.collection(cloud.db, NOTES_COL), snap => {
    let changed = false;
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        if (notes.some(n => n.id === id)) { notes = notes.filter(n => n.id !== id); changed = true; }
      } else {
        const rn = ch.doc.data();
        const ln = notes.find(n => n.id === id);
        if (!ln) { notes.unshift(rn); changed = true; }
        else if (noteTime(rn) > noteTime(ln)) { Object.assign(ln, rn); changed = true; }
      }
    });
    if (changed) { persistNotesLocal(); renderNotes(); renderJobs(); markSynced(); }
  }, () => {}));
  // live favorites (skip echoes of our own writes)
  cloudUnsubs.push(cloud.onSnapshot(cloud.doc(cloud.db, 'ezjobs_state', 'main'), d => {
    if (!d.exists()) return;
    const data = d.data();
    if (data.updatedAt && data.updatedAt !== lastStatePush) { applyRemoteFavs(data.favs); markSynced(); }
  }, () => {}));
}

// ---------- backup / restore ----------
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'EZ JOBS', exportedAt: new Date().toISOString(), notes, favs: [...favSet] }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ezjobs-backup-' + today() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

document.getElementById('importFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.app !== 'EZ JOBS' || !Array.isArray(backup.notes)) throw new Error('bad file');
    if (!confirm('Replace all applications/notes with this backup (' + backup.notes.length + ' entries)?')) return;
    notes = backup.notes;
    (backup.favs || []).forEach(id => favSet.add(id));
    LS.set('ezjobs_favs', [...favSet]);
    await persistNotesLocal();
    notes.forEach(cloudPushNote);
    cloudPushState();
    renderNotes(); renderJobs();
    alert('Backup restored ✓');
  } catch (err) {
    alert('Could not restore this file. Please choose a valid EZ JOBS backup.');
  }
};

// ---------- init ----------
if (STATIC) {
  // hosted version: scans run in the cloud at 9am, no manual scan button
  $('scanBtn').style.display = 'none';
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
loadNotes().then(loadJobs).then(initCloud);
setInterval(loadJobs, 5 * 60 * 1000); // refresh every 5 min in case daily scan ran
