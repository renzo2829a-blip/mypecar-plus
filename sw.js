/* MYPECAR PLUS — service worker mínimo (2026-11-25).
 * Solo existe para que el navegador permita instalar la aplicación en la pantalla de inicio.
 * NO guarda nada en caché: siempre se muestra la versión más reciente publicada (así no se arrastran versiones viejas). */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return; // lo demás lo resuelve el navegador como siempre
  e.respondWith(fetch(e.request).catch(function () {
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title><body style="font-family:system-ui;text-align:center;padding:48px 20px;color:#0f172a"><h1 style="font-size:22px">Sin conexión</h1><p>MYPECAR PLUS necesita internet para abrir. Vuelve a intentarlo cuando tengas señal.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});
