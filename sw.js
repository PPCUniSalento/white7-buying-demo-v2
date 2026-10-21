// Service worker: salva tutti i file dell'app per l'uso offline.
// A ogni pubblicazione con file modificati va incrementata VERSIONE.
// La v1 della demo è sullo stesso dominio: le cache di questa versione hanno il prefisso
// PREFISSO e all'attivazione si cancellano solo quelle, mai le cache della v1.

const PREFISSO = 'w7v2-';
const VERSIONE = PREFISSO + '4';
const FILE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/db.js',
  'js/util.js',
  'js/comp.js',
  'js/analisi.js',
  'js/excel.js',
  'js/views-buyer.js',
  'js/views-arrivi.js',
  'js/views-analisi.js',
  'js/views-altro.js',
  'js/views-config.js',
  'js/config.js',
  'js/ai.js',
  'vendor/vue.global.prod.js',
  'vendor/dexie.min.js',
  'vendor/exceljs.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chiavi) => Promise.all(chiavi.filter((k) => k.startsWith(PREFISSO) && k !== VERSIONE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
