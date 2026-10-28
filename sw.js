// Service Worker:
// 1. reicht Video-Anfragen (stream/<id>) an Google Drive weiter und hängt dabei den Login an,
//    weil der <video>-Player selbst keinen Authorization-Header senden kann;
// 2. hält die App-Dateien vor, damit Impuls schnell startet und sich installieren lässt.
// Bei jeder Änderung an app.css/app.js: Version hier und in index.html (?v=) erhöhen.
const CACHE = 'impuls-v6';
const SHELL = ['./', 'index.html', 'app.css?v=6', 'app.js?v=6', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
let token = null;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', e => {
  if (e.data?.type === 'token') token = e.data.token;
});

// Nach einem Neustart des Service Workers ist der Token weg: dann bei der offenen Seite nachfragen.
async function getToken() {
  if (token) return token;
  const pages = await self.clients.matchAll({ type: 'window' });
  for (const page of pages) {
    const t = await new Promise(resolve => {
      const ch = new MessageChannel();
      ch.port1.onmessage = ev => resolve(ev.data);
      page.postMessage({ type: 'need-token' }, [ch.port2]);
      setTimeout(() => resolve(null), 2000);
    });
    if (t) return (token = t);
  }
  return null;
}

async function stream(id, request) {
  const t = await getToken();
  if (!t) return new Response('Nicht angemeldet', { status: 401 });
  const headers = { Authorization: 'Bearer ' + t };
  const range = request.headers.get('Range');
  if (range) headers.Range = range;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers });
  if (res.status === 401) token = null;
  return res;
}

// App-Dateien: erst aus dem Netz (damit Updates sofort ankommen), ohne Netz aus dem Speicher.
async function shell(request) {
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(request, copy));
    }
    return res;
  } catch {
    return (await caches.match(request, { ignoreSearch: true }))
      || (request.mode === 'navigate' ? caches.match('index.html') : Response.error());
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const m = url.pathname.match(/\/stream\/([\w-]+)$/);
  if (m) return e.respondWith(stream(m[1], e.request));
  if (e.request.method === 'GET' && url.origin === self.location.origin) e.respondWith(shell(e.request));
});
