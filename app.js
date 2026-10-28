(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/youtube.readonly'];
  const DRIVE = 'https://www.googleapis.com/drive/v3/';
  const YTAPI = 'https://www.googleapis.com/youtube/v3/';
  const DEMO = new URLSearchParams(location.search).has('demo');
  const GOAL = CFG.weeklyGoal || 2;
  const REST = CFG.minRestDays ?? 2;
  const PREFIX = DEMO ? 'impuls-demo.' : 'impuls.';

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

  /* ---------- Verlauf & Positionen (Version 1: nur auf diesem Gerät) ---------- */
  const sessions = {
    all: () => store.get('sessions', []),
    add(s) { const a = this.all(); a.push(s); store.set('sessions', a); },
  };
  const lastOf = key => { const a = sessions.all(); for (let i = a.length - 1; i >= 0; i--) if (a[i].key === key) return a[i]; return null; };
  const countOf = key => sessions.all().filter(s => s.key === key).length;
  // Einheiten pro Woche für die letzten n Wochen, die letzte ist die aktuelle
  function weekCounts(n) {
    const start = addDays(monday(new Date()), -7 * (n - 1));
    const c = Array(n).fill(0);
    for (const s of sessions.all()) {
      const w = Math.floor(daysBetween(fromKey(s.d), start) / 7);
      if (w >= 0 && w < n) c[w]++;
    }
    return { c, start };
  }
  const streakOf = c => { let k = c.length - 1, s = 0; if (c[k] < GOAL) k--; while (k >= 0 && c[k] >= GOAL) { s++; k--; } return s; };
  const pos = {
    all: () => store.get('pos', {}),
    get: key => pos.all()[key] || 0,
    set(key, t) { const p = pos.all(); p[key] = Math.round(t); store.set('pos', p); },
    del(key) { const p = pos.all(); delete p[key]; store.set('pos', p); },
  };

  /* ---------- Kategorien & Vorschaubilder ---------- */
  const TAGS = ['Ganzkörper', 'Oberkörper', 'Unterkörper', 'Rücken & Schulter', 'Sonstiges'];
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
  function poster(v) {
    const img = v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    const yt = v.src === 'yt';
    return `<span class="poster ${v.art || 'p-gen'}">${img}<span class="p-src${yt ? ' yt' : ''}">${yt ? 'YouTube' : 'Eigenes Video'}</span>${v.dur ? `<span class="p-dur">${fmt(v.dur)}</span>` : ''}${yt ? '' : `<span class="p-title">${esc(v.title)}</span>`}</span>`;
  }

  /* ---------- Google-Anmeldung ---------- */
  const auth = {
    token: null, exp: 0, client: null, pending: null,
    restore() {
      const t = store.get('token');
      if (t && t.exp > Date.now() + 120e3) { this.token = t.value; this.exp = t.exp; this.share(); }
    },
    valid(ms = 120e3) { return !!this.token && this.exp - Date.now() > ms; },
    share() { navigator.serviceWorker?.controller?.postMessage({ type: 'token', token: this.token }); },
    ready: () => !!window.google?.accounts?.oauth2,
    ensureClient() {
      if (this.client) return true;
      if (!this.ready()) return false;
      this.client = google.accounts.oauth2.initTokenClient({
        client_id: CFG.clientId,
        scope: SCOPES.join(' '),
        callback: r => this.done(r),
        error_callback: e => this.fail(new Error(
          e?.type === 'popup_closed' ? 'Das Anmeldefenster wurde geschlossen.'
            : e?.type === 'popup_failed_to_open' ? 'Das Anmeldefenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.'
              : 'Die Anmeldung wurde abgebrochen.')),
      });
      return true;
    },
    // Muss direkt aus einem Tipp heraus aufgerufen werden, sonst blockiert der Browser das Anmeldefenster.
    request() {
      return new Promise((resolve, reject) => {
        if (!this.ensureClient()) return reject(new Error('Die Google-Anmeldung lädt noch. Bitte gleich noch einmal tippen.'));
        this.pending = { resolve, reject };
        this.client.requestAccessToken({ prompt: store.get('consented') ? '' : 'consent' });
      });
    },
    done(r) {
      const p = this.pending;
      this.pending = null;
      if (r.error) return p?.reject(new Error(r.error_description || r.error));
      this.token = r.access_token;
      this.exp = Date.now() + (r.expires_in || 3600) * 1000;
      store.set('token', { value: this.token, exp: this.exp });
      store.set('consented', true);
      this.share();
      p?.resolve();
    },
    fail(e) { const p = this.pending; this.pending = null; p?.reject(e); },
    clear() { this.token = null; this.exp = 0; store.del('token'); },
    signOut() {
      if (this.token && this.ready()) google.accounts.oauth2.revoke(this.token, () => {});
      this.clear();
      store.del('consented');
    },
  };

  async function gapi(base, path, params) {
    const r = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: 'Bearer ' + auth.token } });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return data;
    const err = new Error(data.error?.message || 'Fehler ' + r.status);
    err.status = r.status;
    err.reason = [data.error?.status, ...(data.error?.errors || []).map(x => x.reason), ...(data.error?.details || []).map(x => x.reason)].filter(Boolean).join(' ');
    if (r.status === 401) auth.clear();
    throw err;
  }

  /* ---------- Videos laden ---------- */
  const state = { view: 'home', filter: 'Alle', videos: [], drive: 'idle', driveErr: '', yt: 'idle', ytErr: null, install: null };

  async function loadDrive() {
    const name = (CFG.folderName || 'EMS Training').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const folders = await gapi(DRIVE, 'files', { q: `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`, fields: 'files(id)', pageSize: 5 });
    if (!folders.files.length) throw new Error(`Der Ordner „${CFG.folderName}“ wurde in deinem Google Drive nicht gefunden.`);
    const res = await gapi(DRIVE, 'files', {
      q: `'${folders.files[0].id}' in parents and mimeType contains 'video/' and trashed = false`,
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
        tag: tagForName(title), art: artFor(title),
        thumb: f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, '=s640') : null,
      };
    });
  }

  async function loadYouTube() {
    const playlist = store.get('playlist', CFG.youtubePlaylistId || '');
    if (!playlist) return [];
    const ids = [];
    let pageToken = '';
    do {
      const r = await gapi(YTAPI, 'playlistItems', { part: 'contentDetails', playlistId: playlist, maxResults: 50, ...(pageToken && { pageToken }) });
      ids.push(...r.items.map(i => i.contentDetails.videoId));
      pageToken = r.nextPageToken || '';
    } while (pageToken && ids.length < 200);
    const vids = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await gapi(YTAPI, 'videos', { part: 'snippet,contentDetails', id: ids.slice(i, i + 50).join(',') });
      vids.push(...r.items);
    }
    return vids.map(v => {
      const th = v.snippet.thumbnails || {};
      return {
        key: 'y:' + v.id, src: 'yt', id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle,
        dur: isoDur(v.contentDetails.duration), tag: tagFromTitle(v.snippet.title), art: 'p-gen',
        thumb: (th.medium || th.high || th.default || {}).url || null,
      };
    });
  }

  function ytProblem(e) {
    const r = `${e.reason} ${e.message}`;
    if (e.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|disabled/i.test(r)) {
      return { msg: 'Die YouTube-Schnittstelle ist in deinem Google-Cloud-Projekt noch nicht eingeschaltet.', action: 'api' };
    }
    if (e.status === 403 && /insufficient|SCOPE/i.test(r)) return { msg: 'Beim Anmelden wurde der Zugriff auf YouTube nicht erlaubt.', action: 'relogin' };
    if (e.status === 404 || /playlistNotFound/i.test(r)) return { msg: 'Die Playlist wurde nicht gefunden. Wähle sie unter „Mehr“ aus deinen Playlists aus.', action: 'playlist' };
    return { msg: e.message, action: 'reload' };
  }

  async function loadAll() {
    state.drive = 'loading';
    state.yt = 'loading';
    render();
    const [d, y] = await Promise.allSettled([loadDrive(), loadYouTube()]);
    if (d.status === 'rejected' && d.reason.status === 401) return showLogin('Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.');
    state.drive = d.status === 'fulfilled' ? 'ok' : 'err';
    state.driveErr = d.status === 'rejected' ? d.reason.message : '';
    state.yt = y.status === 'fulfilled' ? (y.value.length ? 'ok' : 'empty') : 'err';
    state.ytErr = y.status === 'rejected' ? ytProblem(y.reason) : null;
    state.videos = [...(d.value || []), ...(y.value || [])];
    render();
  }

  /* ---------- Start ---------- */
  function suggestion() {
    const p = pos.all();
    const resume = state.videos.find(v => p[v.key] > 30 && (!v.dur || p[v.key] < v.dur - 30));
    if (resume) return { v: resume, label: 'Weitermachen', why: `Weiter ab <b>${fmt(p[resume.key])}</b>` };
    const own = state.videos.filter(v => v.src === 'drive');
    if (!own.length) return null;
    const ranked = own.map(v => ({ v, l: lastOf(v.key) })).sort((a, b) => (a.l ? fromKey(a.l.d).getTime() : 0) - (b.l ? fromKey(b.l.d).getTime() : 0));
    const { v, l } = ranked[0];
    return { v, label: 'Vorschlag für heute', why: l ? `Am längsten nicht dran: zuletzt <b>${agoText(daysBetween(new Date(), fromKey(l.d)))}</b>` : 'Noch nie trainiert' };
  }

  function renderHome() {
    const now = new Date();
    const { c } = weekCounts(8);
    const done = c[7];
    const all = sessions.all();
    const last = all[all.length - 1];
    const gap = last ? daysBetween(now, fromKey(last.d)) : null;
    const okFrom = last ? addDays(fromKey(last.d), REST) : null;
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
      next = `<article class="card next">${poster(v)}<div class="next-body"><p class="label">${sug.label}</p><h2 class="next-title">${esc(v.title)}</h2><p class="meta">${fmt(v.dur)} Min. · ${esc(v.tag)} · ${v.src === 'yt' ? 'YouTube' : 'Eigenes Video'}</p><p class="why">${sug.why}</p><div class="btn-row"><button class="btn-primary big" data-play="${esc(v.key)}">${icon('i-play', 'fill')}Training starten</button><button class="btn-ghost" data-go="lib">Anderes Video</button></div></div></article>`;
    }

    const wk = all.filter(s => { const n = daysBetween(fromKey(s.d), mon); return n >= 0 && n < 7; });
    const slots = Array.from({ length: Math.max(GOAL, wk.length) }, (_, k) => {
      const s = wk[k];
      if (s) return `<li class="slot on"><span class="dot">${icon('i-check')}</span><span><b>${fmtDay(fromKey(s.d))} · ${esc(s.title)}</b><small>${mins(s.sec)} Min.</small></span></li>`;
      const when = k === wk.length ? (gap === null || gap >= REST ? 'Heute möglich' : `Ab ${fmtDay(okFrom)}`) : 'Diese Woche';
      return `<li class="slot"><span class="dot">${k + 1}</span><span><b>Offen</b><small>${when}</small></span></li>`;
    }).join('');
    const chip = gap === null ? '<p class="chip">Noch keine Einheit gespeichert</p>'
      : gap >= REST ? `<p class="chip ok">${icon('i-check')}Pause ok · letzte Einheit ${agoText(gap)}</p>`
        : `<p class="chip warn">Letzte Einheit ${agoText(gap)} · nächste ab ${fmtDay(okFrom)}</p>`;

    const streak = streakOf(c);
    const bars = c.map((n, k) => `<div class="bar${k === 7 ? ' cur' : ''}"><span class="col"><i style="height:${Math.min(n, GOAL) / GOAL * 100}%"></i></span><small>${isoWeek(addDays(mon, (k - 7) * 7))}</small></div>`).join('');
    const streakTxt = all.length
      ? `<p class="streak-num"><b>${streak}</b>${streak === 1 ? 'Woche' : 'Wochen'} in Folge ${GOAL}×</p>`
      : '<p class="sub">Nach deinem ersten Training siehst du hier deine Wochen.</p>';

    const ck = store.get('check', {});
    const checked = ck.d === dayKey(now) ? ck.items || [] : [];
    const items = ['Anzug an, Akku geladen', 'Eaglefit-App verbunden', 'Wasser griffbereit', 'Tablet aufgestellt'];
    const list = items.map((t, i) => `<li><label><input type="checkbox" id="ck${i}" data-ck="${i}"${checked.includes(i) ? ' checked' : ''}><span>${t}</span></label></li>`).join('');

    const install = state.install
      ? `<article class="card install"><div><b>Impuls als App installieren</b><span class="sub">Dann startet Impuls vom Startbildschirm im Vollbild.</span></div><button class="btn-ghost" data-act="install">Installieren</button></article>`
      : '';

    $('#home').innerHTML = `
      <header class="a-head"><div><p class="a-date">${now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1 class="a-title">${done >= GOAL ? 'Wochenziel erreicht. Stark!' : `Bereit für Einheit ${done + 1} dieser Woche`}</h1></div></header>
      <div class="home-grid">${next}
        <article class="card week"><p class="label">Wochenziel · KW ${isoWeek(now)}</p><p class="week-count"><b>${done}</b><span>von ${GOAL}</span></p><ul class="slots">${slots}</ul>${chip}</article>
        <article class="card streak"><p class="label">Serie · Einheiten pro Woche</p>${streakTxt}<div class="bars">${bars}</div></article>
        <article class="card check"><p class="label">Vor dem Start</p><ul class="checklist">${list}</ul></article>
      </div>${install}`;
  }
  $('#home').addEventListener('change', e => {
    if (!e.target.matches('[data-ck]')) return;
    const today = dayKey(new Date());
    const ck = store.get('check', {});
    const items = new Set(ck.d === today ? ck.items : []);
    const i = +e.target.dataset.ck;
    e.target.checked ? items.add(i) : items.delete(i);
    store.set('check', { d: today, items: [...items] });
  });

  /* ---------- Bibliothek ---------- */
  function ytNotice() {
    if (state.yt === 'loading') return '<div class="notice"><span>Lade deine YouTube-Playlist …</span></div>';
    if (state.yt === 'empty') return '<div class="notice"><b>Keine YouTube-Videos</b><span>Die gewählte Playlist ist leer. Unter „Mehr“ kannst du eine andere wählen.</span></div>';
    if (state.yt !== 'err') return '';
    const e = state.ytErr || {};
    const btn = e.action === 'api'
      ? '<a class="btn-ghost" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener">Schnittstelle einschalten</a><button class="btn-ghost" data-act="reload">Neu laden</button>'
      : e.action === 'relogin' ? '<button class="btn-ghost" data-act="relogin">Neu anmelden</button>'
        : e.action === 'playlist' ? '<button class="btn-ghost" data-act="settings">Playlist wählen</button>'
          : '<button class="btn-ghost" data-act="reload">Neu laden</button>';
    return `<div class="notice bad"><b>YouTube-Videos nicht geladen</b><span>${esc(e.msg)}</span><div class="btn-row">${btn}</div></div>`;
  }

  function renderLib() {
    const vids = state.videos;
    const filters = ['Alle', 'Eigene', 'YouTube', ...TAGS.filter(t => vids.some(v => v.tag === t))];
    if (!filters.includes(state.filter)) state.filter = 'Alle';
    const f = state.filter;
    const list = vids.filter(v => f === 'Alle' || (f === 'Eigene' && v.src === 'drive') || (f === 'YouTube' && v.src === 'yt') || v.tag === f);
    const p = pos.all();
    const cards = list.map(v => {
      const l = lastOf(v.key), n = countOf(v.key), r = p[v.key];
      const lastTxt = l ? `Zuletzt ${agoText(daysBetween(new Date(), fromKey(l.d)))} · ${n}× trainiert` : 'Noch nicht trainiert';
      const prog = r > 30 && v.dur ? `<span class="v-prog"><i style="width:${Math.min(100, r / v.dur * 100)}%"></i></span><span class="v-last">Weiter ab ${fmt(r)}</span>` : '';
      return `<button class="vcard" data-play="${esc(v.key)}">${poster(v)}<span class="v-body"><span class="v-title">${esc(v.title)}</span><span class="v-meta">${esc(v.tag)} · ${fmt(v.dur)} Min.${v.channel ? ' · ' + esc(v.channel) : ''}</span><span class="v-last">${lastTxt}</span>${prog}</span></button>`;
    }).join('');
    const own = vids.filter(v => v.src === 'drive').length;
    const driveNote = state.drive === 'err' && f !== 'YouTube'
      ? `<div class="notice bad"><b>Eigene Videos nicht geladen</b><span>${esc(state.driveErr)}</span><div class="btn-row"><button class="btn-ghost" data-act="reload">Neu laden</button></div></div>`
      : state.drive === 'loading' ? '<div class="notice"><span>Lade deine Videos aus Google Drive …</span></div>' : '';
    const ytNote = f === 'Alle' || f === 'YouTube' ? ytNotice() : '';
    $('#lib').innerHTML = `
      <header class="a-head"><div><p class="a-date">${vids.length} Videos · ${own} eigene · ${vids.length - own} YouTube</p><h1 class="a-title">Bibliothek</h1></div></header>
      <div class="chips">${filters.map(x => `<button data-filter="${esc(x)}" aria-pressed="${x === f}">${esc(x)}</button>`).join('')}</div>
      ${driveNote}${ytNote}
      <div class="lib-grid">${cards}</div>`;
  }

  /* ---------- Verlauf ---------- */
  function renderHist() {
    const all = sessions.all();
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
    const list = all.slice(-12).reverse().map(s => `<li><span class="s-date">${fmtDay(fromKey(s.d))}</span><span class="s-title">${esc(s.title)}</span><span class="s-min">${mins(s.sec)} Min.</span></li>`).join('');
    $('#hist').innerHTML = `
      <header class="a-head"><div><p class="a-date">Letzte 12 Wochen</p><h1 class="a-title">Verlauf</h1></div></header>
      <div class="stats"><div class="stat"><b>${all.length}</b><span>Einheiten</span></div><div class="stat"><b>${avg}</b><span>Ø pro Woche</span></div><div class="stat"><b>${h} h ${m}</b><span>Minuten Training</span></div></div>
      <div class="hist-grid">
        <article class="card"><p class="label">Trainingstage</p><div class="cal">${cal}</div></article>
        <article class="card"><p class="label">Letzte Einheiten</p>${list ? `<ol class="sess">${list}</ol>` : '<p class="sub">Noch keine Einheit gespeichert. Nach deinem ersten Training steht sie hier.</p>'}</article>
      </div>
      <p class="hint">Der Verlauf liegt in Version 1 nur auf diesem Gerät. Mit Version 2 wird er über dein Google Drive zwischen Tablet und Handy abgeglichen.</p>`;
  }

  function render() { renderHome(); renderLib(); renderHist(); }

  /* ---------- Navigation ---------- */
  function go(view) {
    state.view = view;
    $$('[data-s]').forEach(el => { el.hidden = el.dataset.s !== view; });
    $$('.nav-btn[data-go]').forEach(b => (b.dataset.go === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    $('#main').scrollTop = 0;
  }
  function showLogin(msg = '') {
    $('#app').dataset.view = 'login';
    $('#loginErr').textContent = msg;
    $('#loginErr').hidden = !msg;
  }
  function showApp() { $('#app').dataset.view = 'app'; }

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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wake.want) wake.on(); });

  /* ---------- Player ---------- */
  const pv = $('#pv');
  const player = {
    v: null, kind: null, yt: null, ytApi: null, poll: null, idleT: null,
    saveT: 0, watched: 0, lastT: 0, startAt: 0, pendingStart: 0, ended: false,
    mirrored: store.get('mirror', false),

    open(v) {
      if (!DEMO && !auth.valid(30 * 60e3)) {
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
      const P = $('#player');
      P.hidden = false;
      P.classList.toggle('yt', v.src === 'yt');
      P.classList.remove('idle');
      this.applyMirror();
      this.setTime(this.startAt, v.dur);
      this.playIcon(false);
      history.pushState({ player: true }, '');
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
        playerVars: { playsinline: 1, rel: 0, controls: 0, iv_load_policy: 3, fs: 0, disablekb: 1, start: Math.floor(start), origin: location.origin },
        events: {
          onStateChange: e => this.ytState(e.data),
          onError: e => this.ytError(e.data),
        },
      });
      clearInterval(this.poll);
      this.poll = setInterval(() => {
        if (this.yt?.getCurrentTime) this.tick(this.yt.getCurrentTime(), this.yt.getDuration() || v.dur);
      }, 500);
    },
    ytState(s) {
      if (s === 1) this.onPlay();
      else if (s === 2) this.onPause();
      else if (s === 0) this.finish(true);
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
        if (this.v && s !== 1 && s !== 3) { this.showBig(false); this.msg('Tippe einmal direkt ins Video, um es zu starten.'); }
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
    applyMirror() {
      $('#plStage').classList.toggle('mirror', this.mirrored);
      $('#plMirror').setAttribute('aria-pressed', this.mirrored);
    },
    // Bedienleisten blenden sich bei eigenen Videos nach 4 s aus, ein Tipp holt sie zurück.
    armIdle() {
      clearTimeout(this.idleT);
      $('#player').classList.remove('idle');
      if (this.kind === 'drive' && !pv.paused) this.idleT = setTimeout(() => $('#player').classList.add('idle'), 4000);
    },
    wakeUi() { clearTimeout(this.idleT); $('#player').classList.remove('idle'); if (this.kind === 'drive' && !pv.paused) this.armIdle(); },

    finish(ended) {
      if (!this.v || !$('#doneWrap').hidden) return;
      this.pause();
      this.ended = ended;
      const v = this.v;
      const sec = ended ? (this.dur() || this.cur()) : Math.min(this.dur() || Infinity, this.startAt + this.watched);
      this.doneSec = Math.round(sec);
      openDone(v, this.doneSec, ended);
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
      wake.off();
      $('#player').hidden = true;
      $('#doneWrap').hidden = true;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      render();
    },
  };
  const leavePlayer = () => { if (history.state?.player) history.back(); else player.close(); };
  window.addEventListener('popstate', () => { if (!$('#player').hidden) player.close(); });

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
  $('#plRestart').onclick = () => { player.startAt = 0; player.seekTo(0); $('#plRestart').hidden = true; };
  $('#plBar').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = player.dur();
    if (d) player.seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d);
  };
  $('#player').addEventListener('pointerdown', () => player.wakeUi());

  /* ---------- Abschluss ---------- */
  function openDone(v, sec, ended) {
    const n = weekCounts(1).c[0] + 1;
    $('#doneLabel').textContent = `${ended ? 'Geschafft' : 'Training beenden'} · ${v.title}`;
    $('#doneTitle').textContent = n >= GOAL ? `Einheit ${n} diese Woche · Wochenziel erreicht` : `Einheit ${n} von ${GOAL} diese Woche`;
    $('#doneText').textContent = `Du hast ${mins(sec)} Minuten trainiert. Soll ich das Training speichern?`;
    $('#doneBtns').innerHTML = `<button class="btn-primary" data-act="saveSession">${icon('i-check')}Speichern</button>`
      + (ended ? '' : '<button class="btn-ghost" data-act="closeDone">Weiter trainieren</button>')
      + '<button class="btn-ghost" data-act="discardSession">Nicht speichern</button>';
    $('#doneWrap').hidden = false;
  }

  /* ---------- Einstellungen ---------- */
  function openSettings() {
    const pl = store.get('playlist', CFG.youtubePlaylistId || '');
    $('#setBody').innerHTML = `
      <div class="set-row"><div><b>Google-Konto</b><span class="sub">${DEMO ? 'Demo-Modus' : 'Angemeldet'}</span></div><button class="btn-ghost" data-act="signout">Abmelden</button></div>
      <div class="set-row"><div><b>YouTube-Playlist</b><span class="sub">${pl ? esc(pl) : 'Keine gewählt'}</span></div><button class="btn-ghost" data-act="listPlaylists">Ändern</button></div>
      <div class="pick" id="plPick"></div>
      ${state.install ? '<div class="set-row"><div><b>Als App installieren</b><span class="sub">Impuls auf den Startbildschirm legen</span></div><button class="btn-ghost" data-act="install">Installieren</button></div>' : ''}
      <div class="set-row"><div><b>Test-Player</b><span class="sub">Prüft das Abspielen auf diesem Gerät</span></div><a class="btn-ghost" href="test.html">Öffnen</a></div>
      <p class="sub small">Impuls · Version 1</p>`;
    $('#setWrap').hidden = false;
  }
  $('#setWrap').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });

  /* ---------- Aktionen ---------- */
  const actions = {
    reload: () => loadAll(),
    relogin: () => auth.request()
      .then(() => { if (player.v) player.retry(); else loadAll(); toast('Angemeldet'); })
      .catch(e => toast(e.message)),
    settings: () => openSettings(),
    closeSettings: () => { $('#setWrap').hidden = true; },
    signout: () => { auth.signOut(); $('#setWrap').hidden = true; state.videos = []; showLogin(); },
    async listPlaylists() {
      const box = $('#plPick');
      box.innerHTML = '<p class="sub">Lade deine Playlists …</p>';
      try {
        const r = await gapi(YTAPI, 'playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: 50 });
        box.innerHTML = r.items.length
          ? r.items.map(p => `<button class="pick-btn" data-act="pickPlaylist" data-id="${esc(p.id)}"><b>${esc(p.snippet.title)}</b><span class="sub small">${p.contentDetails.itemCount} Videos</span></button>`).join('')
          : '<p class="sub">Du hast noch keine Playlists.</p>';
      } catch (e) {
        box.innerHTML = `<p class="sub">${esc(ytProblem(e).msg)}</p>`;
      }
    },
    pickPlaylist: t => { store.set('playlist', t.dataset.id); $('#setWrap').hidden = true; toast('Playlist gewählt'); loadAll(); },
    async install() {
      const e = state.install;
      if (!e) return;
      state.install = null;
      e.prompt();
      await e.userChoice.catch(() => {});
      renderHome();
      $('#setWrap').hidden = true;
    },
    plRetry: () => player.retry(),
    closeDone: () => { $('#doneWrap').hidden = true; },
    saveSession() {
      const v = player.v;
      if (!v) return;
      sessions.add({ d: dayKey(new Date()), key: v.key, title: v.title, src: v.src, sec: player.doneSec });
      pos.del(v.key);
      player.ended = true;
      leavePlayer();
      go('home');
      toast('Training gespeichert');
    },
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
    else if (t.dataset.play) { const v = state.videos.find(x => x.key === t.dataset.play); if (v) player.open(v); }
    else if (t.dataset.filter) { state.filter = t.dataset.filter; renderLib(); }
    else actions[t.dataset.act]?.(t);
  });

  $('#loginBtn').onclick = () => {
    auth.request()
      .then(() => { showApp(); go('home'); loadAll(); })
      .catch(e => showLogin(e.message));
  };

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.install = e; renderHome(); });

  /* ---------- Demo-Modus (?demo): Beispieldaten ohne Anmeldung, nur zum Ansehen ---------- */
  function demoData() {
    const own = [['Lanzarote', 1267], ['Norwegen Woche 2', 1362], ['Oberkörper Eskalation', 1340], ['Rücken Schulter Workout', 1264], ['Training in Norwegen', 1275]]
      .map(([title, dur]) => ({ key: 'd:demo-' + title, src: 'drive', id: 'demo', title, dur, tag: tagForName(title), art: artFor(title), thumb: null }));
    const yt = [{ key: 'y:y_06KgZeT9c', src: 'yt', id: 'y_06KgZeT9c', title: '20 Minuten eaglefit EMS Ganzkörper-Workout', channel: 'eaglefit', dur: 1200, tag: 'Ganzkörper', art: 'p-gen', thumb: 'https://i.ytimg.com/vi/y_06KgZeT9c/mqdefault.jpg' }];
    if (!store.get('sessions')) {
      const mon = monday(new Date());
      const seed = [];
      for (let w = 6; w >= 1; w--) for (const d of [0, 3]) {
        const v = own[seed.length % own.length];
        seed.push({ d: dayKey(addDays(mon, -7 * w + d)), key: v.key, title: v.title, src: 'drive', sec: v.dur });
      }
      store.set('sessions', seed);
    }
    return [...own, ...yt];
  }

  /* ---------- Start der App ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'need-token' && e.ports[0]) e.ports[0].postMessage(auth.valid(0) ? auth.token : null);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => auth.share());
    navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Service Worker laufen nur YouTube-Videos */ });
  }

  if (DEMO) {
    state.videos = demoData();
    state.drive = 'ok';
    state.yt = 'ok';
    showApp();
    go('home');
    render();
  } else if (!CFG.clientId) {
    showLogin('Die Client-ID fehlt in config.js.');
  } else {
    const gis = setInterval(() => { if (auth.ensureClient()) clearInterval(gis); }, 150);
    auth.restore();
    if (auth.valid()) { showApp(); go('home'); loadAll(); } else { render(); showLogin(); }
  }
})();
