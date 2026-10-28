// Service Worker: reicht Video-Anfragen an Google Drive weiter und hängt dabei den Login an.
// Der <video>-Player kann selbst keinen Authorization-Header senden, deshalb läuft das hier.
let token = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
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

self.addEventListener('fetch', e => {
  const m = new URL(e.request.url).pathname.match(/\/stream\/([\w-]+)$/);
  if (m) e.respondWith(stream(m[1], e.request));
});
