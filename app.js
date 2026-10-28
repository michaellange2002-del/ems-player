const CFG = window.APP_CONFIG || {};
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const $ = id => document.getElementById(id);
const v = $('v');

let token = null;
let tokenClient = null;
let current = null;
let mode = 'stream';
let t0 = 0;
let lastSave = 0;
let pendingResume = 0;
let resumeTarget = 0;
let seekRequested = false;
let wake = null;
let blobUrl = null;

const fmt = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, val) => { try { localStorage.setItem(k, val); } catch { /* Speicher gesperrt */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* Speicher gesperrt */ } },
};

/* ---------- Prüfliste ---------- */
const CHECKS = [
  ['sw', 'Service Worker aktiv'],
  ['login', 'Google-Anmeldung'],
  ['list', 'Videos in Drive gefunden'],
  ['start', 'Video startet'],
  ['seek', 'Vorspulen klappt'],
  ['wake', 'Bildschirm bleibt an'],
  ['resume', 'Fortsetzen (Position gemerkt)'],
  ['ended', 'Ende wird erkannt'],
];
const state = Object.fromEntries(CHECKS.map(([k]) => [k, { s: 'wait', note: '' }]));
const ICON = { ok: '✓', bad: '✗', wait: '·' };

function set(k, s, note = '') {
  state[k] = { s, note };
  $('checks').innerHTML = CHECKS.map(([key, label]) => {
    const c = state[key];
    return `<li data-s="${c.s}"><i>${ICON[c.s]}</i><span>${label}${c.note ? `<small>${esc(c.note)}</small>` : ''}</span></li>`;
  }).join('');
}

/* ---------- Service Worker ---------- */
async function initSW() {
  if (!('serviceWorker' in navigator)) return set('sw', 'bad', 'Dieser Browser kann keine Service Worker');
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'need-token' && e.ports[0]) e.ports[0].postMessage(token);
  });
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await Promise.race([
        new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })),
        new Promise(r => setTimeout(r, 4000)),
      ]);
    }
    if (navigator.serviceWorker.controller) set('sw', 'ok');
    else set('sw', 'bad', 'Noch nicht aktiv. Seite einmal neu laden.');
  } catch (e) {
    set('sw', 'bad', e.message);
  }
}
const sendToken = () => navigator.serviceWorker?.controller?.postMessage({ type: 'token', token });

/* ---------- Google-Anmeldung ---------- */
function initAuth() {
  if (!CFG.clientId || CFG.clientId.startsWith('HIER')) {
    $('cfgMsg').textContent = 'Die Client-ID fehlt noch in config.js.';
    $('cfgMsg').hidden = false;
    $('login').disabled = true;
    return;
  }
  const wait = setInterval(() => {
    if (!window.google?.accounts?.oauth2) return;
    clearInterval(wait);
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
      scope: SCOPE,
      callback: r => {
        if (r.error) return set('login', 'bad', r.error_description || r.error);
        token = r.access_token;
        sendToken();
        set('login', 'ok', `gültig für ca. ${Math.round(r.expires_in / 60)} Minuten`);
        $('who').textContent = 'Angemeldet';
        $('login').textContent = 'Neu anmelden';
        $('search').disabled = false;
        findVideos();
      },
      error_callback: e => set('login', 'bad', e?.type === 'popup_closed' ? 'Anmeldefenster geschlossen' : (e?.message || 'Abgebrochen')),
    });
  }, 100);
}
$('login').onclick = () => tokenClient?.requestAccessToken();

/* ---------- Drive ---------- */
async function api(path, params) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

async function findVideos() {
  const name = $('folder').value.trim();
  $('list').innerHTML = '<p class="sub">Suche …</p>';
  try {
    let q = "mimeType contains 'video/' and trashed = false";
    let where = 'im ganzen Drive';
    if (name) {
      const safe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const f = await api('files', {
        q: `mimeType = 'application/vnd.google-apps.folder' and name = '${safe}' and trashed = false`,
        fields: 'files(id,name)',
        pageSize: 10,
      });
      if (f.files.length) { q = `'${f.files[0].id}' in parents and ${q}`; where = `im Ordner „${name}“`; }
      else where = `Ordner „${name}“ nicht gefunden, zeige alle Videos`;
    }
    const res = await api('files', {
      q,
      fields: 'files(id,name,size,mimeType,videoMediaMetadata(durationMillis,width,height))',
      orderBy: 'name',
      pageSize: 50,
    });
    if (!res.files.length) {
      $('list').innerHTML = '<p class="sub">Keine Videos gefunden.</p>';
      return set('list', 'bad', where);
    }
    set('list', 'ok', `${res.files.length} Videos ${where}`);
    $('list').innerHTML = '';
    for (const f of res.files) {
      const b = document.createElement('button');
      b.className = 'vid';
      const meta = f.videoMediaMetadata;
      const info = [meta?.durationMillis ? fmt(meta.durationMillis / 1000) : '', f.size ? `${Math.round(f.size / 1e6)} MB` : ''].filter(Boolean).join(' · ');
      b.innerHTML = `<span>${esc(f.name)}</span><small>${info}</small>`;
      b.onclick = () => play(f, b);
      $('list').append(b);
    }
  } catch (e) {
    $('list').innerHTML = '';
    set('list', 'bad', e.message);
  }
}
$('search').onclick = findVideos;

/* ---------- Abspielen ---------- */
function resetVideoChecks() {
  ['start', 'seek', 'resume', 'ended'].forEach(k => set(k, 'wait'));
}

