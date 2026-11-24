/**
 * mypecar-primeros-pasos.js  (2026-11-24)
 * Guía de "Primeros pasos" para empresas nuevas, arriba del Panel General de un módulo.
 * Cada módulo define antes:  window.MYPECAR_PRIMEROS_PASOS = { app, titulo, pasos: [{ texto, ayuda, boton, hecho(), ir() }], final }
 * La guía desaparece sola cuando todos los pasos están hechos, o si el usuario pulsa "Ocultar guía".
 * No toca datos ni cálculos. Si este archivo falta, el módulo funciona igual.
 */
(function () {
  'use strict';
  function cfg() { return window.MYPECAR_PRIMEROS_PASOS; }
  function claveOculta() {
    var id = '';
    try { id = (window.MypecarSync && MypecarSync.empresas && MypecarSync.empresas.activaId()) || ''; } catch (e) {}
    return 'mps_guia_oculta_' + (cfg() ? cfg().app : 'x') + '_' + id;
  }
  function oculta() { try { return sessionStorage.getItem(claveOculta()) === '1' || window.__mpsGuiaOcultaMem === claveOculta(); } catch (e) { return false; } }
  function hecho(p) { try { return !!p.hecho(); } catch (e) { return false; } }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function pintar() {
    var c = cfg(); if (!c) return;
    var panel = document.getElementById('tab-dashboard'); if (!panel) return;
    var caja = document.getElementById('mps-primeros-pasos');
    var pasos = c.pasos || [];
    var hechos = pasos.filter(hecho).length;
    if (oculta() || !pasos.length || hechos === pasos.length) { if (caja) caja.remove(); return; }
    var firma = pasos.map(function (p) { return hecho(p) ? 1 : 0; }).join('');
    if (caja && caja.getAttribute('data-firma') === firma) return;
    if (!caja) { caja = document.createElement('div'); caja.id = 'mps-primeros-pasos'; panel.insertBefore(caja, panel.firstChild); }
    caja.setAttribute('data-firma', firma);
    caja.setAttribute('role', 'region'); caja.setAttribute('aria-label', 'Primeros pasos');
    caja.style.cssText = 'background:#fff;border:2px solid #a7f3d0;border-radius:16px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.05)';
    var siguiente = -1;
    for (var i = 0; i < pasos.length; i++) { if (!hecho(pasos[i])) { siguiente = i; break; } }
    var pct = Math.round(hechos / pasos.length * 100);
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
      '<div style="font-weight:800;color:#065f46;font-size:15px">👋 ' + esc(c.titulo || 'Primeros pasos') + '</div>' +
      '<button type="button" id="mps-guia-ocultar" style="font-size:11px;color:#64748b;text-decoration:underline;background:none;border:0;cursor:pointer">Ocultar por ahora</button></div>' +
      '<div style="font-size:12px;color:#475569;margin-bottom:10px">' + hechos + ' de ' + pasos.length + ' listos</div>' +
      '<div style="height:6px;background:#e2e8f0;border-radius:9px;margin-bottom:12px;overflow:hidden"><div style="height:6px;width:' + pct + '%;background:#10b981"></div></div>';
    pasos.forEach(function (p, idx) {
      var ok = hecho(p), esSig = idx === siguiente;
      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #f1f5f9">' +
        '<div style="flex:none;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;' +
        (ok ? 'background:#10b981;color:#fff">✓' : 'background:' + (esSig ? '#fef3c7;color:#92400e' : '#f1f5f9;color:#64748b') + '">' + (idx + 1)) + '</div>' +
        '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700;color:' + (ok ? '#94a3b8;text-decoration:line-through' : '#0f172a') + '">' + esc(p.texto) + '</div>' +
        (p.ayuda && !ok ? '<div style="font-size:11px;color:#64748b">' + esc(p.ayuda) + '</div>' : '') + '</div>' +
        (!ok ? '<button type="button" data-paso="' + idx + '" style="flex:none;font-size:12px;font-weight:700;border-radius:10px;padding:8px 12px;cursor:pointer;border:0;' +
          (esSig ? 'background:#059669;color:#fff' : 'background:#f1f5f9;color:#334155') + '">' + esc(p.boton || 'Ir') + '</button>' : '') + '</div>';
    });
    if (c.final) html += '<div style="font-size:11px;color:#64748b;margin-top:8px">💡 ' + esc(c.final) + ' <a href="ayuda.html" target="_blank" style="color:#047857;font-weight:700">Ver guía completa</a></div>';
    caja.innerHTML = html;
    caja.querySelectorAll('button[data-paso]').forEach(function (b) {
      b.addEventListener('click', function () { var p = pasos[+b.getAttribute('data-paso')]; try { p.ir(); } catch (e) {} setTimeout(pintar, 800); });
    });
    var oc = document.getElementById('mps-guia-ocultar');
    if (oc) oc.addEventListener('click', function () { try { sessionStorage.setItem(claveOculta(), '1'); } catch (e) {} window.__mpsGuiaOcultaMem = claveOculta(); pintar(); });
  }
  window.mypecarPintarPrimerosPasos = pintar;
  function iniciar() { setTimeout(pintar, 2500); setInterval(function () { if (document.visibilityState === 'visible') pintar(); }, 4000); }
  if (document.readyState === 'complete') iniciar(); else window.addEventListener('load', iniciar);
})();
