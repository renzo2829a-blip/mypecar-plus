/* MYPECAR PLUS — aviso pequeño de "Novedades" (2026-11-25)
 * Cada vez que se publica una actualización, el cliente ve UNA vez un aviso pequeño con lo nuevo y el botón "Aceptar".
 * Para avisar de una actualización: editar novedades.json (subir "version" y cambiar la lista "items"). Nada más.
 * Recuerda lo ya visto con una cookie propia (mpn). No toca datos ni la sincronización. */
(function () {
  'use strict';
  if (window.__mypecarNovedades) return; window.__mypecarNovedades = true;
  function cookie(n) { var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
  function poner(n, v, dias) { document.cookie = n + '=' + encodeURIComponent(v) + '; max-age=' + (dias * 86400) + '; path=/; SameSite=Lax; Secure'; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hayOtroAviso() { return !!document.querySelector('#mps-login, .mps-overlay, [id^="mps-"][role="dialog"], #mpi-aviso'); }

  function mostrar(n) {
    if (document.getElementById('mpn-aviso')) return;
    var c = document.createElement('div'); c.id = 'mpn-aviso'; c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Novedades de MYPECAR');
    c.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147480400;width:calc(100% - 24px);max-width:340px;background:#fff;border:1px solid #a7f3d0;border-top:4px solid #0f8f7f;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.28);padding:14px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a';
    var lista = (n.items || []).slice(0, 5).map(function (t) { return '<li style="margin:4px 0">' + esc(t) + '</li>'; }).join('');
    c.innerHTML = '<div style="font-weight:800;font-size:15px;color:#065f46">🔔 ' + esc(n.titulo || 'MYPECAR se actualizó') + '</div>' +
      '<div style="font-size:12.5px;color:#475569;margin-top:3px">MYPECAR está en constante mejora. Esto es lo nuevo:</div>' +
      (lista ? '<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.4;color:#334155">' + lista + '</ul>' : '') +
      '<button type="button" id="mpn-ok" style="margin-top:12px;width:100%;background:#16a34a;color:#fff;border:0;border-radius:10px;padding:10px;font:800 14px system-ui;cursor:pointer">Aceptar</button>';
    document.body.appendChild(c);
    var b = document.getElementById('mpn-ok'); b.focus();
    b.onclick = function () { poner('mpn', n.version, 400); c.remove(); };
  }
  function revisar(intentos) {
    fetch('/novedades.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (n) {
      if (!n || !n.version || cookie('mpn') === String(n.version)) return;
      (function esperar(i) { if (hayOtroAviso() && i < 10) return setTimeout(function () { esperar(i + 1); }, 3000); mostrar(n); })(0);
    }).catch(function () {});
  }
  window.addEventListener('load', function () { setTimeout(revisar, 3500); });
  // Si la app queda abierta mucho rato y se publica algo nuevo, se vuelve a revisar al volver a la pestaña.
  var ultimo = Date.now();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && Date.now() - ultimo > 30 * 60 * 1000) { ultimo = Date.now(); revisar(); } });
})();