function play(f, btn) {
  document.querySelectorAll('.vid').forEach(x => x.setAttribute('aria-pressed', x === btn));
  current = f;
  mode = 'stream';
  resetVideoChecks();
  sendToken();
  const saved = +store.get('pos:' + f.id) || 0;
  pendingResume = saved > 5 ? saved : 0;
  $('resumeInfo').textContent = pendingResume ? `Gemerkte Position ${fmt(saved)}, das Video springt dorthin.` : '';
  ['seek15', 'toEnd', 'fs', 'full'].forEach(id => { $(id).disabled = false; });
  t0 = performance.now();
  v.src = `stream/${f.id}`;
  v.play().catch(() => { /* Autoplay blockiert: Play-Taste im Player nutzen */ });
}

v.addEventListener('loadedmetadata', () => {
  if (!pendingResume) return;
  resumeTarget = pendingResume;
  pendingResume = 0;
  v.currentTime = resumeTarget;
});
v.addEventListener('playing', () => {
  if (state.start.s !== 'ok') {
    const how = mode === 'stream' ? 'direkt gestreamt' : 'komplett geladen';
    set('start', 'ok', `${how} · erstes Bild nach ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  requestWake();
});
v.addEventListener('seeked', () => {
  if (seekRequested) { seekRequested = false; set('seek', 'ok', `gesprungen auf ${fmt(v.currentTime)}`); }
  if (resumeTarget && Math.abs(v.currentTime - resumeTarget) < 3) { set('resume', 'ok', `weiter ab ${fmt(resumeTarget)}`); resumeTarget = 0; }
});
v.addEventListener('timeupdate', () => {
  if (!current || Date.now() - lastSave < 3000) return;
  lastSave = Date.now();
  store.set('pos:' + current.id, v.currentTime);
  if (v.currentTime > 10 && state.resume.s === 'wait' && !state.resume.note) {
    set('resume', 'wait', 'Position wird gespeichert. Zum Prüfen Seite neu laden und das Video erneut wählen.');
  }
});
v.addEventListener('ended', () => {
  set('ended', 'ok', 'Hier öffnet die echte App „Training abschließen“');
  if (current) store.del('pos:' + current.id);
  releaseWake();
});
v.addEventListener('pause', releaseWake);
v.addEventListener('error', () => {
  if (!v.getAttribute('src') || state.start.s === 'ok') return;
  const e = v.error;
  const msg = e ? `Code ${e.code}${e.message ? ', ' + e.message : ''}` : 'unbekannt';
  set('start', 'bad', mode === 'stream'
    ? `Direktes Streamen klappt nicht (${msg}). Bitte „Reserve: komplett laden“ probieren.`
    : `Auch komplett geladen klappt es nicht (${msg}).`);
});

$('seek15').onclick = () => {
  seekRequested = true;
  v.currentTime = Math.min(15 * 60, (v.duration || 900) - 10);
};
$('toEnd').onclick = () => {
  if (!v.duration) return;
  seekRequested = true;
  v.currentTime = v.duration - 5;
  v.play().catch(() => {});
};
$('fs').onclick = async () => { try { await v.requestFullscreen(); } catch { /* nicht verfügbar */ } };

/* Reserve: ganzes Video laden und lokal abspielen */
$('full').onclick = async () => {
  if (!current) return;
  mode = 'full';
  resetVideoChecks();
  set('start', 'wait', 'lädt komplett …');
  const p = $('prog');
  p.hidden = false;
  p.value = 0;
  const started = performance.now();
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${current.id}?alt=media`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!r.ok) throw new Error('Drive ' + r.status);
    const total = +current.size || +r.headers.get('Content-Length') || 0;
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) p.value = got / total;
    }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob(chunks, { type: current.mimeType || 'video/mp4' }));
    $('resumeInfo').textContent = `Geladen in ${((performance.now() - started) / 1000).toFixed(0)} s.`;
    t0 = performance.now();
    v.src = blobUrl;
    v.play().catch(() => {});
  } catch (e) {
    set('start', 'bad', 'Komplett laden fehlgeschlagen: ' + e.message);
  } finally {
    p.hidden = true;
  }
};

/* ---------- Bildschirm bleibt an ---------- */
async function requestWake() {
  if (!('wakeLock' in navigator)) return set('wake', 'bad', 'Wird von diesem Browser nicht unterstützt');
  if (wake) return;
  try {
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
    set('wake', 'ok');
  } catch (e) {
    set('wake', 'bad', e.message);
  }
}
function releaseWake() {
  wake?.release().catch(() => {});
  wake = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !v.paused) requestWake();
});

/* ---------- Bericht ---------- */
$('copy').onclick = async () => {
  const lines = [
    `Impuls Test-Player · ${new Date().toLocaleString('de-DE')}`,
    navigator.userAgent,
    current ? `Video: ${current.name} (${Math.round((current.size || 0) / 1e6)} MB)` : 'Kein Video gewählt',
    ...CHECKS.map(([k, label]) => `${ICON[state[k].s]} ${label}${state[k].note ? ' · ' + state[k].note : ''}`),
  ];
  const txt = lines.join('\n');
  $('report').textContent = txt;
  $('report').hidden = false;
  try {
    await navigator.clipboard.writeText(txt);
    $('copyMsg').textContent = 'Kopiert. Schick ihn mir im Chat.';
  } catch {
    $('copyMsg').textContent = 'Kopieren ging nicht. Markier den Text unten.';
  }
};

$('folder').value = CFG.folderName || 'EMS Training';
set('sw', 'wait');
initSW();
initAuth();
