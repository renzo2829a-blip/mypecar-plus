/* MYPECAR PLUS — invitación a instalar la aplicación en el celular (2026-11-25)
 * Aviso emergente para quien entra desde un celular o tablet: "ponla como ícono en tu pantalla de inicio".
 *  - Android/Chrome: botón "Instalar" (instalación real con un toque).
 *  - iPhone/iPad (Safari): pasos para "Añadir a pantalla de inicio" (Apple no permite instalar con un botón).
 * No molesta: se muestra a lo mucho 1 vez cada 3 días, "No mostrar más" lo apaga, y nunca sale si ya está instalada.
 * Solo usa una cookie propia (mpi) para recordar la elección. No toca datos ni la sincronización. */
(function () {
  'use strict';
  if (window.__mypecarInstalar) return; window.__mypecarInstalar = true;

  function cookie(n) { var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
  function poner(n, v, dias) { document.cookie = n + '=' + encodeURIComponent(v) + '; max-age=' + (dias * 86400) + '; path=/; SameSite=Lax; Secure'; }

  if (!document.querySelector('link[rel="apple-touch-icon"]')) { var a = document.createElement('link'); a.rel = 'apple-touch-icon'; a.href = '/img/apple-touch-icon.png'; document.head.appendChild(a); }
  // Manifiesto y service worker (necesarios para poder instalar)
  if (!document.querySelector('link[rel="manifest"]')) { var l = document.createElement('link'); l.rel = 'manifest'; l.href = '/manifest.webmanifest'; document.head.appendChild(l); }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) { try { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {}); } catch (e) {} }

  var ua = navigator.userAgent || '';
  var esIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var esSafariIOS = esIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  var esAndroid = /Android/i.test(ua);
  var esMovil = esIOS || esAndroid || (window.matchMedia && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 900);
  var instalada = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (!esMovil || instalada || cookie('mpi') === 'no' || cookie('mpi') === 'instalada') return;
  if (cookie('mpi') === 'luego') return; // pospuesta (la cookie caduca a los 3 días)

  var diferido = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); diferido = e; });
  window.addEventListener('appinstalled', function () { poner('mpi', 'instalada', 365); cerrar(); });

  function cerrar() { var c = document.getElementById('mpi-aviso'); if (c) c.remove(); }
  function hayOtroAviso() { return !!document.querySelector('#mps-login, .mps-overlay, [id^="mps-"][role="dialog"], #mpa-panel[style*="flex"]'); }

  function mostrar() {
    if (document.getElementById('mpi-aviso') || document.visibilityState !== 'visible') return;
    if (hayOtroAviso()) { setTimeout(mostrar, 4000); return; }
    var c = document.createElement('div'); c.id = 'mpi-aviso'; c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Instalar MYPECAR en tu celular');
    c.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147480500;background:rgba(2,16,14,.55);display:flex;align-items:flex-end;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    var pasos = esIOS
      ? (esSafariIOS
        ? '<ol style="margin:10px 0 0;padding-left:20px;font-size:15px;line-height:1.6;color:#334155"><li>Toca el botón <b>Compartir</b> <span aria-hidden="true" style="display:inline-block;border:1.5px solid #0f8f7f;border-radius:5px;padding:0 5px;font-size:13px">⬆︎</span> (abajo, en el centro).</li><li>Elige <b>«Añadir a pantalla de inicio»</b>.</li><li>Toca <b>Añadir</b>. ¡Listo!</li></ol>'
        : '<p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#334155">En iPhone solo se puede instalar desde <b>Safari</b>. Abre <b>mypecar.net.pe</b> en Safari y sigue los pasos que te mostraremos.</p>')
      : '<p id="mpi-ayuda" style="margin:10px 0 0;font-size:14px;line-height:1.5;color:#475569">Si el botón no aparece: abre el menú <b>⋮</b> del navegador y elige <b>«Instalar aplicación»</b> o <b>«Añadir a pantalla de inicio»</b>.</p>';
    c.innerHTML = '<div style="background:#fff;width:100%;max-width:460px;border-radius:22px 22px 0 0;padding:22px 20px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.35)">' +
      '<div style="display:flex;gap:14px;align-items:center"><img src="/img/icono-192.png" width="64" height="64" alt="" style="border-radius:16px;flex:none"><div><div style="font-weight:800;font-size:19px;color:#0f172a;line-height:1.2">Instala MYPECAR en tu celular</div><div style="font-size:14px;color:#475569;margin-top:3px">Ábrelo con un toque desde tu pantalla de inicio, sin buscar la página web.</div></div></div>' +
      pasos +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">' +
      (esIOS ? '' : '<button type="button" id="mpi-instalar" style="background:#16a34a;color:#fff;border:0;border-radius:14px;padding:14px;font:800 16px system-ui;cursor:pointer">Instalar ahora</button>') +
      '<button type="button" id="mpi-luego" style="background:#f1f5f9;color:#334155;border:0;border-radius:14px;padding:12px;font:700 15px system-ui;cursor:pointer">' + (esIOS ? 'Entendido' : 'Ahora no') + '</button>' +
      '<button type="button" id="mpi-nunca" style="background:none;border:0;color:#64748b;font:600 13px system-ui;text-decoration:underline;padding:6px;cursor:pointer">No volver a mostrar</button></div></div>';
    document.body.appendChild(c);
    var bi = document.getElementById('mpi-instalar');
    if (bi) bi.onclick = function () {
      if (diferido) { diferido.prompt(); diferido.userChoice.then(function (r) { poner('mpi', r && r.outcome === 'accepted' ? 'instalada' : 'luego', r && r.outcome === 'accepted' ? 365 : 3); diferido = null; cerrar(); }); }
      else { var a = document.getElementById('mpi-ayuda'); if (a) a.style.cssText += ';background:#fef3c7;padding:10px;border-radius:10px;color:#78350f'; }
    };
    document.getElementById('mpi-luego').onclick = function () { poner('mpi', 'luego', 3); cerrar(); };
    document.getElementById('mpi-nunca').onclick = function () { poner('mpi', 'no', 365); cerrar(); };
  }
  window.addEventListener('load', function () { setTimeout(mostrar, 7000); });
  window.MypecarInstalar = { mostrar: mostrar };
})();
