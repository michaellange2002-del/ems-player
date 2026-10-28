(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const S_DRIVE_READ = 'https://www.googleapis.com/auth/drive.readonly';
  const S_DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
  const S_YT = 'https://www.googleapis.com/auth/youtube.readonly';
  // Google erlaubt YouTube und drive.file nicht in derselben Anmeldung, daher zwei getrennte Anmeldungen.
  const DRIVE_SCOPES = [S_DRIVE_READ, S_DRIVE_FILE].join(' ');
  const AUTH_VERSION = 3; // bei neuen Berechtigungen erhöhen: dann wird einmal neu angemeldet
  const DRIVE = 'https://www.googleapis.com/drive/v3/';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/';
  const YTAPI = 'https://www.googleapis.com/youtube/v3/';
  const DATA_FILE = 'Impuls-Daten.json';
  const DEMO = new URLSearchParams(location.search).has('demo');
  const PREFIX = DEMO ? 'impuls-demo.' : 'impuls.';
  const FEEL = ['Locker', 'Gut', 'Fordernd', 'Hart', 'Am Limit'];
  const TAGS = ['Ganzkörper', 'Oberkörper', 'Unterkörper', 'Rücken & Schulter', 'Sonstiges'];
  // Die 12 Muskelgruppen des eaglefit PRO, Namen und Reihenfolge wie im Kreis der Eaglefit-App (im Uhrzeigersinn)
  const DEFAULT_GROUPS = ['Schulter', 'Oberer Rücken', 'Mittlerer Rücken', 'Unterer Rücken', 'Hinterer OS', 'Gesäß', 'Vorderer OS', 'Bauch Innen', 'Bauch Außen', 'Brust', 'Bizeps', 'Trizeps'];
  // Erster Vorschlag aus Version 2; wird automatisch ersetzt, solange er nicht von Hand geändert wurde
  const OLD_DEFAULT_GROUPS = ['Oberschenkel vorn', 'Oberschenkel hinten', 'Gesäß', 'Bauch', 'Unterer Rücken', 'Latissimus', 'Brust', 'Schultern', 'Bizeps', 'Trizeps'];
  // Körperwerte: Gewicht in kg, Körperfett in %, Umfänge in cm. pair = links/rechts in einer Zeile.
  const MEASURES = [
    { k: 'weight', name: 'Gewicht', unit: 'kg', lo: 20, hi: 300 },
    { k: 'fat', name: 'Körperfett', unit: '%', lo: 2, hi: 70, hint: 'falls deine Waage das misst' },
    { k: 'chest', name: 'Brust', unit: 'cm', lo: 30, hi: 250 },
    { k: 'waist', name: 'Bauch', unit: 'cm', lo: 30, hi: 250, hint: 'auf Höhe des Bauchnabels' },
    { k: 'hip', name: 'Hüfte', unit: 'cm', lo: 30, hi: 250 },
    { k: 'armL', name: 'Bizeps links', unit: 'cm', lo: 10, hi: 100, pair: 'Bizeps' },
    { k: 'armR', name: 'Bizeps rechts', unit: 'cm', lo: 10, hi: 100, pair: 'Bizeps' },
    { k: 'thighL', name: 'Oberschenkel links', unit: 'cm', lo: 20, hi: 150, pair: 'Oberschenkel' },
    { k: 'thighR', name: 'Oberschenkel rechts', unit: 'cm', lo: 20, hi: 150, pair: 'Oberschenkel' },
    { k: 'calfL', name: 'Wade links', unit: 'cm', lo: 15, hi: 100, pair: 'Wade' },
    { k: 'calfR', name: 'Wade rechts', unit: 'cm', lo: 15, hi: 100, pair: 'Wade' },
  ];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const fmt = s => {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  };
  const mins = s => Math.max(1, Math.round((s || 0) / 60));
  const minText = s => { const m = mins(s); return `${m} ${m === 1 ? 'Minute' : 'Minuten'}`; };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const icon = (id, cls = '') => `<svg class="ico ${cls}"><use href="#${id}"/></svg>`;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(PREFIX + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch { /* Speicher voll oder gesperrt */ } },
    del(k) { try { localStorage.removeItem(PREFIX + k); } catch { /* Speicher gesperrt */ } },
  };

  /* ---------- Datum ---------- */
  const DAY = 864e5;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const daysBetween = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / DAY);
  const monday = d => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
  const isoWeek = d => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  };
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const fmtDay = d => `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
  const agoText = n => n <= 0 ? 'heute' : n === 1 ? 'gestern' : `vor ${n} Tagen`;
  const relTime = ms => {
    const m = Math.round((Date.now() - ms) / 60e3);
    if (m < 1) return 'gerade eben';
    if (m < 60) return `vor ${m} Min.`;
    const d = new Date(ms);
    return daysBetween(new Date(), d) === 0 ? `heute ${pad(d.getHours())}:${pad(d.getMinutes())}` : fmtDay(d);
  };

  /* ---------- Daten: Verlauf, Kategorien, Einstellungen ----------
     Liegen lokal und als Impuls-Daten.json in Google Drive. Positionen zum Fortsetzen bleiben pro Gerät. */
  // plan: feste Trainingstage (0 = So … 6 = Sa) und Uhrzeit für den Kalender
  // height: Körpergröße in cm für den BMI
  const defaults = () => ({ goal: CFG.weeklyGoal || 2, rest: CFG.minRestDays ?? 2, groups: DEFAULT_GROUPS, plan: { days: [], time: '18:00' }, height: null });
  const db = {
    data: null,
    load() {
      let d = store.get('db', null);
      if (!d) {
        // Übernahme aus Version 1 (Verlauf nur auf dem Gerät)
        const old = store.get('sessions', []);
        d = {
          version: 1,
          sessions: old.map((s, i) => ({ id: uid() + i, t: fromKey(s.d).getTime() + i, ...s })),
          deleted: [], categories: {}, catT: 0, settings: defaults(), setT: 0,
        };
        store.set('db', d);
      }
      d.settings = { ...defaults(), ...d.settings };
      d.prefs = { fav: {}, hidden: {}, ...d.prefs };
      d.body = d.body || [];
      if (JSON.stringify(d.settings.groups) === JSON.stringify(OLD_DEFAULT_GROUPS)) {
        d.settings.groups = DEFAULT_GROUPS;
        d.setT = Date.now(); // damit der Abgleich die neue Liste auch auf die anderen Geräte bringt
        store.set('db', d);
      }
      this.data = d;
    },
    save() { store.set('db', this.data); },
    addSession(s) { this.data.sessions.push({ id: uid(), t: Date.now(), ...s }); this.save(); sync.soon(); },
    deleteSession(id) {
      this.data.sessions = this.data.sessions.filter(s => s.id !== id);
      this.data.deleted.push(id);
      this.save();
      sync.soon();
    },
    // Körperwerte { id, t, d, m: { weight: 84.2, waist: 92 } }. Ändern = alte Messung löschen, neue anlegen,
    // so führt der Abgleich Änderungen genauso zusammen wie neue Einheiten.
    saveBody(entry, replaceId) {
      if (replaceId) { this.data.body = this.data.body.filter(b => b.id !== replaceId); this.data.deleted.push(replaceId); }
      this.data.body.push({ id: uid(), t: Date.now(), ...entry });
      this.data.body.sort(byDay);
      this.save();
      sync.soon();
    },
    deleteBody(id) {
      this.data.body = this.data.body.filter(b => b.id !== id);
      this.data.deleted.push(id);
      this.save();
      sync.soon();
    },
    setCategory(key, tag) { this.data.categories = { ...this.data.categories, [key]: tag }; this.data.catT = Date.now(); this.save(); sync.soon(); },
    setSettings(patch) { this.data.settings = { ...this.data.settings, ...patch }; this.data.setT = Date.now(); this.save(); sync.soon(); },
    // YouTube-Playlist wird zwischengespeichert, damit sie ohne YouTube-Anmeldung auf allen Geräten da ist
    setYT(yt) { this.data.yt = yt; this.data.ytT = Date.now(); this.save(); sync.soon(); },
    // Favoriten und ausgeblendete Videos: { fav: { key: true }, hidden: { key: true } }
    togglePref(kind, key) {
      const p = { fav: {}, hidden: {}, ...this.data.prefs };
      p[kind] = { ...p[kind] };
      if (p[kind][key]) delete p[kind][key]; else p[kind][key] = true;
      this.data.prefs = p;
      this.data.prefT = Date.now();
      this.save();
      sync.soon();
    },
  };
  const goal = () => db.data.settings.goal;
  const rest = () => db.data.settings.rest;
  const groups = () => db.data.settings.groups;
  const allSessions = () => db.data.sessions;
  const lastOf = key => { const a = allSessions(); for (let i = a.length - 1; i >= 0; i--) if (a[i].key === key) return a[i]; return null; };
  const countOf = key => allSessions().filter(s => s.key === key).length;
  const byDay = (x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.t - y.t);
  const allBody = () => db.data.body;
  const lastWithInts = () => { const a = allSessions(); for (let i = a.length - 1; i >= 0; i--) if (a[i].ints && Object.keys(a[i].ints).length) return a[i]; return null; };
  // Einheiten pro Woche für die letzten n Wochen, die letzte ist die aktuelle
  function weekCounts(n) {
    const start = addDays(monday(new Date()), -7 * (n - 1));
    const c = Array(n).fill(0);
    for (const s of allSessions()) {
      const w = Math.floor(daysBetween(fromKey(s.d), start) / 7);
      if (w >= 0 && w < n) c[w]++;
    }
    return { c, start };
  }
  const streakOf = c => { const g = goal(); let k = c.length - 1, s = 0; if (c[k] < g) k--; while (k >= 0 && c[k] >= g) { s++; k--; } return s; };
  const pos = {
    all: () => store.get('pos', {}),
    get: key => pos.all()[key] || 0,
    set(key, t) {
      const p = pos.all(); p[key] = Math.round(t); store.set('pos', p);
      const at = store.get('posAt', {}); at[key] = Date.now(); store.set('posAt', at);
    },
    del(key) {
      const p = pos.all(); delete p[key]; store.set('pos', p);
      const at = store.get('posAt', {}); delete at[key]; store.set('posAt', at);
    },
  };

  /* ---------- Kategorien & Vorschaubilder ---------- */
  function tagFromTitle(t) {
    t = t.toLowerCase();
    if (/ganzk(ö|oe)rper|full.?body/.test(t)) return 'Ganzkörper';
    if (/r(ü|ue)cken|schulter|back|shoulder/.test(t)) return 'Rücken & Schulter';
    if (/oberk(ö|oe)rper|arme|brust|bauch|core|abs|upper/.test(t)) return 'Oberkörper';
    if (/beine|\bpo\b|unterk(ö|oe)rper|legs|glute|lower/.test(t)) return 'Unterkörper';
    return 'Sonstiges';
  }
  function tagForName(name) {
    const n = name.toLowerCase();
    for (const [k, v] of Object.entries(CFG.categories || {})) if (n.startsWith(k.toLowerCase())) return v;
    return tagFromTitle(name);
  }
  const ART = [['lanzarote', 'p-lz'], ['norwegen woche', 'p-nw'], ['training in norwegen', 'p-tn'], ['oberk', 'p-ok'], ['rücken', 'p-rs']];
  const artFor = name => (ART.find(([k]) => name.toLowerCase().includes(k)) || [null, 'p-gen'])[1];
  const isoDur = s => {
    const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || '') || [];
    return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  };
  const applyTags = () => state.videos.forEach(v => { v.tag = db.data.categories[v.key] || v.baseTag; });
  function poster(v) {
    const img = v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    const yt = v.src === 'yt';
    const fav = isFav(v.key) ? '<span class="p-fav" aria-label="Favorit">★</span>' : '';
    return `<span class="poster ${v.art || 'p-gen'}">${img}<span class="p-badges">${fav}<span class="p-src${yt ? ' yt' : ''}">${yt ? 'YouTube' : 'Eigenes Video'}</span></span>${v.dur ? `<span class="p-dur">${fmt(v.dur)}</span>` : ''}${yt ? '' : `<span class="p-title">${esc(v.title)}</span>`}</span>`;
  }

  /* ---------- Google-Anmeldung ----------
     Klassisches OAuth-Verfahren für Web-Apps (response_type=token) ohne Googles Anmeldebibliothek.
     Google leitet nach der Anmeldung auf auth.html zurück; die Seite legt den Token im Speicher ab,
     und die App übernimmt ihn von dort (auch wenn das Anmeldefenster in einem eigenen Tab lief). */
  // purpose 'drive': Hauptanmeldung (Videos lesen, Verlauf speichern); 'yt': nur zum Laden der Playlist
  const makeAuth = (key, purpose, defaultScope) => ({
    token: null, exp: 0, scope: '', pending: null,
    restore() {
      const t = store.get(key);
      if (t && t.v === AUTH_VERSION && t.exp > Date.now() + 120e3) { this.token = t.value; this.exp = t.exp; this.scope = t.scope || ''; this.share(); return true; }
      return false;
    },
    valid(ms = 120e3) { return !!this.token && this.exp - Date.now() > ms; },
    has(s) { return this.scope.split(' ').includes(s); },
    share() { if (purpose === 'drive') navigator.serviceWorker?.controller?.postMessage({ type: 'token', token: this.token }); },
    // Muss direkt aus einem Tipp heraus aufgerufen werden, sonst blockiert der Browser das Anmeldefenster.
    request(scope = defaultScope) {
      this.pending?.cancel();
      const state = `${purpose}.${uid()}${uid()}`;
      store.set('oauthState', state);
      store.del('oauthError');
      const params = new URLSearchParams({
        client_id: CFG.clientId,
        redirect_uri: new URL('auth.html', location.href).href,
        response_type: 'token',
        scope,
        state,
        ...(store.get('consented.' + purpose) !== AUTH_VERSION && { prompt: 'consent' }),
      });
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
      return new Promise((resolve, reject) => {
        const before = store.get(key)?.value;
        const check = () => {
          const t = store.get(key);
          if (t && t.v === AUTH_VERSION && t.value !== before && t.exp > Date.now()) {
            cleanup();
            this.token = t.value; this.exp = t.exp; this.scope = t.scope || '';
            this.share();
            resolve();
            return;
          }
          const err = store.get('oauthError');
          if (err) { store.del('oauthError'); cleanup(); reject(new Error(err)); }
        };
        const onStorage = e => { if (e.key === PREFIX + key || e.key === PREFIX + 'oauthError') check(); };
        const timer = setInterval(check, 700);
        const cleanup = () => {
          clearInterval(timer);
          window.removeEventListener('storage', onStorage);
          window.removeEventListener('focus', check);
          this.pending = null;
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', check);
        this.pending = { cancel: () => { cleanup(); reject(Object.assign(new Error(''), { silent: true })); } };
        const w = window.open(url, 'impuls-login', 'popup,width=480,height=680');
        // Kein Fenster möglich: ganze Seite zu Google umleiten, auth.html springt danach zurück
        if (!w) { store.set('returnTo', true); location.href = url; }
      });
    },
    clear() { this.token = null; this.exp = 0; store.del(key); },
    signOut() {
      if (this.token) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(this.token), { method: 'POST', mode: 'no-cors' }).catch(() => {});
      this.clear();
      store.del('consented.' + purpose);
    },
  });
  const auth = makeAuth('token', 'drive', DRIVE_SCOPES);
  const ytAuth = makeAuth('ytToken', 'yt', S_YT);

  async function gfetch(url, opts = {}, who = auth) {
    const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + who.token, ...(opts.headers || {}) } });
    if (r.ok) return r;
    const data = await r.json().catch(() => ({}));
    const err = new Error(data.error?.message || 'Fehler ' + r.status);
    err.status = r.status;
    err.reason = [data.error?.status, ...(data.error?.errors || []).map(x => x.reason), ...(data.error?.details || []).map(x => x.reason)].filter(Boolean).join(' ');
    if (r.status === 401) who.clear();
    throw err;
  }
  const gapi = async (base, path, params, who = auth) => (await gfetch(`${base}${path}?${new URLSearchParams(params)}`, {}, who)).json();

  /* ---------- Abgleich mit Google Drive ---------- */
  // Zusammenführen: Einheiten aus beiden Ständen (gelöschte bleiben gelöscht),
  // Kategorien und Einstellungen vom jeweils neueren Stand.
  function merge(a, b) {
    const deleted = [...new Set([...(a.deleted || []), ...(b.deleted || [])])];
    const gone = new Set(deleted);
    const byId = new Map();
    for (const s of [...(b.sessions || []), ...(a.sessions || [])]) if (s?.id && !gone.has(s.id)) byId.set(s.id, s);
    const bodyById = new Map();
    for (const m of [...(b.body || []), ...(a.body || [])]) if (m?.id && !gone.has(m.id)) bodyById.set(m.id, m);
    const aCat = (a.catT || 0) >= (b.catT || 0);
    const aSet = (a.setT || 0) >= (b.setT || 0);
    const aYt = (a.ytT || 0) >= (b.ytT || 0);
    const aPref = (a.prefT || 0) >= (b.prefT || 0);
    return {
      version: 1,
      sessions: [...byId.values()].sort((x, y) => x.t - y.t),
      body: [...bodyById.values()].sort(byDay),
      deleted,
      categories: (aCat ? a.categories : b.categories) || {},
      catT: Math.max(a.catT || 0, b.catT || 0),
      settings: (s => (JSON.stringify(s.groups) === JSON.stringify(OLD_DEFAULT_GROUPS) ? { ...s, groups: DEFAULT_GROUPS } : s))({ ...defaults(), ...((aSet ? a.settings : b.settings) || {}) }),
      setT: Math.max(a.setT || 0, b.setT || 0),
      yt: (aYt ? a.yt : b.yt) || null,
      ytT: Math.max(a.ytT || 0, b.ytT || 0),
      prefs: (aPref ? a.prefs : b.prefs) || { fav: {}, hidden: {} },
      prefT: Math.max(a.prefT || 0, b.prefT || 0),
    };
  }
  const fingerprint = d => JSON.stringify([(d.sessions || []).map(s => s.id).sort(), (d.body || []).map(b => b.id).sort(), [...(d.deleted || [])].sort(), d.catT || 0, d.setT || 0, d.ytT || 0, d.prefT || 0]);
  const isFav = key => !!db.data.prefs?.fav?.[key];
  const isHidden = key => !!db.data.prefs?.hidden?.[key];

  const sync = {
    status: 'idle', last: store.get('syncedAt', 0), err: '', busy: false, again: false, timer: null,
    allowed() { return !DEMO && auth.valid(0) && auth.has(S_DRIVE_FILE); },
    async findFile() {
      const known = store.get('fileId');
      if (known) return known;
      const r = await gapi(DRIVE, 'files', { q: `name = '${DATA_FILE}' and trashed = false`, fields: 'files(id)', orderBy: 'modifiedTime desc', pageSize: 5 });
      const id = r.files[0]?.id || null;
      if (id) store.set('fileId', id);
      return id;
    },
    async pull(id) {
      try { return await (await gfetch(`${DRIVE}files/${id}?alt=media`)).json(); }
      catch (e) { if (e.status === 404) { store.del('fileId'); return null; } throw e; }
    },
    async write(id, data) {
      const body = JSON.stringify({ ...data, updated: new Date().toISOString() });
      if (id) {
        await gfetch(`${UPLOAD}files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
        return id;
      }
      const create = async parents => {
        const meta = { name: DATA_FILE, mimeType: 'application/json', ...(parents && { parents }) };
        const b = 'impuls' + uid();
        const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
        const r = await gfetch(`${UPLOAD}files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body: multipart });
        return (await r.json()).id;
      };
      // Am liebsten in den Ordner „EMS Training“, sonst in „Meine Ablage“
      try { return await create(state.folderId ? [state.folderId] : null); }
      catch (e) { if (state.folderId && (e.status === 403 || e.status === 404)) return create(null); throw e; }
    },
    async run() {
      if (!this.allowed()) { this.status = 'off'; renderSyncBits(); return; }
      if (this.busy) { this.again = true; return; }
      this.busy = true;
      this.status = 'syncing';
      renderSyncBits();
      try {
        let id = await this.findFile();
        let remote = id ? await this.pull(id) : null;
        if (id && !remote) { id = await this.findFile(); remote = id ? await this.pull(id) : null; }
        const merged = remote ? merge(db.data, remote) : db.data;
        if (fingerprint(merged) !== fingerprint(db.data)) { db.data = merged; db.save(); render(); }
        if (!remote || fingerprint(merged) !== fingerprint(remote)) store.set('fileId', await this.write(id, merged));
        this.status = 'ok';
        this.err = '';
        this.last = Date.now();
        store.set('syncedAt', this.last);
      } catch (e) {
        this.status = 'err';
        this.err = e.message;
      } finally {
        this.busy = false;
        renderSyncBits();
        if (this.again) { this.again = false; this.run(); }
      }
    },
    soon() { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), 1200); },
    text() {
      if (DEMO) return 'Im Demo-Modus aus';
      if (this.status === 'off') return auth.valid(0) && !auth.has(S_DRIVE_FILE) ? 'Aus: Beim Anmelden wurde das Speichern in Drive nicht erlaubt' : 'Aus: nicht angemeldet';
      if (this.status === 'syncing') return 'Gleiche mit Google Drive ab …';
      if (this.status === 'err') return 'Abgleich fehlgeschlagen: ' + this.err;
      return this.last ? `Abgeglichen ${relTime(this.last)}` : 'Noch nicht abgeglichen';
    },
  };
  function renderSyncBits() {
    const line = $('#syncLine');
    if (line) { line.dataset.s = sync.status; $('#syncText').textContent = sync.text(); }
    const row = $('#setSync');
    if (row) row.textContent = sync.text();
  }

  /* ---------- Videos laden ---------- */
  const state = { sugIndex: 0, skipResume: false, view: 'home', filter: 'Alle', videos: [], driveVideos: [], demoYt: null, drive: 'idle', driveErr: '', ytLoading: false, ytErr: null, folderId: null, install: null, editCats: false, trendGroup: null, sheet: null, histTab: 'train', bodyKey: null };

  async function loadDrive() {
    const name = (CFG.folderName || 'EMS Training').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const folders = await gapi(DRIVE, 'files', { q: `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`, fields: 'files(id)', pageSize: 5 });
    if (!folders.files.length) throw new Error(`Der Ordner „${CFG.folderName}“ wurde in deinem Google Drive nicht gefunden.`);
    state.folderId = folders.files[0].id;
    const res = await gapi(DRIVE, 'files', {
      q: `'${state.folderId}' in parents and mimeType contains 'video/' and trashed = false`,
      fields: 'files(id,name,size,mimeType,thumbnailLink,videoMediaMetadata(durationMillis,width,height))',
      orderBy: 'name',
      pageSize: 100,
    });
    return res.files.map(f => {
      const title = f.name.replace(/\.[^.]+$/, '').trim();
      const m = f.videoMediaMetadata || {};
      return {
        key: 'd:' + f.id, src: 'drive', id: f.id, title,
        dur: Math.round((m.durationMillis || 0) / 1000),
        baseTag: tagForName(title), art: artFor(title),
        thumb: f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, '=s640') : null,
      };
    });
  }

  const ytPlaylist = () => db.data.yt?.playlist || store.get('playlist', CFG.youtubePlaylistId || '');
  // Liest die Playlist mit der YouTube-Anmeldung und speichert sie im Abgleich
  async function fetchPlaylist(playlist) {
    const ids = [];
    let pageToken = '';
    do {
      const r = await gapi(YTAPI, 'playlistItems', { part: 'contentDetails', playlistId: playlist, maxResults: 50, ...(pageToken && { pageToken }) }, ytAuth);
      ids.push(...r.items.map(i => i.contentDetails.videoId));
      pageToken = r.nextPageToken || '';
    } while (pageToken && ids.length < 200);
    const vids = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await gapi(YTAPI, 'videos', { part: 'snippet,contentDetails', id: ids.slice(i, i + 50).join(',') }, ytAuth);
      vids.push(...r.items);
    }
    return vids.map(v => {
      const th = v.snippet.thumbnails || {};
      return { id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, dur: isoDur(v.contentDetails.duration), thumb: (th.medium || th.high || th.default || {}).url || null };
    });
  }
  const ytVideos = () => (DEMO ? state.demoYt : db.data.yt?.items || []).map(v => ({
    key: 'y:' + v.id, src: 'yt', id: v.id, title: v.title, channel: v.channel, dur: v.dur,
    baseTag: tagFromTitle(v.title), art: 'p-gen', thumb: v.thumb,
  }));
  async function refreshYouTube(playlist = ytPlaylist()) {
    if (!playlist || !ytAuth.valid(0)) return;
    state.ytLoading = true;
    renderLib();
    try {
      db.setYT({ playlist, items: await fetchPlaylist(playlist), at: Date.now() });
      state.ytErr = null;
    } catch (e) {
      state.ytErr = ytProblem(e);
    } finally {
      state.ytLoading = false;
      render();
    }
  }
  const connectYouTube = () => ytAuth.request()
    .then(() => refreshYouTube())
    .catch(e => { if (!e.silent) toast(e.message); });

  function ytProblem(e) {
    const r = `${e.reason} ${e.message}`;
    if (e.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|disabled/i.test(r)) {
      return { msg: 'Die YouTube-Schnittstelle ist in deinem Google-Cloud-Projekt noch nicht eingeschaltet.', action: 'api' };
    }
    if (e.status === 401 || (e.status === 403 && /insufficient|SCOPE/i.test(r))) return { msg: 'Die YouTube-Verbindung ist abgelaufen oder wurde nicht erlaubt.', action: 'connect' };
    if (e.status === 404 || /playlistNotFound/i.test(r)) return { msg: 'Die Playlist wurde nicht gefunden. Wähle sie unter „Mehr“ aus deinen Playlists aus.', action: 'playlist' };
    return { msg: e.message, action: 'reload' };
  }

  async function loadAll() {
    state.drive = 'loading';
    render();
    try {
      state.driveVideos = await loadDrive();
      state.drive = 'ok';
      state.driveErr = '';
    } catch (e) {
      if (e.status === 401) return showLogin('Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.');
      state.drive = 'err';
      state.driveErr = e.message;
    }
    render();
    await sync.run();
    if (ytAuth.valid()) refreshYouTube(); // YouTube nur aktualisieren, wenn noch verbunden
  }

  /* ---------- Start ---------- */
  // Rangliste aller sichtbaren Videos (eigene und YouTube). Punkte:
  // lange nicht gemacht (bis 30, noch nie = 25), anderer Körperbereich als beim letzten Training (+12),
  // Favorit (+8), eigenes Trainer-Video (+3); das zuletzt trainierte Video rutscht ans Ende.
  function ranking() {
    const now = new Date();
    const all = allSessions();
    const last = all[all.length - 1];
    const lastTag = last ? state.videos.find(v => v.key === last.key)?.tag || null : null;
    return state.videos.filter(v => !isHidden(v.key)).map(v => {
      const l = lastOf(v.key);
      const days = l ? daysBetween(now, fromKey(l.d)) : null;
      let score = days === null ? 25 : Math.min(days, 30);
      const why = [days === null ? 'Noch nie trainiert' : `Zuletzt <b>${agoText(days)}</b>`];
      if (lastTag && v.tag !== lastTag && v.tag !== 'Sonstiges') { score += 12; why.push(`anderer Körperbereich als zuletzt (${esc(lastTag)})`); }
      if (isFav(v.key)) { score += 8; why.push('★ Favorit'); }
      if (v.src === 'drive') score += 3;
      if (last && last.key === v.key) score -= 50;
      return { v, score, why: why.join(' · ') };
    }).sort((a, b) => b.score - a.score);
  }
  function suggestion() {
    const p = pos.all(), at = store.get('posAt', {});
    // Angefangenes Video der letzten 7 Tage geht vor
    const resume = !state.skipResume && state.videos.find(v => !isHidden(v.key) && p[v.key] > 30 && (!v.dur || p[v.key] < v.dur - 30) && Date.now() - (at[v.key] || Date.now()) < 7 * DAY);
    if (resume) return { v: resume, label: 'Weitermachen', why: `Weiter ab <b>${fmt(p[resume.key])}</b>`, more: true };
    const r = ranking();
    if (!r.length) return null;
    const i = state.sugIndex % r.length;
    return { v: r[i].v, label: i ? `Vorschlag ${i + 1} von ${r.length}` : 'Vorschlag für heute', why: r[i].why, more: r.length > 1 };
  }

  function renderHome() {
    const now = new Date();
    const g = goal(), r = rest();
    const { c } = weekCounts(8);
    const done = c[7];
    const all = allSessions();
    const last = all[all.length - 1];
    const gap = last ? daysBetween(now, fromKey(last.d)) : null;
    const okFrom = last ? addDays(fromKey(last.d), r) : null;
    const mon = monday(now);

    const sug = suggestion();
    let next;
    if (!sug) {
      const text = state.drive === 'loading' ? 'Lade deine Videos aus Google Drive …'
        : state.drive === 'err' ? 'Deine Videos konnten nicht geladen werden: ' + state.driveErr
          : 'Im Ordner wurden keine Videos gefunden.';
      next = `<article class="card next empty"><p class="label">Vorschlag für heute</p><p class="sub">${esc(text)}</p>${state.drive === 'loading' ? '' : '<div class="btn-row"><button class="btn-ghost" data-act="reload">Neu laden</button></div>'}</article>`;
    } else {
      const v = sug.v;
      next = `<article class="card next">${poster(v)}<div class="next-body"><p class="label">${sug.label}</p><h2 class="next-title">${esc(v.title)}</h2><p class="meta">${fmt(v.dur)} Min. · ${esc(v.tag)} · ${v.src === 'yt' ? 'YouTube' : 'Eigenes Video'}</p><p class="why">${sug.why}</p><div class="btn-row"><button class="btn-primary big" data-play="${esc(v.key)}">${icon('i-play', 'fill')}Training starten</button>${sug.more ? '<button class="btn-ghost" data-act="nextSug">Anderer Vorschlag</button>' : '<button class="btn-ghost" data-go="lib">Anderes Video</button>'}</div></div></article>`;
    }

    const wk = all.filter(s => { const n = daysBetween(fromKey(s.d), mon); return n >= 0 && n < 7; });
    const slots = Array.from({ length: Math.max(g, wk.length) }, (_, k) => {
      const s = wk[k];
      if (s) return `<li class="slot on"><span class="dot">${icon('i-check')}</span><span><b>${fmtDay(fromKey(s.d))} · ${esc(s.title)}</b><small>${mins(s.sec)} Min.${s.feel != null ? ' · ' + FEEL[s.feel] : ''}</small></span></li>`;
      const when = k === wk.length ? (gap === null || gap >= r ? 'Heute möglich' : `Ab ${fmtDay(okFrom)}`) : 'Diese Woche';
      return `<li class="slot"><span class="dot">${k + 1}</span><span><b>Offen</b><small>${when}</small></span></li>`;
    }).join('');
    const chip = gap === null ? '<p class="chip">Noch keine Einheit gespeichert</p>'
      : gap >= r ? `<p class="chip ok">${icon('i-check')}Pause ok · letzte Einheit ${agoText(gap)}</p>`
        : `<p class="chip warn">Letzte Einheit ${agoText(gap)} · nächste ab ${fmtDay(okFrom)}</p>`;

    const streak = streakOf(c);
    const bars = c.map((n, k) => `<div class="bar${k === 7 ? ' cur' : ''}"><span class="col"><i style="height:${Math.min(n, g) / g * 100}%"></i></span><small>${isoWeek(addDays(mon, (k - 7) * 7))}</small></div>`).join('');
    const streakTxt = all.length
      ? `<p class="streak-num"><b>${streak}</b>${streak === 1 ? 'Woche' : 'Wochen'} in Folge ${g}×</p>`
      : '<p class="sub">Nach deinem ersten Training siehst du hier deine Wochen.</p>';

    const install = state.install
      ? `<article class="card install"><div><b>Impuls als App installieren</b><span class="sub">Dann startet Impuls vom Startbildschirm im Vollbild.</span></div><button class="btn-ghost" data-act="install">Installieren</button></article>`
      : '';

    $('#home').innerHTML = `
      <header class="a-head"><div><p class="a-date">${now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1 class="a-title">${done >= g ? 'Wochenziel erreicht. Stark!' : `Bereit für Einheit ${done + 1} dieser Woche`}</h1></div></header>
      <div class="home-grid">${next}
        <article class="card week"><p class="label">Wochenziel · KW ${isoWeek(now)}</p><p class="week-count"><b>${done}</b><span>von ${g}</span></p><ul class="slots">${slots}</ul>${chip}${(p => (p ? `<p class="planned">${icon('i-cal')}Nächster Termin: ${fmtPlanned(p)}</p>` : '<button class="btn-link left" data-act="settings">Trainingstage festlegen</button>'))(nextPlanned())}</article>
        <article class="card streak"><p class="label">Serie · Einheiten pro Woche</p>${streakTxt}<div class="bars">${bars}</div></article>
      </div>${install}`;
  }

  /* ---------- Trainingstage und Google Kalender ---------- */
  const DAYCODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  function nextPlanned(from = new Date()) {
    const { days = [], time = '18:00' } = db.data.settings.plan || {};
    if (!days.length) return null;
    const [hh, mm] = time.split(':').map(Number);
    for (let i = 0; i < 8; i++) {
      const d = addDays(startOfDay(from), i);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
      if (days.includes(d.getDay()) && at > from) return at;
    }
    return null;
  }
  // Vorlage für einen wöchentlichen Serientermin; gespeichert wird erst, wenn du im Kalender bestätigst
  function calendarUrl() {
    const start = nextPlanned();
    if (!start) return null;
    const end = new Date(start.getTime() + 30 * 60e3);
    const f = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
      action: 'TEMPLATE',
      text: 'EMS-Training',
      dates: `${f(start)}/${f(end)}`,
      ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
      recur: `RRULE:FREQ=WEEKLY;BYDAY=${db.data.settings.plan.days.map(d => DAYCODE[d]).join(',')}`,
      details: `Training mit Impuls: ${new URL('./', location.href).href}`,
    });
  }
  const fmtPlanned = d => `${daysBetween(d, new Date()) === 0 ? 'heute' : daysBetween(d, new Date()) === 1 ? 'morgen' : fmtDay(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;

  /* ---------- Vor dem Start: kurzer Hinweis, einmal pro Trainingseinheit ---------- */
  const PREP = ['Anzug an, Akku geladen', 'Eaglefit-App verbunden', 'Wasser griffbereit', 'Handtuch bereitgelegt', 'Hanteln und andere Geräte bereitgelegt, falls nötig'];
  const PREP_PAUSE = 3 * 3600e3; // innerhalb von 3 Stunden nicht erneut zeigen (Videowechsel, Weitermachen)
  function startTraining(v) {
    if (Date.now() - store.get('prepOk', 0) < PREP_PAUSE) return player.open(v);
    state.pendingVideo = v;
    state.sheet = 'prep';
    openSheet(`
      <p class="label">${esc(v.title)}</p>
      <h2 class="sheet-title">Bereit fürs Training?</h2>
      <ul class="prep">${PREP.map(t => `<li>${icon('i-check')}<span>${t}</span></li>`).join('')}</ul>
      <div class="btn-row"><button class="btn-primary big" data-act="prepOk">${icon('i-play', 'fill')}OK, los geht's</button><button class="btn-ghost" data-act="closeSheet">Abbrechen</button></div>`);
  }

  /* ---------- Bibliothek ---------- */
  function ytNotice() {
    if (DEMO) return '';
    const yt = db.data.yt;
    if (state.ytLoading) return '<div class="notice"><span>Lade deine YouTube-Playlist …</span></div>';
    if (state.ytErr) {
      const e = state.ytErr;
      const btn = e.action === 'api'
        ? '<a class="btn-ghost" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener">Schnittstelle einschalten</a><button class="btn-ghost" data-act="ytConnect">Nochmal versuchen</button>'
        : e.action === 'playlist' ? '<button class="btn-ghost" data-act="settings">Playlist wählen</button>'
          : '<button class="btn-ghost" data-act="ytConnect">Neu verbinden</button>';
      return `<div class="notice bad"><b>YouTube-Playlist nicht geladen</b><span>${esc(e.msg)}</span><div class="btn-row">${btn}</div></div>`;
    }
    if (!yt) return '<div class="notice"><b>YouTube verbinden</b><span>Melde dich einmal bei YouTube an, dann lädt Impuls deine Playlist. Abspielen klappt danach ohne YouTube-Anmeldung, auf allen Geräten.</span><div class="btn-row"><button class="btn-primary" data-act="ytConnect">YouTube verbinden</button></div></div>';
    return `<div class="yt-bar"><span class="sub">YouTube-Playlist · ${yt.items.length} Videos · aktualisiert ${relTime(yt.at)}</span><button class="btn-ghost small-btn" data-act="ytRefresh">Aktualisieren</button></div>`;
  }

  function renderLib() {
    const all = state.videos;
    const hiddenCount = all.filter(v => isHidden(v.key)).length;
    const vids = all.filter(v => !isHidden(v.key));
    const filters = [
      'Alle', ...(vids.some(v => isFav(v.key)) ? ['Favoriten'] : []), 'Eigene', 'YouTube',
      ...TAGS.filter(t => vids.some(v => v.tag === t)), ...(hiddenCount ? ['Ausgeblendet'] : []),
    ];
    if (!filters.includes(state.filter)) state.filter = 'Alle';
    const f = state.filter;
    const list = f === 'Ausgeblendet'
      ? all.filter(v => isHidden(v.key))
      : vids.filter(v => f === 'Alle' || (f === 'Favoriten' && isFav(v.key)) || (f === 'Eigene' && v.src === 'drive') || (f === 'YouTube' && v.src === 'yt') || v.tag === f)
        .sort((a, b) => isFav(b.key) - isFav(a.key)); // Favoriten zuerst
    const p = pos.all();
    const cards = list.map(v => {
      const l = lastOf(v.key), n = countOf(v.key), r = p[v.key];
      const lastTxt = l ? `Zuletzt ${agoText(daysBetween(new Date(), fromKey(l.d)))} · ${n}× trainiert` : 'Noch nicht trainiert';
      const prog = r > 30 && v.dur ? `<span class="v-prog"><i style="width:${Math.min(100, r / v.dur * 100)}%"></i></span><span class="v-last">Weiter ab ${fmt(r)}</span>` : '';
      return `<button class="vcard${isHidden(v.key) ? ' is-hidden' : ''}" data-play="${esc(v.key)}">${poster(v)}<span class="v-body"><span class="v-title">${esc(v.title)}</span><span class="v-meta">${esc(v.tag)} · ${fmt(v.dur)} Min.${v.channel ? ' · ' + esc(v.channel) : ''}</span><span class="v-last">${lastTxt}</span>${prog}</span></button>`;
    }).join('');
    const own = vids.filter(v => v.src === 'drive').length;
    const driveNote = state.drive === 'err' && f !== 'YouTube'
      ? `<div class="notice bad"><b>Eigene Videos nicht geladen</b><span>${esc(state.driveErr)}</span><div class="btn-row"><button class="btn-ghost" data-act="reload">Neu laden</button></div></div>`
      : state.drive === 'loading' ? '<div class="notice"><span>Lade deine Videos aus Google Drive …</span></div>' : '';
    const ytNote = f === 'Alle' || f === 'YouTube' ? ytNotice() : '';
    const editNote = state.editCats
      ? '<div class="notice"><span>Tippe auf ein Video, um es als Favorit zu markieren, auszublenden oder seine Kategorie zu ändern.</span></div>'
      : f === 'Ausgeblendet' ? '<div class="notice"><span>Diese Videos erscheinen nicht in der Liste und nicht im Vorschlag. Über „Bearbeiten“ holst du sie zurück.</span></div>' : '';
    $('#lib').innerHTML = `
      <header class="a-head"><div><p class="a-date">${vids.length} Videos · ${own} eigene · ${vids.length - own} YouTube</p><h1 class="a-title">Bibliothek</h1></div>${all.length ? `<button class="btn-ghost small-btn" data-act="editCats" aria-pressed="${state.editCats}">${state.editCats ? 'Fertig' : 'Bearbeiten'}</button>` : ''}</header>
      <div class="chips">${filters.map(x => `<button data-filter="${esc(x)}" aria-pressed="${x === f}">${esc(x)}</button>`).join('')}</div>
      ${driveNote}${ytNote}${editNote}
      <div class="lib-grid${state.editCats ? ' editing' : ''}">${cards}</div>`;
  }

  // Video bearbeiten: Favorit, Ausblenden, Kategorie
  function openVideoEdit(key) {
    const v = state.videos.find(x => x.key === key);
    if (!v) return;
    state.sheet = 'video';
    const fav = isFav(key), hidden = isHidden(key);
    openSheet(`
      <p class="label">Video bearbeiten</p>
      <h2 class="sheet-title">${esc(v.title)}</h2>
      <div class="toggles">
        <button class="pick-btn" data-act="togglePref" data-kind="fav" data-key="${esc(key)}" aria-pressed="${fav}"><b>${fav ? '★ Favorit' : '☆ Als Favorit markieren'}</b><span class="sub small">Steht oben in der Liste und wird öfter vorgeschlagen</span></button>
        <button class="pick-btn" data-act="togglePref" data-kind="hidden" data-key="${esc(key)}" aria-pressed="${hidden}"><b>${hidden ? 'Ausgeblendet' : 'Ausblenden'}</b><span class="sub small">${hidden ? 'Tippen, um es wieder anzuzeigen' : 'Erscheint nicht mehr in Liste und Vorschlag'}</span></button>
      </div>
      <p class="q">Kategorie</p>
      <div class="pick">${TAGS.map(t => `<button class="pick-btn" data-act="pickCat" data-key="${esc(key)}" data-tag="${esc(t)}" aria-pressed="${t === v.tag}"><b>${esc(t)}</b>${t === v.baseTag ? '<span class="sub small">Vorschlag</span>' : ''}</button>`).join('')}</div>
      <div class="btn-row"><button class="btn-ghost" data-act="closeSheet">Fertig</button></div>`);
  }

  /* ---------- Verlauf ---------- */
  // o.fine: feineres Raster für Körperwerte (kleine Änderungen sollen sichtbar sein), o.fmt: Zahlen formatieren
  function chart(pts, o = {}) {
    const f = o.fmt || (v => v);
    if (pts.length < 2) return `<p class="sub">${pts.length ? o.one || `Bisher ein Wert: ${pts[0].v}. Ab der zweiten Einheit siehst du hier den Verlauf.` : 'Noch keine Werte.'}</p>`;
    const vals = pts.map(p => p.v);
    const mn = Math.min(...vals), mx = Math.max(...vals);
    let lo, hi, step;
    if (o.fine) {
      step = [0.5, 1, 2, 5, 10, 20].find(s => (mx - mn) / s <= 4) || 50;
      lo = Math.max(0, Math.floor(mn / step - 0.5) * step);
      hi = Math.ceil(mx / step + 0.5) * step;
    } else {
      lo = Math.max(0, Math.floor((mn - 2) / 5) * 5);
      hi = Math.ceil((mx + 2) / 5) * 5;
      if (hi - lo < 10) hi = lo + 10;
      step = hi - lo > 30 ? 10 : 5;
    }
    const W = 440, H = 150, L = 30, R = o.fine ? 46 : 34, T = 14, B = 24;
    const x = i => L + i * (W - L - R) / (pts.length - 1);
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H - B} L${x(0).toFixed(1)} ${H - B} Z`;
    let grid = '';
    for (let t = lo; t <= hi + 1e-9; t += step) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${L - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${f(t)}</text>`;
    const last = pts[pts.length - 1];
    const dots = pts.slice(0, -1).map((p, i) => `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3"/>`).join('');
    return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf von ${f(pts[0].v)} auf ${f(last.v)}">${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${dots}<circle class="end" cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="5"/><text class="val" x="${(x(pts.length - 1) + 9).toFixed(1)}" y="${(y(last.v) + 4).toFixed(1)}">${f(last.v)}</text><text x="${x(0)}" y="${H - 6}">${fmtDay(pts[0].d)}</text><text x="${x(pts.length - 1)}" y="${H - 6}" text-anchor="end">${fmtDay(last.d)}</text></svg>`;
  }

  // Kopf des Verlaufs mit Umschalter Training ↔ Körperwerte
  const histHead = sub => `
      <header class="a-head"><div><p class="a-date">${sub}</p><h1 class="a-title">Verlauf</h1></div>${state.histTab === 'body' && allBody().length ? '<button class="btn-primary small-btn" data-act="bodyAdd">Werte eintragen</button>' : ''}</header>
      <div class="seg" role="group" aria-label="Verlauf anzeigen"><button data-act="histTab" data-tab="train" aria-pressed="${state.histTab !== 'body'}">Training</button><button data-act="histTab" data-tab="body" aria-pressed="${state.histTab === 'body'}">Körperwerte</button></div>
      <p class="sync-line" id="syncLine" data-s="${sync.status}"><i></i><span id="syncText">${esc(sync.text())}</span>${DEMO ? '' : (sync.status === 'off' && auth.valid(0) ? '<button class="btn-ghost small-btn" data-act="relogin">Neu anmelden</button>' : '<button class="btn-ghost small-btn" data-act="syncNow">Jetzt abgleichen</button>')}</p>`;

  function renderHist() {
    if (state.histTab === 'body') return renderBody();
    const all = allSessions();
    const { c, start } = weekCounts(12);
    const avg = (c.reduce((a, b) => a + b, 0) / 12).toFixed(1).replace('.', ',');
    const secs = all.reduce((a, s) => a + (s.sec || 0), 0);
    const h = Math.floor(secs / 3600), m = Math.round(secs % 3600 / 60);
    const today = startOfDay(new Date());
    const days = new Set(all.map(s => s.d));
    const rows = ['Mo', '', 'Mi', '', 'Fr', '', 'So'];
    let cal = '';
    for (let d = 0; d < 7; d++) {
      cal += `<span class="rl">${rows[d]}</span>`;
      for (let w = 0; w < 12; w++) {
        const dt = addDays(start, w * 7 + d);
        const k = dayKey(dt);
        const cls = [days.has(k) ? 'on' : '', dt > today ? 'fut' : '', k === dayKey(today) ? 'today' : ''].filter(Boolean).join(' ');
        cal += `<i class="${cls}" title="${fmtDay(dt)}"></i>`;
      }
    }
    cal += '<span></span>' + Array.from({ length: 12 }, (_, w) => `<span>${isoWeek(addDays(start, w * 7))}</span>`).join('');

    const withInts = all.filter(s => s.ints);
    const gs = [...groups(), ...new Set(withInts.flatMap(s => Object.keys(s.ints)))].filter((g, i, arr) => arr.indexOf(g) === i && withInts.some(s => s.ints[g] != null));
    if (!gs.includes(state.trendGroup)) state.trendGroup = gs[0] || null;
    const trend = gs.length
      ? `<div class="chips small">${gs.map(g => `<button data-act="trend" data-g="${esc(g)}" aria-pressed="${g === state.trendGroup}">${esc(g)}</button>`).join('')}</div>${chart(withInts.filter(s => s.ints[state.trendGroup] != null).slice(-12).map(s => ({ v: s.ints[state.trendGroup], d: fromKey(s.d) })))}`
      : '<p class="sub">Noch keine Intensitäts-Werte. Trag sie nach dem Training im Abschluss ein, dann siehst du hier, wie sie sich entwickeln.</p>';

    const list = all.slice(-15).reverse().map(s => `<li><button class="s-row" data-act="session" data-id="${esc(s.id)}"><span class="s-date">${fmtDay(fromKey(s.d))}</span><span class="s-title">${esc(s.title)}</span><span class="s-min">${mins(s.sec)} Min.</span>${s.feel != null ? `<span class="s-feel f${s.feel}">${FEEL[s.feel]}</span>` : ''}${s.ints ? `<span class="s-int">${Object.entries(s.ints).slice(0, 3).map(([k, n]) => `${esc(k)} ${n}`).join(' · ')}</span>` : ''}</button></li>`).join('');

    $('#hist').innerHTML = `${histHead('Letzte 12 Wochen')}
      <div class="stats"><div class="stat"><b>${all.length}</b><span>Einheiten</span></div><div class="stat"><b>${avg}</b><span>Ø pro Woche</span></div><div class="stat"><b>${h} h ${m}</b><span>Minuten Training</span></div></div>
      <div class="hist-grid">
        <article class="card"><p class="label">Trainingstage</p><div class="cal">${cal}</div></article>
        <article class="card"><p class="label">Intensität · letzte 12 Einheiten</p>${trend}</article>
        <article class="card list-card"><p class="label">Letzte Einheiten</p>${list ? `<ol class="sess">${list}</ol>` : '<p class="sub">Noch keine Einheit gespeichert. Nach deinem ersten Training steht sie hier.</p>'}</article>
      </div>`;
  }

  function openSession(id, confirm = false) {
    const s = allSessions().find(x => x.id === id);
    if (!s) return closeSheet();
    state.sheet = 'session';
    const ints = s.ints && Object.keys(s.ints).length
      ? `<div class="kv">${Object.entries(s.ints).map(([g, n]) => `<span>${esc(g)}</span><b>${n}</b>`).join('')}</div>`
      : '<p class="sub">Keine Intensitäts-Werte notiert.</p>';
    const buttons = confirm
      ? `<p class="sub">Diese Einheit wirklich löschen? Sie verschwindet auch auf deinen anderen Geräten.</p><div class="btn-row"><button class="btn-danger" data-act="deleteSession" data-id="${esc(s.id)}">Ja, löschen</button><button class="btn-ghost" data-act="session" data-id="${esc(s.id)}">Abbrechen</button></div>`
      : `<div class="btn-row"><button class="btn-ghost" data-act="closeSheet">Schließen</button><button class="btn-ghost danger" data-act="askDelete" data-id="${esc(s.id)}">Löschen</button></div>`;
    openSheet(`
      <p class="label">${fromKey(s.d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <h2 class="sheet-title">${esc(s.title)}</h2>
      <p>${minText(s.sec)}${s.feel != null ? ` · ${FEEL[s.feel]}` : ''}${s.src === 'yt' ? ' · YouTube' : ''}</p>
      ${s.note ? `<p class="note-view">${esc(s.note)}</p>` : ''}
      ${ints}
      ${buttons}`);
  }

  /* ---------- Körperwerte ---------- */
  const num = v => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const signed = v => (Math.abs(v) < 0.05 ? '±0' : (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const measure = k => MEASURES.find(m => m.k === k);
  const height = () => db.data.settings.height;
  const bmiOf = w => (height() && w ? Math.round(w / (height() / 100) ** 2 * 10) / 10 : null);
  const bmiClass = b => (b < 18.5 ? 'Untergewicht' : b < 25 ? 'Normalgewicht' : b < 30 ? 'Übergewicht' : 'Adipositas');
  const bodyName = k => (k === 'bmi' ? 'BMI' : measure(k).name);
  const bodyUnit = k => (k === 'bmi' ? '' : measure(k).unit);
  // Verlauf eines Werts; „bmi“ wird aus Gewicht und Körpergröße berechnet
  const seriesOf = k => allBody().map(b => ({ d: fromKey(b.d), v: k === 'bmi' ? bmiOf(b.m.weight) : b.m[k] })).filter(p => p.v != null);
  const latestOf = k => seriesOf(k).at(-1) || null;

  function renderBody() {
    const all = allBody();
    if (!all.length) {
      $('#hist').innerHTML = `${histHead('Gewicht, Umfänge, BMI')}
        <article class="card body-empty"><p class="label">Körperwerte</p><h2 class="next-title">Miss dich alle ein bis zwei Wochen</h2>
          <p class="sub">Gewicht und Umfänge an Brust, Bauch, Armen und Beinen, dazu einmal deine Körpergröße. Impuls rechnet daraus den BMI und zeigt dir, wie sich alles entwickelt.</p>
          <div class="btn-row"><button class="btn-primary" data-act="bodyAdd">Erste Werte eintragen</button></div></article>`;
      return;
    }
    const keys = MEASURES.map(m => m.k).filter(k => seriesOf(k).length);
    if (height() && keys.includes('weight')) keys.splice(1, 0, 'bmi');
    if (!keys.includes(state.bodyKey)) state.bodyKey = keys[0];
    const change = k => { const s = seriesOf(k); return s.length > 1 ? s.at(-1).v - s[0].v : null; };
    const tile = (k, label) => {
      const p = latestOf(k), c = change(k);
      return `<div class="stat"><b>${p ? num(p.v) : '–'}</b><span>${label}</span>${c != null ? `<small class="delta">${signed(c)} seit Beginn</small>` : ''}</div>`;
    };
    const w = latestOf('weight'), waist = latestOf('waist');
    const bmi = w && bmiOf(w.v);
    const bmiTile = bmi
      ? `<div class="stat"><b>${num(bmi)}</b><span>BMI</span><small class="delta">${bmiClass(bmi)}</small></div>`
      : `<div class="stat"><b>–</b><span>BMI</span><small class="delta">${height() ? 'Gewicht fehlt' : 'Größe fehlt'}</small></div>`;

    const k = state.bodyKey;
    const trend = `<div class="chips small">${keys.map(x => `<button data-act="bodyTrend" data-k="${x}" aria-pressed="${x === k}">${esc(bodyName(x))}</button>`).join('')}</div>
      ${chart(seriesOf(k).slice(-20), { fine: true, fmt: num, one: `Bisher eine Messung: ${num(latestOf(k).v)} ${bodyUnit(k)}. Ab der zweiten siehst du hier den Verlauf.` })}`;

    const rows = MEASURES.filter(m => latestOf(m.k)).map(m => {
      const c = change(m.k);
      return `<span>${esc(m.name)}</span><b>${num(latestOf(m.k).v)} ${m.unit}</b><small>${c != null ? signed(c) : ''}</small>`;
    }).join('');

    // BMI-Skala von 15 bis 40, Grenzen nach WHO
    const at = v => clamp((v - 15) / 25 * 100, 0, 100);
    const ratio = waist && height() ? waist.v / height() : null;
    const judge = bmi
      ? `<div class="bmi"><div class="bmi-head"><b>${num(bmi)}</b><span>${bmiClass(bmi)}</span></div>
          <div class="bmi-scale" role="img" aria-label="BMI ${num(bmi)}, ${bmiClass(bmi)}"><i class="u"></i><i class="n"></i><i class="o"></i><i class="a"></i><b style="left:${at(bmi).toFixed(1)}%"></b></div>
          <div class="bmi-ticks"><span style="left:${at(18.5)}%">18,5</span><span style="left:${at(25)}%">25</span><span style="left:${at(30)}%">30</span></div></div>
        <p class="sub small">Normal sind 18,5 bis 24,9. Muskeln sind schwerer als Fett: Wer viel trainiert, liegt beim BMI oft höher, ohne zu viel Fett zu haben.</p>`
      : `<p class="sub">${height() ? 'Trag dein Gewicht ein, dann rechnet Impuls deinen BMI aus.' : 'Trag einmal deine Körpergröße ein, dann rechnet Impuls deinen BMI aus.'}</p>`;
    const ratioTxt = ratio
      ? `<div class="kv"><span>Bauch geteilt durch Größe</span><b>${ratio.toFixed(2).replace('.', ',')}</b></div><p class="sub small">Richtwert: unter 0,5, also Bauchumfang höchstens halb so groß wie die Körpergröße. Sagt mehr über das Bauchfett als der BMI.</p>`
      : '';

    const list = all.slice(-20).reverse().map(b => {
      const ks = MEASURES.filter(m => b.m[m.k] != null);
      const [first, ...rest] = ks;
      const more = rest.slice(0, 4).map(m => `${m.name} ${num(b.m[m.k])}`).join(' · ');
      return `<li><button class="s-row" data-act="bodyEdit" data-id="${esc(b.id)}"><span class="s-date">${fmtDay(fromKey(b.d))}</span><span class="s-title">${first.k === 'weight' ? '' : esc(first.name) + ' '}${num(b.m[first.k])} ${first.unit}</span><span class="s-min">${ks.length} ${ks.length === 1 ? 'Wert' : 'Werte'}</span>${more ? `<span class="s-int">${esc(more)}</span>` : ''}</button></li>`;
    }).join('');

    $('#hist').innerHTML = `${histHead(`${all.length} ${all.length === 1 ? 'Messung' : 'Messungen'} seit ${fmtDay(fromKey(all[0].d))}`)}
      <div class="stats">${tile('weight', 'kg Gewicht')}${bmiTile}${tile('waist', 'cm Bauch')}</div>
      <div class="hist-grid body-grid">
        <article class="card"><p class="label">${esc(bodyName(k))}${bodyUnit(k) ? ` in ${bodyUnit(k)}` : ''} · letzte 20 Messungen</p>${trend}</article>
        <article class="card body-vals"><p class="label">Aktuelle Werte · Änderung seit Beginn</p><div class="kv kv3">${rows}</div></article>
        <article class="card"><p class="label">Einordnung${height() ? ` · ${num(height())} cm groß` : ''}</p>${judge}${ratioTxt}${height() ? '' : '<div class="btn-row"><button class="btn-ghost" data-act="bodyAdd" data-focus="height">Größe eintragen</button></div>'}</article>
        <article class="card list-card"><p class="label">Messungen</p><ol class="sess">${list}</ol></article>
      </div>`;
  }

  function openBody(id = null, confirm = false) {
    const e = id ? allBody().find(b => b.id === id) : null;
    if (id && !e) return closeSheet();
    state.sheet = 'body';
    // Grau im Feld steht der zuletzt gemessene Wert
    const field = m => {
      const last = latestOf(m.k);
      return `<input type="text" inputmode="decimal" maxlength="5" enterkeyhint="next" autocomplete="off" data-m="${m.k}" value="${e?.m[m.k] != null ? num(e.m[m.k]) : ''}" placeholder="${last ? num(last.v) : '–'}" aria-label="${esc(m.name)} in ${m.unit}">`;
    };
    const row = m => (m.pair
      ? `<div class="bf-row"><span>${esc(m.pair)}</span><span class="bf-in"><label><small>L</small>${field(m)}</label><label><small>R</small>${field(measure(m.k.slice(0, -1) + 'R'))}</label><em>cm</em></span></div>`
      : `<div class="bf-row"><span>${esc(m.name)}${m.hint ? `<small>${esc(m.hint)}</small>` : ''}</span><span class="bf-in">${field(m)}<em>${m.unit}</em></span></div>`);
    const rows = list => list.filter(m => !m.pair || m.k.endsWith('L')).map(row).join('');
    const today = dayKey(new Date());
    const buttons = confirm
      ? `<p class="sub">Diese Messung wirklich löschen? Sie verschwindet auch auf deinen anderen Geräten.</p><div class="btn-row"><button class="btn-danger" data-act="bodyDelete" data-id="${esc(id)}">Ja, löschen</button><button class="btn-ghost" data-act="bodyEdit" data-id="${esc(id)}">Abbrechen</button></div>`
      : `<div class="btn-row"><button class="btn-primary" data-act="bodySave" data-id="${esc(id || '')}">${icon('i-check')}Speichern</button><button class="btn-ghost" data-act="closeSheet">Abbrechen</button>${e ? `<button class="btn-ghost danger" data-act="bodyAskDelete" data-id="${esc(id)}">Löschen</button>` : ''}</div>`;
    openSheet(`
      <p class="label">Körperwerte</p>
      <h2 class="sheet-title">${e ? 'Messung ändern' : 'Werte eintragen'}</h2>
      <p class="sub small">Trag nur ein, was du gemessen hast. Grau steht dein letzter Wert. Am besten morgens vor dem Frühstück messen, immer an derselben Stelle.</p>
      <label class="time-lbl" for="bDate">Datum <input type="date" id="bDate" value="${e ? e.d : today}" max="${today}"></label>
      <div class="bform">
        ${rows(MEASURES.slice(0, 2))}
        <p class="q">Umfang in cm<span>Maßband straff anlegen, ohne einzuschnüren.</span></p>
        ${rows(MEASURES.slice(2))}
        <p class="q">Körpergröße<span>Für den BMI. Einmal eintragen reicht.</span></p>
        <div class="bf-row"><span>Größe</span><span class="bf-in"><input type="text" inputmode="decimal" maxlength="5" enterkeyhint="done" autocomplete="off" data-m="height" value="${height() ? num(height()) : ''}" placeholder="–" aria-label="Körpergröße in cm"><em>cm</em></span></div>
      </div>
      ${buttons}`);
    $('#sheet').scrollTop = 0;
  }

  function saveBody(id) {
    const m = {};
    let h = null;
    for (const inp of $$('#sheet input[data-m]')) {
      const raw = inp.value.trim().replace(',', '.');
      if (raw === '') continue;
      const def = inp.dataset.m === 'height' ? { name: 'Körpergröße', lo: 100, hi: 250 } : measure(inp.dataset.m);
      const v = +raw;
      if (!Number.isFinite(v) || v < def.lo || v > def.hi) { inp.focus(); return toast(`${def.name}: bitte prüfen (${def.lo} bis ${def.hi})`); }
      if (inp.dataset.m === 'height') h = Math.round(v * 10) / 10;
      else m[inp.dataset.m] = Math.round(v * 10) / 10;
    }
    const d = $('#bDate').value || dayKey(new Date());
    if (d > dayKey(new Date())) return toast('Das Datum liegt in der Zukunft');
    if (!Object.keys(m).length && !h) return toast('Bitte mindestens einen Wert eintragen');
    if (h && h !== height()) db.setSettings({ height: h });
    if (Object.keys(m).length) db.saveBody({ d, m }, id || null);
    closeSheet();
    renderHist();
    toast(!Object.keys(m).length ? 'Körpergröße gespeichert' : id ? 'Messung geändert' : 'Körperwerte gespeichert');
  }
  // Werte eintippen: Ziffern und ein Komma, „Weiter“ springt zum nächsten Feld
  const sheetEl = $('#sheet');
  sheetEl.addEventListener('input', e => {
    if (e.target.matches('input[data-m]')) e.target.value = e.target.value.replace(/\./g, ',').replace(/[^\d,]/g, '').replace(/(,.*),/g, '$1');
  });
  sheetEl.addEventListener('focusin', e => {
    if (!e.target.matches('input[data-m]')) return;
    const inp = e.target;
    setTimeout(() => { inp.select(); inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 50);
  });
  sheetEl.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('input[data-m]')) return;
    e.preventDefault();
    const all = $$('#sheet input[data-m]');
    const next = all[all.indexOf(e.target) + 1];
    if (next) next.focus(); else e.target.blur();
  });

  function render() {
    state.videos = [...state.driveVideos, ...ytVideos()];
    applyTags();
    renderHome();
    renderLib();
    renderHist();
  }

  /* ---------- Navigation, Blätter, Hinweise ----------
     Jeder Schritt (Bibliothek/Verlauf, Blatt, Player, Abschluss) bekommt einen Eintrag im Browser-Verlauf.
     So geht die Zurück-Taste des Handys einen Schritt zurück statt die App zu schließen.
     Unter der Startseite liegt der erste Eintrag der Seite: Wer dort landet, bekommt einen Hinweis,
     erst der nächste Druck auf Zurück schließt die App. */
  const ensureBase = () => { if (!history.state) history.pushState({ v: 'home' }, ''); };
  history.scrollRestoration = 'manual'; // Scrollen steuert die App selbst
  function showView(view) {
    const changed = state.view !== view;
    state.view = view;
    $$('.scr[data-s]').forEach(el => { el.hidden = el.dataset.s !== view; }); // nur die Seiten, die Sync-Zeile nutzt data-s für ihren Status
    $$('.nav-btn[data-go]').forEach(b => (b.dataset.go === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    if (changed) window.scrollTo(0, 0); // Blatt schließen lässt die Position, wo sie war
  }
  function go(view) {
    ensureBase();
    const cur = history.state.v || 'home';
    if (view === cur) return showView(view);
    if (view === 'home') { history.back(); return; } // zurück auf den Start-Eintrag, popstate zeigt die Startseite
    if (cur === 'home') history.pushState({ v: view }, '');
    else history.replaceState({ v: view }, ''); // Bibliothek ↔ Verlauf: Zurück führt danach zur Startseite
    showView(view);
  }
  function enterApp() {
    showApp();
    if (history.state) history.replaceState({ v: 'home' }, ''); else ensureBase();
    showView('home');
  }
  function showLogin(msg = '') {
    $('#app').dataset.view = 'login';
    $('#loginErr').textContent = msg;
    $('#loginErr').hidden = !msg;
    $('#loginErr').classList.remove('info');
  }
  function showApp() { $('#app').dataset.view = 'app'; }
  function openSheet(html) {
    if ($('#sheetWrap').hidden) { ensureBase(); history.pushState({ v: state.view, sheet: true }, ''); }
    $('#sheet').innerHTML = html;
    $('#sheetWrap').hidden = false;
  }
  function hideSheet() { $('#sheetWrap').hidden = true; state.sheet = null; }
  function closeSheet() { if (history.state?.sheet) history.back(); else hideSheet(); }
  $('#sheetWrap').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });
  $('#sheet').addEventListener('change', e => {
    if (e.target.id !== 'planTime' || !e.target.value) return;
    db.setSettings({ plan: { ...db.data.settings.plan, time: e.target.value } });
    renderHome();
    openSettings();
  });

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.innerHTML = icon('i-check') + esc(msg);
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 2800);
  }

  /* ---------- Bildschirm bleibt an ---------- */
  const wake = {
    lock: null, want: false,
    async on() {
      this.want = true;
      if (!this.lock && 'wakeLock' in navigator) {
        try {
          this.lock = await navigator.wakeLock.request('screen');
          this.lock.addEventListener('release', () => { this.lock = null; $('#plWake').classList.remove('on'); });
        } catch { /* nicht erlaubt, z. B. im Energiesparmodus */ }
      }
      $('#plWake').classList.toggle('on', !!this.lock);
    },
    off() {
      this.want = false;
      this.lock?.release().catch(() => {});
      this.lock = null;
      $('#plWake').classList.remove('on');
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (wake.want) wake.on();
    if (sync.allowed() && Date.now() - sync.last > 60e3) sync.run();
  });

  /* ---------- Player ---------- */
  const pv = $('#pv');
  const player = {
    v: null, kind: null, yt: null, ytApi: null, poll: null, idleT: null,
    saveT: 0, watched: 0, lastT: 0, startAt: 0, pendingStart: 0, ended: false, wasIdle: false,
    mirrored: store.get('mirror', false),

    open(v) {
      if (!DEMO && v.src === 'drive' && !auth.valid(30 * 60e3)) {
        // Token läuft bald ab: vor dem Training erneuern, damit das Video nicht mittendrin abbricht.
        auth.request().then(() => this.open(v)).catch(e => toast(e.message));
        return;
      }
      this.v = v;
      this.kind = v.src;
      this.ended = false;
      this.watched = 0;
      this.lastT = 0;
      const p = pos.get(v.key);
      this.startAt = p > 30 && (!v.dur || p < v.dur - 30) ? p : 0;
      $('#plTitle').textContent = v.title;
      $('#plSub').textContent = `${v.tag} · ${fmt(v.dur)} Min.${this.startAt ? ` · weiter ab ${fmt(this.startAt)}` : ''}`;
      $('#plRestart').hidden = !this.startAt;
      $('#plMsg').hidden = true;
      this.favIcon();
      const P = $('#player');
      P.hidden = false;
      P.classList.toggle('yt', v.src === 'yt');
      P.classList.remove('idle');
      this.applyMirror();
      this.setTime(this.startAt, v.dur);
      this.playIcon(false);
      ensureBase();
      // Kommt der Start aus dem Hinweis-Blatt, ersetzt der Player dessen Eintrag: Zurück führt dann direkt zur Ansicht
      if (history.state?.sheet) history.replaceState({ v: state.view, player: true }, '');
      else history.pushState({ v: state.view, player: true }, '');
      if (v.src === 'drive') this.openDrive(v, this.startAt);
      else this.openYT(v, this.startAt);
    },

    async openDrive(v, start) {
      $('#ytHost').hidden = true;
      pv.hidden = false;
      this.pendingStart = start;
      if (DEMO) {
        pv.removeAttribute('src');
        this.msg('Im Demo-Modus laufen nur YouTube-Videos.');
        return;
      }
      if (navigator.serviceWorker && !navigator.serviceWorker.controller) {
        await new Promise(r => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 3000); });
      }
      if (this.v !== v) return;
      auth.share();
      pv.src = `stream/${encodeURIComponent(v.id)}`;
      pv.play().catch(() => this.showBig(true));
    },

    loadYT() {
      if (!this.ytApi) {
        this.ytApi = new Promise(resolve => {
          window.onYouTubeIframeAPIReady = () => resolve(window.YT);
          const s = document.createElement('script');
          s.src = 'https://www.youtube.com/iframe_api';
          document.head.append(s);
        });
      }
      return this.ytApi;
    },

    async openYT(v, start) {
      pv.pause();
      pv.removeAttribute('src');
      pv.hidden = true;
      const host = $('#ytHost');
      host.hidden = false;
      host.innerHTML = '<div id="ytFrame"></div>';
      this.showBig(true);
      const YT = await this.loadYT();
      if (this.v !== v) return;
      this.yt = new YT.Player('ytFrame', {
        host: 'https://www.youtube-nocookie.com',
        videoId: v.id,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, controls: 0, iv_load_policy: 3, cc_load_policy: 0, hl: 'de', fs: 0, disablekb: 1, start: Math.floor(start), origin: location.origin },
        events: {
          onReady: () => { this.hideCaptions(); this.fitYT(); },
          onApiChange: () => this.hideCaptions(),
          onStateChange: e => this.ytState(e.data),
          onError: e => this.ytError(e.data),
        },
      });
      this.fitYT();
      clearInterval(this.poll);
      this.poll = setInterval(() => {
        if (this.yt?.getCurrentTime) this.tick(this.yt.getCurrentTime(), this.yt.getDuration() || v.dur);
      }, 500);
    },
    ytState(s) {
      const host = $('#ytHost');
      if (s === 1) { host.style.visibility = ''; host.classList.remove('touch'); this.hideCaptions(); this.onPlay(); }
      else if (s === 2) this.onPause();
      else if (s === 0) { host.style.visibility = 'hidden'; this.finish(true); } // Endbildschirm mit Vorschlägen verbergen
    },
    hideCaptions() {
      for (const m of ['captions', 'cc']) { try { this.yt?.unloadModule?.(m); } catch { /* Modul nicht geladen */ } }
      try { this.yt?.setOption?.('captions', 'track', {}); } catch { /* keine Untertitel vorhanden */ }
    },
    // Der YouTube-Rahmen wird höher als das Video gemacht und oben und unten abgeschnitten.
    // So liegen YouTubes Titelzeile, Logo, Link- und Vorschlagsleiste außerhalb des sichtbaren Bereichs.
    fitYT() {
      const host = $('#ytHost');
      const frame = host.querySelector('iframe');
      if (!frame) return;
      const W = host.clientWidth, H = host.clientHeight;
      let vw = W, vh = W * 9 / 16;
      if (vh > H) { vh = H; vw = H * 16 / 9; }
      const extra = Math.round(Math.max(170, vh * 0.4));
      Object.assign(frame.style, {
        width: `${vw}px`, height: `${vh + 2 * extra}px`,
        left: `${(W - vw) / 2}px`, top: `${(H - vh) / 2 - extra}px`,
        clipPath: `inset(${extra}px 0 ${extra}px 0)`,
      });
    },
    ytError(code) {
      const blocked = code === 101 || code === 150;
      this.msg(blocked ? 'Dieses Video darf nur direkt auf YouTube laufen.' : `YouTube meldet einen Fehler (${code}).`,
        `<a class="pl-btn" href="https://www.youtube.com/watch?v=${encodeURIComponent(this.v.id)}" target="_blank" rel="noopener">Auf YouTube öffnen</a>`);
      this.showBig(false);
    },

    cur() { return this.kind === 'yt' ? (this.yt?.getCurrentTime?.() || 0) : pv.currentTime || 0; },
    dur() { return (this.kind === 'yt' ? this.yt?.getDuration?.() : pv.duration) || this.v?.dur || 0; },
    seekTo(t) {
      t = Math.max(0, Math.min(t, (this.dur() || t + 1) - 1));
      if (this.kind === 'yt') this.yt?.seekTo?.(t, true); else pv.currentTime = t;
      this.lastT = t;
      this.setTime(t, this.dur());
    },
    seekBy(d) { this.seekTo(this.cur() + d); },
    pause() { if (this.kind === 'yt') this.yt?.pauseVideo?.(); else pv.pause(); },
    toggle() {
      if (this.kind === 'drive') {
        if (pv.paused) pv.play().catch(() => {}); else pv.pause();
        return;
      }
      if (!this.yt?.getPlayerState) return;
      if (this.yt.getPlayerState() === 1) { this.yt.pauseVideo(); return; }
      this.yt.playVideo();
      setTimeout(() => {
        const s = this.yt?.getPlayerState?.();
        if (this.v && s !== 1 && s !== 3) {
          // Startet der Browser das Video nicht über die App, darf man einmal direkt hineintippen.
          $('#ytHost').classList.add('touch');
          this.showBig(false);
          this.msg('Tippe einmal direkt ins Video, um es zu starten.');
        }
      }, 1800);
    },

    tick(t, d) {
      if (t > this.lastT && t - this.lastT < 2.5) this.watched += t - this.lastT; // nur echte Wiedergabe zählen
      this.lastT = t;
      this.setTime(t, d);
      if (Date.now() - this.saveT > 5000 && t > 5 && !this.ended) { this.saveT = Date.now(); pos.set(this.v.key, t); }
    },
    setTime(t, d) {
      $('#plEl').textContent = fmt(t);
      $('#plRem').textContent = d ? `−${fmt(d - t)}` : '';
      $('#plFill').style.width = d ? `${Math.min(100, t / d * 100)}%` : '0';
    },
    onPlay() { this.showBig(false); this.playIcon(true); $('#plMsg').hidden = true; wake.on(); this.armIdle(); },
    onPause() { this.playIcon(false); this.showBig(true); wake.off(); this.wakeUi(); },
    playIcon(p) {
      $('#plToggle').innerHTML = icon(p ? 'i-pause' : 'i-play', 'fill');
      $('#plToggle').setAttribute('aria-label', p ? 'Pause' : 'Abspielen');
    },
    showBig(show) { $('#plBig').hidden = !show; },
    msg(text, html = '') { $('#plMsg').innerHTML = `<span>${esc(text)}</span>${html}`; $('#plMsg').hidden = false; this.wakeUi(); },
    favIcon() {
      const f = !!this.v && isFav(this.v.key);
      $('#plFav').textContent = f ? '★' : '☆';
      $('#plFav').setAttribute('aria-pressed', f);
      $('#plFav').setAttribute('aria-label', f ? 'Favorit entfernen' : 'Als Favorit markieren');
    },
    applyMirror() {
      $('#plStage').classList.toggle('mirror', this.mirrored);
      $('#plMirror').setAttribute('aria-pressed', this.mirrored);
    },
    isPlaying() { return this.kind === 'yt' ? this.yt?.getPlayerState?.() === 1 : !pv.paused; },
    // Bedienleisten blenden sich beim Abspielen nach 4 s aus, ein Tipp holt sie zurück.
    armIdle() {
      clearTimeout(this.idleT);
      $('#player').classList.remove('idle');
      if (this.isPlaying()) this.idleT = setTimeout(() => $('#player').classList.add('idle'), 4000);
    },
    wakeUi() { clearTimeout(this.idleT); $('#player').classList.remove('idle'); if (this.isPlaying()) this.armIdle(); },

    finish(ended) {
      if (!this.v || !$('#doneWrap').hidden) return;
      this.pause();
      this.ended = ended;
      const sec = ended ? (this.dur() || this.cur()) : Math.min(this.dur() || Infinity, this.startAt + this.watched);
      openDone(this.v, Math.round(sec), ended);
    },
    retry() {
      const v = this.v;
      if (!v) return;
      const t = this.cur();
      $('#plMsg').hidden = true;
      if (v.src === 'drive') this.openDrive(v, t); else this.openYT(v, t);
    },
    close() {
      const v = this.v;
      if (v && !this.ended) {
        const t = this.cur();
        if (t > 30 && (!v.dur || t < v.dur - 30)) pos.set(v.key, t);
      }
      clearInterval(this.poll);
      this.poll = null;
      clearTimeout(this.idleT);
      this.v = null;
      pv.pause();
      pv.removeAttribute('src');
      pv.load();
      try { this.yt?.destroy(); } catch { /* schon weg */ }
      this.yt = null;
      $('#ytHost').innerHTML = '';
      $('#ytHost').style.visibility = '';
      $('#ytHost').classList.remove('touch');
      wake.off();
      $('#player').hidden = true;
      $('#doneWrap').hidden = true;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      render();
    },
  };
  // Player verlassen: Abschluss- und Player-Eintrag aus dem Verlauf nehmen, popstate räumt auf
  const leavePlayer = () => {
    const n = history.state?.done ? 2 : history.state?.player ? 1 : 0;
    if (n) history.go(-n); else player.close();
  };
  window.addEventListener('popstate', e => {
    const s = e.state || {};
    if (!$('#doneWrap').hidden && !s.done) $('#doneWrap').hidden = true;
    if (!$('#player').hidden && !s.player) player.close();
    if (!$('#sheetWrap').hidden && !s.sheet) hideSheet();
    if ($('#app').dataset.view !== 'app') return;
    showView(s.v || 'home');
    if (!e.state) toast('Zum Schließen nochmal zurück');
  });

  pv.addEventListener('loadedmetadata', () => {
    if (player.pendingStart) { pv.currentTime = player.pendingStart; player.lastT = player.pendingStart; player.pendingStart = 0; }
  });
  pv.addEventListener('timeupdate', () => { if (player.v && player.kind === 'drive') player.tick(pv.currentTime, pv.duration); });
  pv.addEventListener('playing', () => { if (player.v) player.onPlay(); });
  pv.addEventListener('pause', () => { if (player.v) player.onPause(); });
  pv.addEventListener('ended', () => { if (player.v) player.finish(true); });
  pv.addEventListener('error', () => {
    if (!player.v || player.kind !== 'drive' || !pv.getAttribute('src')) return;
    player.msg('Das Video lässt sich gerade nicht laden. Prüf die Internetverbindung oder melde dich neu an.',
      '<button class="pl-btn" data-act="plRetry">Nochmal versuchen</button><button class="pl-btn" data-act="relogin">Neu anmelden</button>');
  });

  $('#plBack').onclick = leavePlayer;
  $('#plBig').onclick = () => player.toggle();
  $('#plToggle').onclick = () => player.toggle();
  $('#plB10').onclick = () => player.seekBy(-10);
  $('#plF10').onclick = () => player.seekBy(10);
  $('#plMirror').onclick = () => { player.mirrored = !player.mirrored; store.set('mirror', player.mirrored); player.applyMirror(); };
  $('#plFull').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* nicht verfügbar */ }
  };
  $('#plFinish').onclick = () => player.finish(false);
  $('#plFav').onclick = () => {
    if (!player.v) return;
    db.togglePref('fav', player.v.key);
    player.favIcon();
    toast(isFav(player.v.key) ? 'Als Favorit markiert' : 'Favorit entfernt');
  };
  $('#plRestart').onclick = () => { player.startAt = 0; player.seekTo(0); $('#plRestart').hidden = true; };
  $('#plBar').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = player.dur();
    if (d) player.seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d);
  };
  // Tipp aufs Video: Sind die Leisten ausgeblendet, holt er sie nur zurück, sonst Play/Pause.
  $('#player').addEventListener('pointerdown', () => { player.wasIdle = $('#player').classList.contains('idle'); player.wakeUi(); });
  $('#plStage').addEventListener('click', () => { if (!player.wasIdle) player.toggle(); });
  window.addEventListener('resize', () => { if (player.v && player.kind === 'yt') player.fitYT(); });

  /* ---------- Abschluss: Gefühl, Intensität, Notiz ---------- */
  const done = { v: null, sec: 0, ended: false, feel: null };
  const feelButtons = () => FEEL.map((f, k) => `<button type="button" data-act="feel" data-k="${k}" aria-pressed="${done.feel === k}"><span class="bars5">${[0, 1, 2, 3, 4].map(j => `<i class="${j <= k ? 'f' : ''}"></i>`).join('')}</span><span>${f}</span></button>`).join('');
  function openDone(v, sec, ended) {
    Object.assign(done, { v, sec, ended, feel: null });
    const n = weekCounts(1).c[0] + 1, g = goal();
    const prev = lastWithInts();
    const ints = groups().map((name, i) => {
      const val = prev?.ints?.[name];
      return `<div class="int"><span>${esc(name)}</span><span class="step"><button type="button" data-act="intStep" data-i="${i}" data-d="-1" aria-label="${esc(name)} weniger">−</button><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" enterkeyhint="next" autocomplete="off" id="int${i}" data-i="${i}" data-g="${esc(name)}" value="${val ?? ''}" placeholder="–" aria-label="${esc(name)}"><button type="button" data-act="intStep" data-i="${i}" data-d="1" aria-label="${esc(name)} mehr">+</button></span></div>`;
    }).join('');
    $('#doneSheet').innerHTML = `
      <p class="label">${ended ? 'Geschafft' : 'Training beenden'} · ${esc(v.title)}</p>
      <h2 class="sheet-title">${n >= g ? `Einheit ${n} diese Woche · Wochenziel erreicht` : `Einheit ${n} von ${g} diese Woche`}</h2>
      <p class="sub">Du hast ${minText(sec)} trainiert.</p>
      <p class="q">Wie war's?</p>
      <div class="feel" id="feel">${feelButtons()}</div>
      <p class="q">Intensität notieren<span>${prev ? `Optional. Vorausgefüllt mit deinen Werten vom ${fmtDay(fromKey(prev.d))}` : 'Optional. Trag die Werte aus deiner Eaglefit-App ein.'} Tippe ins Feld, um eine Zahl einzugeben.</span></p>
      <div class="ints">${ints}</div>
      <input class="note" id="doneNote" type="text" maxlength="200" placeholder="Notiz, z. B. „Waden gekrampft“" aria-label="Notiz">
      <div class="btn-row"><button class="btn-primary" data-act="saveSession">${icon('i-check')}Speichern</button><button class="btn-ghost" data-act="saveNoValues">Ohne Werte speichern</button></div>
      <div class="btn-row">${ended ? '' : '<button class="btn-ghost" data-act="closeDone">Weiter trainieren</button>'}<button class="btn-link" data-act="discardSession">Nicht speichern</button></div>`;
    if (history.state?.player) history.pushState({ ...history.state, done: true }, ''); // Zurück schließt nur den Abschluss
    $('#doneWrap').hidden = false;
    $('#doneSheet').scrollTop = 0;
  }
  // Werte direkt eintippen: nur Ziffern, alter Wert wird markiert, „Weiter“ springt zur nächsten Gruppe
  const doneSheet = $('#doneSheet');
  doneSheet.addEventListener('input', e => {
    if (e.target.matches('input[data-g]')) e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3);
  });
  doneSheet.addEventListener('focusin', e => {
    if (!e.target.matches('input[data-g]')) return;
    const inp = e.target;
    setTimeout(() => { inp.select(); inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 50);
  });
  doneSheet.addEventListener('focusout', e => {
    if (e.target.matches('input[data-g]') && e.target.value !== '') e.target.value = clamp(+e.target.value, 0, 100);
  });
  doneSheet.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('input[data-g]')) return;
    e.preventDefault();
    ($('#int' + (+e.target.dataset.i + 1)) || $('#doneNote')).focus();
  });

  function saveDone(withValues) {
    const v = player.v;
    if (!v) return;
    let ints = null;
    if (withValues) {
      ints = {};
      $$('#doneSheet input[data-g]').forEach(inp => { if (inp.value !== '' && !Number.isNaN(+inp.value)) ints[inp.dataset.g] = clamp(Math.round(+inp.value), 0, 100); });
      if (!Object.keys(ints).length) ints = null;
    }
    const note = $('#doneNote').value.trim();
    db.addSession({
      d: dayKey(new Date()), key: v.key, title: v.title, src: v.src, sec: done.sec,
      ...(done.feel != null && { feel: done.feel }), ...(ints && { ints }), ...(note && { note }),
    });
    pos.del(v.key);
    player.ended = true;
    state.sugIndex = 0;
    state.skipResume = false;
    leavePlayer();
    toast('Training gespeichert');
  }

  /* ---------- Einstellungen ---------- */
  const stepper = (k, val, suffix) => `<span class="stepper"><button data-act="setStep" data-k="${k}" data-d="-1" aria-label="weniger">−</button><output>${val}${suffix}</output><button data-act="setStep" data-k="${k}" data-d="1" aria-label="mehr">+</button></span>`;
  function openSettings() {
    state.sheet = 'settings';
    const s = db.data.settings;
    const pl = ytPlaylist();
    openSheet(`
      <h2 class="sheet-title">Einstellungen</h2>
      <div class="set-list">
        <div class="set-row"><div><b>Google-Konto</b><span class="sub">${DEMO ? 'Demo-Modus' : 'Angemeldet'}</span></div><button class="btn-ghost" data-act="signout">Abmelden</button></div>
        <div class="set-row"><div><b>Abgleich mit Google Drive</b><span class="sub" id="setSync">${esc(sync.text())}</span></div><button class="btn-ghost" data-act="syncNow">Jetzt abgleichen</button></div>
        <div class="set-row"><div><b>Wochenziel</b><span class="sub">Einheiten pro Woche</span></div>${stepper('goal', s.goal, '×')}</div>
        <div class="set-row"><div><b>Mindestpause</b><span class="sub">Tage zwischen zwei Einheiten</span></div>${stepper('rest', s.rest, s.rest === 1 ? ' Tag' : ' Tage')}</div>
        <div class="set-col" id="planBox"><b>Trainingstage</b><span class="sub">Für den nächsten Termin auf der Startseite und deinen Google Kalender.</span>
          <div class="days">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((n, i) => { const d = (i + 1) % 7; return `<button data-act="planDay" data-d="${d}" aria-pressed="${s.plan.days.includes(d)}">${n}</button>`; }).join('')}</div>
          <label class="time-lbl" for="planTime">Uhrzeit <input type="time" id="planTime" value="${esc(s.plan.time)}"></label>
          ${(url => (url
            ? `<div class="btn-row"><a class="btn-primary" href="${esc(url)}" target="_blank" rel="noopener">${icon('i-cal')}In Google Kalender eintragen</a></div><span class="sub small">Öffnet Google Kalender mit einem wöchentlichen Serientermin. Dort mit „Speichern“ bestätigen.</span>`
            : '<span class="sub small">Wähle mindestens einen Tag, dann kannst du die Termine in deinen Google Kalender eintragen.</span>'))(calendarUrl())}
        </div>
        <div class="set-col"><b>Muskelgruppen</b><span class="sub">Eine pro Zeile, so wie in deiner Eaglefit-App.</span><textarea id="groupsInput" rows="6" aria-label="Muskelgruppen">${esc(s.groups.join('\n'))}</textarea><div class="btn-row"><button class="btn-ghost" data-act="saveGroups">Übernehmen</button></div></div>
        <div class="set-row"><div><b>YouTube-Playlist</b><span class="sub">${pl ? esc(pl) : 'Keine gewählt'}${db.data.yt ? ` · aktualisiert ${relTime(db.data.yt.at)}` : ''}</span></div><span class="btn-row"><button class="btn-ghost" data-act="ytRefresh">Aktualisieren</button><button class="btn-ghost" data-act="listPlaylists">Ändern</button></span></div>
        <div class="pick" id="plPick"></div>
        ${state.install ? '<div class="set-row"><div><b>Als App installieren</b><span class="sub">Impuls auf den Startbildschirm legen</span></div><button class="btn-ghost" data-act="install">Installieren</button></div>' : ''}
        <div class="set-row"><div><b>Test-Player</b><span class="sub">Prüft das Abspielen auf diesem Gerät</span></div><a class="btn-ghost" href="test.html">Öffnen</a></div>
      </div>
      <p class="sub small">Impuls · Version 2.1</p>
      <div class="btn-row"><button class="btn-ghost" data-act="closeSheet">Schließen</button></div>`);
  }

  /* ---------- Aktionen ---------- */
  const actions = {
    reload: () => loadAll(),
    relogin: () => auth.request()
      .then(() => { if (player.v) player.retry(); else loadAll(); toast('Angemeldet'); })
      .catch(e => toast(e.message)),
    settings: () => openSettings(),
    closeSheet: () => closeSheet(),
    signout: () => { auth.signOut(); ytAuth.signOut(); closeSheet(); state.driveVideos = []; showLogin(); },
    syncNow: () => sync.run(),
    ytConnect: () => connectYouTube(),
    ytRefresh: () => (ytAuth.valid() ? refreshYouTube() : connectYouTube()),
    async listPlaylists() {
      if (!ytAuth.valid()) {
        ytAuth.request().then(() => actions.listPlaylists()).catch(e => { if (!e.silent) toast(e.message); });
        return;
      }
      const box = $('#plPick');
      box.innerHTML = '<p class="sub">Lade deine Playlists …</p>';
      try {
        const r = await gapi(YTAPI, 'playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: 50 }, ytAuth);
        box.innerHTML = r.items.length
          ? r.items.map(p => `<button class="pick-btn" data-act="pickPlaylist" data-id="${esc(p.id)}"><b>${esc(p.snippet.title)}</b><span class="sub small">${p.contentDetails.itemCount} Videos</span></button>`).join('')
          : '<p class="sub">Du hast noch keine Playlists.</p>';
      } catch (e) {
        box.innerHTML = `<p class="sub">${esc(ytProblem(e).msg)}</p>`;
      }
    },
    pickPlaylist: t => { store.set('playlist', t.dataset.id); closeSheet(); toast('Playlist gewählt'); refreshYouTube(t.dataset.id); },
    setStep(t) {
      const k = t.dataset.k;
      const lim = k === 'goal' ? [1, 7] : [0, 6];
      db.setSettings({ [k]: clamp(db.data.settings[k] + +t.dataset.d, ...lim) });
      render();
      openSettings();
    },
    planDay(t) {
      const d = +t.dataset.d;
      const plan = db.data.settings.plan;
      const days = plan.days.includes(d) ? plan.days.filter(x => x !== d) : [...plan.days, d].sort();
      db.setSettings({ plan: { ...plan, days } });
      renderHome();
      openSettings();
    },
    saveGroups() {
      const list = [...new Set($('#groupsInput').value.split('\n').map(x => x.trim()).filter(Boolean))].slice(0, 16);
      if (!list.length) return toast('Bitte mindestens eine Muskelgruppe eintragen');
      db.setSettings({ groups: list });
      render();
      toast('Muskelgruppen gespeichert');
    },
    editCats: () => { state.editCats = !state.editCats; renderLib(); },
    pickCat: t => { db.setCategory(t.dataset.key, t.dataset.tag); render(); openVideoEdit(t.dataset.key); toast(`Kategorie: ${t.dataset.tag}`); },
    togglePref: t => { db.togglePref(t.dataset.kind, t.dataset.key); state.sugIndex = 0; render(); openVideoEdit(t.dataset.key); },
    nextSug() {
      if (suggestion()?.label === 'Weitermachen') state.skipResume = true;
      else state.sugIndex++;
      renderHome();
    },
    trend: t => { state.trendGroup = t.dataset.g; renderHist(); },
    session: t => openSession(t.dataset.id),
    askDelete: t => openSession(t.dataset.id, true),
    deleteSession: t => { db.deleteSession(t.dataset.id); closeSheet(); render(); toast('Einheit gelöscht'); },
    histTab: t => { state.histTab = t.dataset.tab; renderHist(); },
    bodyTrend: t => { state.bodyKey = t.dataset.k; renderHist(); },
    bodyAdd(t) {
      openBody();
      if (t.dataset.focus) $(`#sheet input[data-m="${t.dataset.focus}"]`)?.focus();
    },
    bodyEdit: t => openBody(t.dataset.id),
    bodySave: t => saveBody(t.dataset.id),
    bodyAskDelete: t => openBody(t.dataset.id, true),
    bodyDelete: t => { db.deleteBody(t.dataset.id); closeSheet(); renderHist(); toast('Messung gelöscht'); },
    async install() {
      const e = state.install;
      if (!e) return;
      state.install = null;
      e.prompt();
      await e.userChoice.catch(() => {});
      renderHome();
      closeSheet();
    },
    plRetry: () => player.retry(),
    prepOk() {
      const v = state.pendingVideo;
      state.pendingVideo = null;
      store.set('prepOk', Date.now());
      hideSheet();
      if (v) player.open(v);
    },
    feel: t => { done.feel = +t.dataset.k; $('#feel').innerHTML = feelButtons(); },
    intStep(t) {
      const inp = $('#int' + t.dataset.i);
      const cur = inp.value === '' ? 0 : +inp.value || 0;
      inp.value = clamp(cur + +t.dataset.d, 0, 100);
    },
    closeDone: () => { if (history.state?.done) history.back(); else $('#doneWrap').hidden = true; },
    saveSession: () => saveDone(true),
    saveNoValues: () => saveDone(false),
    discardSession() {
      const v = player.v;
      if (v && player.ended) pos.del(v.key);
      leavePlayer();
    },
  };

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-go],[data-play],[data-filter],[data-act]');
    if (!t) return;
    if (t.dataset.go) go(t.dataset.go);
    else if (t.dataset.play) {
      if (state.editCats) openVideoEdit(t.dataset.play);
      else { const v = state.videos.find(x => x.key === t.dataset.play); if (v) startTraining(v); }
    } else if (t.dataset.filter) { state.filter = t.dataset.filter; renderLib(); }
    else actions[t.dataset.act]?.(t);
  });

  // Klappt die Anmeldung nicht, gibt es eine Anmeldung ohne Drive-Abgleich (nur Lesen wie in Version 1).
  const login = scope => {
    showLogin('Melde dich im Google-Fenster an. Danach geht es hier von selbst weiter.');
    $('#loginErr').classList.add('info');
    $('#loginBasic').hidden = false; // Google meldet Fehler nur im eigenen Fenster, daher den Ausweg gleich anbieten
    auth.request(scope)
      .then(() => { enterApp(); loadAll(); })
      .catch(e => { if (e.silent) return; showLogin(e.message); $('#loginBasic').hidden = false; });
  };
  $('#loginBtn').onclick = () => login();
  $('#loginBasic').onclick = () => login(S_DRIVE_READ);

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.install = e; renderHome(); });

  /* ---------- Demo-Modus (?demo): Beispieldaten ohne Anmeldung, nur zum Ansehen ---------- */
  function demoData() {
    const own = [['Lanzarote', 1267], ['Norwegen Woche 2', 1362], ['Oberkörper Eskalation', 1340], ['Rücken Schulter Workout', 1264], ['Training in Norwegen', 1275]]
      .map(([title, dur]) => ({ key: 'd:demo-' + title, src: 'drive', id: 'demo', title, dur, baseTag: tagForName(title), art: artFor(title), thumb: null }));
    state.demoYt = [{ id: 'y_06KgZeT9c', title: '20 Minuten eaglefit EMS Ganzkörper-Workout', channel: 'eaglefit', dur: 1337, thumb: 'https://i.ytimg.com/vi/y_06KgZeT9c/mqdefault.jpg' }];
    if (!db.data.sessions.length) {
      const mon = monday(new Date());
      let i = 0;
      for (let w = 6; w >= 1; w--) {
        for (const d of [0, 3]) {
          const v = own[i % own.length];
          const base = 44 + i;
          const ints = Object.fromEntries(groups().map((g, k) => [g, base - (k % 5) * 3]));
          db.data.sessions.push({ id: 'demo' + i, t: addDays(mon, -7 * w + d).getTime(), d: dayKey(addDays(mon, -7 * w + d)), key: v.key, title: v.title, src: 'drive', sec: v.dur, feel: [1, 2, 2, 3][i % 4], ints });
          i++;
        }
      }
      db.save();
    }
    if (!db.data.body.length) {
      if (!db.data.settings.height) db.data.settings.height = 182;
      const r1 = v => Math.round(v * 10) / 10;
      const kg = [87.6, 87.1, 86.8, 86.2, 85.9, 85.1, 84.6];
      kg.forEach((weight, i) => {
        const d = addDays(new Date(), -10 * (kg.length - 1 - i) - 1);
        const m = { weight, fat: r1(22.4 - i * 0.35) };
        // Maßband nur jede zweite Messung, wie im echten Leben
        if (i % 2 === 0) Object.assign(m, { chest: r1(104 + i * 0.25), waist: r1(96 - i * 0.7), hip: r1(101 - i * 0.4), armL: r1(36 + i * 0.15), armR: r1(36.5 + i * 0.15), thighL: r1(58 + i * 0.1), thighR: r1(58.5 + i * 0.1), calfL: 38, calfR: 38.5 });
        db.data.body.push({ id: 'demob' + i, t: d.getTime(), d: dayKey(d), m });
      });
      db.save();
    }
    return own;
  }

  /* ---------- Start der App ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'need-token' && e.ports[0]) e.ports[0].postMessage(auth.valid(0) ? auth.token : null);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => auth.share());
    navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Service Worker laufen nur YouTube-Videos */ });
  }

  db.load();
  if (DEMO) {
    state.driveVideos = demoData();
    state.drive = 'ok';
    enterApp();
    render();
  } else if (!CFG.clientId) {
    showLogin('Die Client-ID fehlt in config.js.');
  } else {
    auth.restore();
    ytAuth.restore();
    const old = store.get('token');
    if (auth.valid()) { enterApp(); loadAll(); }
    else { render(); showLogin(old && old.v !== AUTH_VERSION ? 'Impuls darf jetzt deinen Verlauf in Google Drive speichern. Dafür brauchst du einmal eine neue Anmeldung.' : ''); }
    // Anmeldung in einem anderen Fenster oder Tab abgeschlossen: hier übernehmen
    window.addEventListener('focus', () => {
      if ($('#app').dataset.view === 'login' && !auth.pending && auth.restore()) { enterApp(); loadAll(); }
    });
  }
})();
