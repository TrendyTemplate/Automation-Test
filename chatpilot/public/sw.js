// ChatPilot AI service worker: installable app, offline page, push notifications. Customer data is never cached.
const SHELL = 'cp-shell-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/offline.html', '/favicon.svg', '/icon-192.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // API calls and assets go straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')));
});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'ChatPilot AI', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ChatPilot AI', { body: d.body || '', icon: d.icon || '/icon-192.png', badge: d.badge || '/favicon.svg', tag: d.tag, renotify: Boolean(d.tag), data: { url: d.url || '/app' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/app', self.location.origin);
  if (url.origin !== self.location.origin) return;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((w) => new URL(w.url).pathname === '/app');
    if (win) { win.navigate(url.href); return win.focus(); }
    return self.clients.openWindow(url.href);
  }));
});
