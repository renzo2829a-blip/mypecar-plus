// MYPECAR · Autocompletar datos por RUC (y DNI en clientes) — 2026-11-20
// Al escribir los 11 dígitos del RUC (o los 8 del DNI) se consulta la función "consulta-documento"
// de Supabase y se llenan solos la razón social y, en proveedores, el estado y la condición del
// domicilio. No se envía el RUC a ningún servicio de terceros distinto de ese. Se usa en
// 01 Ventas (Clientes) y 02 Compras (Proveedores). Si algo falla, se escribe a mano como siempre.
// (2026-11-24) Consulta de RUC/DNI: primero la función "ruc-dni" (exige sesión iniciada, valida el formato y limita el
// uso). Si todavía no está desplegada en el servidor (404), se usa "consulta-documento" como hasta ahora.
window.mypecarConsultarDocumento = async function (cliente, body) {
  const r = await cliente.functions.invoke('ruc-dni', { body });
  const status = r.error && r.error.context && r.error.context.status;
  const noExiste = r.error && (status === 404 || /not.?found|FunctionsFetchError/i.test(String(r.error.name || '') + String(r.error.message || '')));
  if (noExiste) return cliente.functions.invoke('consulta-documento', { body });
  return r;
};

(function () {
  'use strict';
  const CAMPOS = [
    { ruc: 'prov-ruc', razon: 'prov-razon-social', estado: 'prov-estado-tributario', condicion: 'prov-condicion-domicilio', dni: false },
    { ruc: 'cli-doc', razon: 'cli-razon-social', estado: null, condicion: null, dni: true }
  ];
  const cache = {};
  const temporizadores = {};

  function mensajeDe(cfg) {
    const inp = document.getElementById(cfg.ruc);
    if (!inp) return null;
    let p = document.getElementById('mps-ruc-msg-' + cfg.ruc);
    if (!p) {
      p = document.createElement('p');
      p.id = 'mps-ruc-msg-' + cfg.ruc;
      p.style.cssText = 'font-size:11px;font-weight:600;margin-top:4px;min-height:14px';
      const ref = inp.closest('div') && inp.closest('div').parentElement ? inp.closest('div').parentElement : inp.parentElement;
      ref.appendChild(p);
    }
    return p;
  }
  function decir(cfg, texto, tono) {
    const p = mensajeDe(cfg); if (!p) return;
    p.textContent = texto || '';
    p.style.color = tono === 'ok' ? '#047857' : tono === 'error' ? '#be123c' : tono === 'aviso' ? '#b45309' : '#475569';
  }
  function ponerValor(el, valor) {
    el.value = valor;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function elegirOpcion(sel, texto) {
    if (!sel || !texto) return;
    const t = String(texto).toUpperCase().replace(/\s+/g, ' ').trim();
    for (const o of sel.options) {
      const ot = o.text.toUpperCase().replace(/\s+/g, ' ').trim();
      if (ot === t || ot.startsWith(t) || t.startsWith(ot)) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return; }
    }
  }

  async function consultar(cfg, numero) {
    const inp = document.getElementById(cfg.ruc);
    if (!inp) return;
    const esRuc = numero.length === 11;
    if (esRuc && typeof validarDigitoVerificadorRuc === 'function' && !validarDigitoVerificadorRuc(numero)) {
      decir(cfg, 'El RUC no es válido (revisa que esté bien digitado).', 'error');
      return;
    }
    let res = cache[numero];
    if (!res) {
      const sync = window.MypecarSync;
      const cliente = sync && sync.obtenerClienteSupabase ? sync.obtenerClienteSupabase() : null;
      if (!cliente) { decir(cfg, 'Inicia sesión para completar los datos automáticamente.', 'aviso'); return; }
      decir(cfg, 'Buscando en SUNAT…', 'info');
      try {
        const empresaId = sync.empresas && sync.empresas.activaId ? sync.empresas.activaId() : null;
        const { data, error } = await window.mypecarConsultarDocumento(cliente, { tipo: esRuc ? 'ruc' : 'dni', numero, empresa_id: empresaId });
        res = data;
        if (error) { try { res = await error.context.json(); } catch (e) { res = null; } }
      } catch (e) { res = null; }
      const nombre = res && (res.nombre || res.razon_social || res.business_name || res.full_name);
      if (!nombre) {
        decir(cfg, (res && res.error) ? String(res.error) : 'No se pudo consultar ahora. Escribe los datos a mano.', 'error');
        return;
      }
      res.nombre = nombre;
      cache[numero] = res;
    }
    if (inp.value.replace(/\D/g, '') !== numero) return; // el usuario ya cambió el número
    const campo = document.getElementById(cfg.razon);
    if (campo) {
      if (campo.value.trim() === '' || campo.dataset.mpsAuto === '1') {
        ponerValor(campo, res.nombre);
        campo.dataset.mpsAuto = '1';
      } else if (campo.value.trim().toUpperCase() !== String(res.nombre).toUpperCase()) {
        decir(cfg, 'SUNAT dice: ' + res.nombre + ' (ya hay un nombre escrito; no se cambió).', 'aviso');
        return;
      }
    }
    if (esRuc) {
      elegirOpcion(cfg.estado && document.getElementById(cfg.estado), res.estado);
      elegirOpcion(cfg.condicion && document.getElementById(cfg.condicion), res.condicion);
    }
    decir(cfg, 'Datos completados desde SUNAT. Revísalos antes de guardar.', 'ok');
  }

  document.addEventListener('input', function (ev) {
    const t = ev.target;
    if (!t || !t.id) return;
    // Si la persona escribe la razón social a mano, deja de considerarse "autocompletada".
    const porRazon = CAMPOS.find(c => c.razon === t.id);
    if (porRazon && ev.isTrusted) delete t.dataset.mpsAuto;
    const cfg = CAMPOS.find(c => c.ruc === t.id);
    if (!cfg) return;
    clearTimeout(temporizadores[cfg.ruc]);
    const v = (t.value || '').replace(/\D/g, '');
    if (v.length === 11 || (cfg.dni && v.length === 8)) {
      temporizadores[cfg.ruc] = setTimeout(() => consultar(cfg, v).catch(() => {}), 400);
    } else {
      const p = document.getElementById('mps-ruc-msg-' + cfg.ruc); if (p) p.textContent = '';
    }
  }, true);
})();
