/* TavlaNest service worker — AppNest rules (requirements part 12):
   per-file caching (allSettled), navigation network-first with a timeout,
   friendly offline page (never an error), skipWaiting, and clean copies of
   redirected responses (Cloudflare shortens .html URLs with a 308). */
const VERSION = 'tavlanest-v4';
const CORE = ['./', 'index.html', 'manifest.json', 'privacy_policy.html', 'icon-192.png', 'icon-512.png'];

const OFFLINE = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TavlaNest</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#15120E;color:#F2E9D8;font-family:system-ui,sans-serif;text-align:center">
<div style="padding:24px"><div style="font-size:54px">🎲</div><h1 style="font-weight:600">אין חיבור לאינטרנט</h1><p style="color:#A99A80">TavlaNest לא נשמרה עדיין במכשיר. התחבר פעם אחת ונסה שוב.<br>No connection — connect once and try again.</p>
<button onclick="location.reload()" style="min-height:48px;padding:10px 22px;border-radius:12px;border:1.5px solid #C9A44C;background:#C9A44C;color:#15120E;font-weight:700;font-size:17px">נסה שוב · Retry</button></div></body></html>`;

// a navigation response that was redirected cannot be served from a SW — make a clean copy
async function clean(res) {
  if (!res || !res.redirected) return res;
  const body = await res.clone().blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.allSettled(CORE.map(async u => { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, await clean(r)); }));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

function timeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, er => { clearTimeout(t); rej(er); }); }); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const net = await timeout(fetch(req), 4000);
        if (net && net.ok) { const cl = await clean(net); c.put('index.html', cl.clone()); return cl; }
        throw new Error('bad');
      } catch (err) {
        const hit = await c.match('index.html') || await c.match('./');
        if (hit) return clean(hit);
        return new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(async r => { if (r && r.ok) c.put(req, await clean(r.clone())); return r; }).catch(() => null);
      return (hit && await clean(hit)) || (await net) || new Response('', { status: 504 });
    })());
    return;
  }
  // Google Fonts: stale-while-revalidate (works offline once loaded). Everything else (PeerJS, signalling): network only.
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION + '-fonts');
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || new Response('', { status: 504 });
    })());
  }
});
