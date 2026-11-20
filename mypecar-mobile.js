/**
 * mypecar-mobile.js  (version 2026-11-13)
 * ---------------------------------------------------------------------------
 * Capa movil COMPARTIDA para las apps de MYPECAR PLUS.
 *
 * Que hace (solo en pantallas de 640 px o menos; en computadora NO cambia nada):
 *  - Evita que la pagina se ensanche mas que el celular (filas de botones que
 *    no bajaban de linea, cuadros con ancho fijo).
 *  - Convierte las pestañas en UNA sola fila deslizable y deja a la vista la
 *    pestaña activa (antes ocupaban unas 8 lineas de pantalla).
 *  - Campos de formulario a 16 px (el iPhone ya no hace zoom al tocarlos) y
 *    botones/listas con altura comoda para el dedo.
 *  - Tablas: se deslizan de lado dentro de su tarjeta, con una sombra que
 *    avisa que hay mas columnas.
 *
 * Como instalarlo: copiar este archivo junto a mypecar-sync.js y
 * mypecar-login.js (mismo nombre exacto) y agregar UNA linea en cada app,
 * debajo de la de mypecar-login.js:
 *     <script src="mypecar-mobile.js"></script>
 *
 * No toca datos, ni calculos, ni la sincronizacion. Si el archivo falta, la
 * app funciona igual que antes.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.__mypecarMobileLoaded) return;
  window.__mypecarMobileLoaded = true;

  var MQ = '(max-width: 640px)';

  var CSS = [
    '@media ' + MQ + ' {',

    /* 1. Nada debe ensanchar la pagina mas que la pantalla */
    '  html, body { max-width: 100% !important; overflow-x: hidden !important; }',
    '  .flex:has(> button):not(.mpm-tabs), .flex:has(> a.btn):not(.mpm-tabs), .flex:has(> label > input[type=file]):not(.mpm-tabs) { flex-wrap: wrap !important; }',
    '  .flex:has(> button) > button { max-width: 100%; }',
    '  img, canvas, svg { max-width: 100%; }',

    /* 2. Pestañas: una sola fila deslizable */
    '  .mpm-tabs { display: flex !important; flex-wrap: nowrap !important; overflow-x: auto !important;',
    '    -webkit-overflow-scrolling: touch; scrollbar-width: none; gap: 4px !important; padding-bottom: 6px !important; }',
    '  .mpm-tabs::-webkit-scrollbar { display: none; }',
    '  .mpm-tabs > * { flex: 0 0 auto !important; white-space: nowrap !important; }',

    /* 3. Formularios comodos para el dedo (16 px evita el zoom de iOS) */
    '  input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not(table *):not(header *),',
    '  select:not(table *):not(header *), textarea:not(table *) { font-size: 16px !important; min-height: 42px; }',
    '  button:not(table *):not(.mpm-tabs *):not(header *) { min-height: 40px; }',
    '  table button, table select, table input:not([type=checkbox]):not([type=radio]) { min-height: 32px; min-width: 32px; }',

    /* 4. Tablas: deslizar de lado con aviso visual */
    '  .mpm-scroll { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }',
    '  .mpm-scroll.mpm-r { box-shadow: inset -16px 0 12px -12px rgba(15,23,42,.35); }',
    '  .mpm-scroll.mpm-l { box-shadow: inset 16px 0 12px -12px rgba(15,23,42,.35); }',
    '  .mpm-scroll.mpm-l.mpm-r { box-shadow: inset 16px 0 12px -12px rgba(15,23,42,.35), inset -16px 0 12px -12px rgba(15,23,42,.35); }',

    /* 5. Aviso flotante de la nube: que no tape los botones de abajo */
    '  #mypecar-badge, .mypecar-badge { max-width: 70vw; }',
    '}'
  ].join('\n');

  function inject() {
    if (document.getElementById('mypecar-mobile-css')) return;
    var st = document.createElement('style');
    st.id = 'mypecar-mobile-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function marcarPestañas() {
    var btn = document.querySelector('[id^="btn-tab-"]');
    if (!btn) return;
    var bar = btn.parentElement;
    if (bar && !bar.classList.contains('mpm-tabs')) bar.classList.add('mpm-tabs');
  }

  function actualizarSombras(c) {
    var max = c.scrollWidth - c.clientWidth;
    c.classList.toggle('mpm-l', max > 2 && c.scrollLeft > 2);
    c.classList.toggle('mpm-r', max > 2 && c.scrollLeft < max - 2);
  }

  function marcarTablas() {
    var ts = document.querySelectorAll('table');
    for (var i = 0; i < ts.length; i++) {
      var p = ts[i].parentElement;
      if (!p || p === document.body) continue;
      if (!p.classList.contains('mpm-scroll')) {
        p.classList.add('mpm-scroll');
        p.addEventListener('scroll', (function (c) { return function () { actualizarSombras(c); }; })(p), { passive: true });
      }
      actualizarSombras(p);
    }
  }

  function centrarActiva() {
    if (!window.matchMedia(MQ).matches) return;
    var bar = document.querySelector('.mpm-tabs');
    if (!bar) return;
    var tabs = bar.querySelectorAll('[id^="btn-tab-"]');
    var activa = null;
    for (var i = 0; i < tabs.length; i++) {
      var c = tabs[i].className || '';
      if (/bg-white|bg-emerald-50|bg-violet-50|bg-indigo-50|bg-teal-50|active|text-(emerald|violet|purple|indigo|teal)-[67]00/.test(c) &&
          !/text-white/.test(c)) { activa = tabs[i]; break; }
    }
    if (activa) {
      var x = activa.offsetLeft - (bar.clientWidth - activa.offsetWidth) / 2;
      bar.scrollTo ? bar.scrollTo({ left: x, behavior: 'smooth' }) : (bar.scrollLeft = x);
    }
  }

  function init() {
    inject();
    marcarPestañas();
    marcarTablas();

    // Las tablas se dibujan con JavaScript: re-marcar cuando cambia el contenido.
    if (window.MutationObserver) {
      var pend = false;
      new MutationObserver(function () {
        if (pend) return; pend = true;
        setTimeout(function () { pend = false; marcarTablas(); }, 200);
      }).observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[id^="btn-tab-"]') : null;
      if (t) setTimeout(centrarActiva, 120);
    });
    setTimeout(centrarActiva, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Tailwind CDN agrega sus estilos tarde: reinyectar al final para quedar ultimos.
  window.addEventListener('load', function () {
    var viejo = document.getElementById('mypecar-mobile-css');
    if (viejo) { viejo.parentNode.removeChild(viejo); }
    inject();
  });
})();
