/**
 * mypecar-impuestos.js  (version 2026-11-25)
 * ---------------------------------------------------------------------------
 * Modulo COMPARTIDO por 04 Libro Diario (Gestion > Impuestos) y 07 Reportes (Impuestos).
 *
 * Que resuelve:
 *  1. Control de impuestos DETERMINADOS y PAGADOS por periodo (IGV, Renta, EsSalud,
 *     ONP y AFP), con saldo pendiente, fecha de vencimiento y estado.
 *  2. "Que impuestos hay que pagar el proximo mes" (y los que ya vencieron).
 *  3. Envio por correo / WhatsApp, PDF, Excel e Impresion de cualquier reporte de
 *     impuestos con un mismo formato.
 *
 * Como funciona el calculo (todo sale del Libro Diario, no se digita nada aparte):
 *  - DETERMINADO de un mes = lo que ese mes genera como deuda en las cuentas 40
 *    (IGV 4011x, Renta 401x, EsSalud 4031, ONP 4032, AFP 407), sin contar los
 *    asientos de pago. El IGV arrastra el credito fiscal cuando el mes sale a favor.
 *    El pago a cuenta de Renta (ventas netas x tasa) y la cuota del Nuevo RUS se
 *    suman a la Renta porque no tienen asiento propio.
 *  - PAGADO = asientos donde sale plata de Caja/Bancos (cuenta 10, Haber) y se
 *    carga (Debe) la cuenta del tributo. Cada pago cancela primero la deuda mas
 *    antigua, pero solo de meses ANTERIORES al mes en que se registro el pago
 *    (el tributo de un mes se paga al mes siguiente). Lo que no se pueda asignar
 *    se informa aparte como "pagos sin asignar".
 *
 * No toca datos ni sincronizacion: solo lee lo que la app le entrega.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  if (root.MypecarImpuestos) return;

  var VERSION = '2026-11-25';
  var RESPONSABLE = 'CARLOS FLORES FIGUEROA';
  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  var AUTOTABLE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';

  var ORDEN = ['igv', 'renta', 'essalud', 'onp', 'afp'];
  var NOMBRE = {
    igv: 'IGV',
    renta: 'Impuesto a la Renta (pago a cuenta y retenciones)',
    essalud: 'EsSalud',
    onp: 'ONP',
    afp: 'AFP'
  };
  var CORTO = { igv: 'IGV', renta: 'Renta', essalud: 'EsSalud', onp: 'ONP', afp: 'AFP' };
  var DECLARA = { igv: 'PDT 621', renta: 'PDT 621 / PLAME', essalud: 'PLAME', onp: 'PLAME', afp: 'AFPnet' };
  var MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var MESES_AB = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  var ETIQUETA_ESTADO = { cancelado: 'Cancelado', parcial: 'Pago parcial', pendiente: 'Pendiente', vencido: 'Vencido', sin: 'Sin deuda' };

  // ------------------------------------------------------------------
  // Utilidades de fecha y formato (siempre hora local, nunca UTC)
  // ------------------------------------------------------------------
  function p2(n) { return String(n).length < 2 ? '0' + n : String(n); }
  function iso(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function periodoMas(p, n) { var a = p.split('-'); var d = new Date(+a[0], +a[1] - 1 + n, 1); return d.getFullYear() + '-' + p2(d.getMonth() + 1); }
  function etiquetaPeriodo(p) { var a = String(p).split('-'); return (MESES[+a[1]] || a[1]) + ' ' + a[0]; }
  function etiquetaCorta(p) { var a = String(p).split('-'); return (MESES_AB[+a[1]] || a[1]) + ' ' + a[0]; }
  function dma(f) { if (!f) return '—'; var a = String(f).slice(0, 10).split('-'); return a.length === 3 ? a[2] + '/' + a[1] + '/' + a[0] : String(f); }
  function fechaLarga(f) {
    if (!f) return '—';
    var a = String(f).slice(0, 10).split('-');
    return (+a[2]) + ' de ' + (MESES[+a[1]] || '').toLowerCase() + ' de ' + a[0];
  }
  function r2(n) { return Math.round(((Number(n) || 0) + 1e-9) * 100) / 100; }
  function num(n) {
    var v = r2(n); if (Math.abs(v) < 0.005) v = 0;
    return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function mon(n) { var v = Number(n) || 0; return (v < -0.004 ? '-' : '') + 'S/ ' + num(Math.abs(v)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function sinTildes(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function nombreSeguro(s) { return sinTildes(s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, ''); }

  // Quinto dia habil (lunes a viernes) del mes dado. No descuenta feriados.
  function quintoDiaHabil(ym) {
    var a = ym.split('-'); var d = new Date(+a[0], +a[1] - 1, 1); var c = 0;
    for (var i = 0; i < 40; i++) {
      var w = d.getDay();
      if (w !== 0 && w !== 6) { c++; if (c === 5) break; }
      d.setDate(d.getDate() + 1);
    }
    return iso(d);
  }

  // ------------------------------------------------------------------
  // Cuentas del plan contable que forman cada tributo
  // ------------------------------------------------------------------
  function clasificar(cuenta) {
    var c = String(cuenta || '');
    if (c.indexOf('4011') === 0) return { t: 'igv', pasivo: c.indexOf('40112') !== 0, credito: c.indexOf('40112') === 0 };
    if (c === '403' || c.indexOf('4031') === 0) return { t: 'essalud', pasivo: true };
    if (c === '401' || c.indexOf('4032') === 0) return { t: 'onp', pasivo: true };
    if (c.indexOf('407') === 0) return { t: 'afp', pasivo: true };
    if (c.indexOf('401') === 0) return { t: 'renta', pasivo: true };
    return null;
  }

  // ------------------------------------------------------------------
  // MOTOR: arma el control de determinado / pagado
  //   op.periodsData : { 'YYYY-MM': { asientos: [ { fecha, numero, glosa, lineas:[{cuenta,debe,haber}] } ] } }
  //   op.cfg         : { regimenTributario, tasaRentaMensual, categoriaNRUS, ruc, ... }
  //   op.ventasNetas : function (periodo) -> ventas netas sin IGV del periodo
  //   op.vence       : function (periodo, clave) -> { fecha:'YYYY-MM-DD', fuente } (opcional)
  //   op.hoy         : Date (opcional, para pruebas)
  // ------------------------------------------------------------------
  function construir(op) {
    op = op || {};
    var pd = op.periodsData || {};
    var cfg = op.cfg || {};
    var hoy = op.hoy ? new Date(op.hoy) : new Date();
    var hoyISO = iso(hoy);
    var regimen = cfg.regimenTributario || 'rmt';
    var keys = Object.keys(pd).filter(function (k) { return /^\d{4}-\d{2}$/.test(k); }).sort();

    var dev = {}, pagos = {}, igvDeb = {}, igvCred = {};
    ORDEN.forEach(function (t) { dev[t] = {}; pagos[t] = []; });

    keys.forEach(function (k) {
      (pd[k].asientos || []).forEach(function (a) {
        var lineas = a.lineas || [];
        var fecha = String(a.fecha || '').slice(0, 10) || (k + '-01');
        var salePlata = lineas.some(function (l) { return /^10/.test(String(l.cuenta || '')) && (+l.haber || 0) > 0.004; });
        var igvLineas = lineas.filter(function (l) { var c = clasificar(l.cuenta); return c && c.t === 'igv'; });
        // Liquidacion de IGV: Debe 40111 (debito) contra Haber 40112 (credito) y Haber Bancos (neto pagado).
        var liquidacion = salePlata && igvLineas.some(function (l) {
          var c = clasificar(l.cuenta); return c.pasivo && (+l.debe || 0) > (+l.haber || 0) + 0.004;
        });
        if (liquidacion) {
          var neto = igvLineas.reduce(function (s, l) { return s + (+l.debe || 0) - (+l.haber || 0); }, 0);
          if (neto > 0.004) pagos.igv.push({ k: k, fecha: fecha, numero: a.numero, glosa: a.glosa || '', monto: neto });
        }
        lineas.forEach(function (l) {
          var cl = clasificar(l.cuenta); if (!cl) return;
          if (cl.t === 'igv' && liquidacion) return;
          var d = +l.debe || 0, h = +l.haber || 0;
          if (salePlata && cl.pasivo && d > h + 0.004) {
            pagos[cl.t].push({ k: k, fecha: fecha, numero: a.numero, glosa: a.glosa || '', monto: d - h });
          } else {
            dev[cl.t][k] = (dev[cl.t][k] || 0) + (h - d);
            if (cl.t === 'igv') {
              if (cl.credito) igvCred[k] = (igvCred[k] || 0) + (d - h);
              else igvDeb[k] = (igvDeb[k] || 0) + (h - d);
            }
          }
        });
      });
    });

    // ---- Determinado por periodo (con arrastre cuando el mes sale a favor) ----
    var det = {}, favor = {}, ledger = {}, rentaCalc = {}, cuotaNRUS = {};
    ORDEN.forEach(function (t) {
      det[t] = {}; favor[t] = {}; ledger[t] = {};
      var carry = 0;
      keys.forEach(function (k) {
        var n = (t === 'igv' && regimen === 'nrus') ? 0 : (dev[t][k] || 0) - carry;
        var d = 0;
        if (n > 0.004) { d = n; carry = 0; } else { carry = Math.max(0, -n); }
        ledger[t][k] = d;
        favor[t][k] = carry;
        det[t][k] = d;
      });
    });
    keys.forEach(function (k) {
      var tieneAsientos = (pd[k].asientos || []).length > 0;
      var calc = 0, cuota = 0;
      if (regimen === 'nrus') { if (tieneAsientos) cuota = cfg.categoriaNRUS === '2' ? 50 : 20; }
      else if (typeof op.ventasNetas === 'function') { calc = (Number(op.ventasNetas(k)) || 0) * ((Number(cfg.tasaRentaMensual) || 0) / 100); }
      if (calc < 0) calc = 0;
      rentaCalc[k] = calc; cuotaNRUS[k] = cuota;
      det.renta[k] = (det.renta[k] || 0) + calc + cuota;
    });

    // ---- Vencimientos ----
    function venceDe(periodo, t) {
      if (t === 'afp') return { fecha: quintoDiaHabil(periodoMas(periodo, 1)), fuente: '5.° día hábil' };
      var v = null;
      try { if (typeof op.vence === 'function') v = op.vence(periodo, t); } catch (e) { v = null; }
      if (v && v.fecha) return { fecha: String(v.fecha).slice(0, 10), fuente: v.fuente || 'SUNAT' };
      return { fecha: periodoMas(periodo, 1) + '-18', fuente: 'estimado' };
    }

    // ---- Filas por tributo y asignacion de pagos (el pago cancela lo mas antiguo) ----
    var filas = {}, sinAplicar = {};
    ORDEN.forEach(function (t) {
      var rows = keys.map(function (k) {
        var v = venceDe(k, t);
        return { periodo: k, clave: t, det: det[t][k] || 0, pag: 0, pend: 0, vence: v.fecha, fuente: v.fuente, estado: 'sin', pagos: [], enCurso: k >= hoyISO.slice(0, 7) };
      });
      var lista = [];
      var lp = pagos[t].slice().sort(function (a, b) {
        return a.k < b.k ? -1 : a.k > b.k ? 1 : a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.numero || 0) - (b.numero || 0);
      });
      lp.forEach(function (p) {
        var resto = p.monto;
        for (var i = 0; i < rows.length && resto > 0.004; i++) {
          var r = rows[i];
          if (r.periodo >= p.k) break;
          var libre = r.det - r.pag; if (libre <= 0.004) continue;
          var x = Math.min(libre, resto);
          r.pag += x; resto -= x;
          r.pagos.push({ fecha: p.fecha, numero: p.numero, monto: x });
        }
        if (resto > 0.004) lista.push({ k: p.k, fecha: p.fecha, numero: p.numero, glosa: p.glosa, monto: resto });
      });
      rows.forEach(function (r) {
        r.pend = Math.max(0, r.det - r.pag);
        if (r.det <= 0.004) r.estado = 'sin';
        else if (r.pend <= 0.005) { r.estado = 'cancelado'; r.pend = 0; }
        else if (r.vence && r.vence < hoyISO) r.estado = 'vencido';
        else r.estado = r.pag > 0.004 ? 'parcial' : 'pendiente';
      });
      filas[t] = rows;
      sinAplicar[t] = lista;
    });

    // ------------------------------------------------------------------
    // API del modelo
    // ------------------------------------------------------------------
    var M = {
      keys: keys, hoyISO: hoyISO, regimen: regimen, filas: filas, sinAplicar: sinAplicar,
      periodos: function () { return keys.slice(); },
      anios: function () { var s = {}; keys.forEach(function (k) { s[k.slice(0, 4)] = 1; }); return Object.keys(s).sort(); },

      fila: function (t, periodo) {
        var arr = filas[t] || [];
        for (var i = 0; i < arr.length; i++) if (arr[i].periodo === periodo) return arr[i];
        return null;
      },

      // Detalle de un periodo (lo que muestran las tablas de 04 y de 07)
      periodo: function (p) {
        var f = function (t) { return M.fila(t, p) || { det: 0, pag: 0, pend: 0, vence: null, fuente: '', estado: 'sin', pagos: [] }; };
        var igvD = igvDeb[p] || 0, igvC = igvCred[p] || 0;
        var igvDet = f('igv').det;
        return {
          periodo: p, regimen: regimen,
          igvDebito: igvD, igvCredito: igvC,
          igv: igvDet, saldoFavorIgv: favor.igv[p] || 0,
          rentaMensual: rentaCalc[p] || 0, cuotaNRUS: cuotaNRUS[p] || 0,
          renta4ta5ta: ledger.renta[p] || 0,
          essalud: f('essalud').det, onp: f('onp').det, afp: f('afp').det,
          totalPDT621: igvDet + (rentaCalc[p] || 0) + (cuotaNRUS[p] || 0),
          totalPLAME: f('essalud').det + f('onp').det + f('afp').det + (ledger.renta[p] || 0),
          control: ORDEN.map(function (t) { var r = f(t); return { clave: t, nombre: NOMBRE[t], r: r }; }),
          totDet: ORDEN.reduce(function (s, t) { return s + f(t).det; }, 0),
          totPag: ORDEN.reduce(function (s, t) { return s + f(t).pag; }, 0),
          totPend: ORDEN.reduce(function (s, t) { return s + f(t).pend; }, 0)
        };
      },

      // Resumen por tributo de un anio (o de todo) — determinado, pagado y saldo
      resumen: function (t, anio) {
        var arr = (filas[t] || []).filter(function (r) { return !anio || r.periodo.slice(0, 4) === String(anio); });
        return {
          filas: arr,
          det: arr.reduce(function (s, r) { return s + r.det; }, 0),
          pag: arr.reduce(function (s, r) { return s + r.pag; }, 0),
          pend: arr.reduce(function (s, r) { return s + r.pend; }, 0)
        };
      },

      // Que hay que pagar en el mes `mes` ('YYYY-MM') y que ya esta vencido
      proximos: function (mes) {
        var enMes = [], vencidos = [];
        ORDEN.forEach(function (t) {
          (filas[t] || []).forEach(function (r) {
            if (r.pend <= 0.005 || !r.vence) return;
            var it = { clave: t, nombre: CORTO[t], declara: DECLARA[t], periodo: r.periodo, vence: r.vence, fuente: r.fuente, det: r.det, pag: r.pag, pend: r.pend, enCurso: r.enCurso };
            if (r.vence.slice(0, 7) === mes) enMes.push(it);
            else if (r.vence < mes + '-01') vencidos.push(it);
          });
        });
        var cmp = function (a, b) { return a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : ORDEN.indexOf(a.clave) - ORDEN.indexOf(b.clave); };
        enMes.sort(cmp); vencidos.sort(cmp);
        var periodoOrigen = periodoMas(mes, -1);
        return {
          mes: mes, enMes: enMes, vencidos: vencidos,
          totalEnMes: enMes.reduce(function (s, x) { return s + x.pend; }, 0),
          totalVencidos: vencidos.reduce(function (s, x) { return s + x.pend; }, 0),
          periodoOrigen: periodoOrigen, sinDatosPeriodo: keys.indexOf(periodoOrigen) < 0,
          mesAbierto: periodoOrigen >= hoyISO.slice(0, 7)
        };
      }
    };
    return M;
  }

  // El mes siguiente al de hoy ('YYYY-MM')
  function mesSiguiente(hoy) { var d = hoy ? new Date(hoy) : new Date(); return periodoMas(d.getFullYear() + '-' + p2(d.getMonth() + 1), 1); }

  // ------------------------------------------------------------------
  // DOCUMENTOS: un mismo "doc" alimenta pantalla de impresion, PDF, Excel y mensajes
  //   doc = { titulo, subtitulo, empresa, ruc, secciones:[{ titulo, cabeceras:[], filas:[[...]],
  //           alinear:['l','r',...], totales:[indices de fila], nota }], notas:[], responsable, archivo }
  // Las celdas pueden ser texto o numero (los numeros salen como moneda).
  // ------------------------------------------------------------------
  function celda(v) { return typeof v === 'number' ? num(v) : String(v == null ? '' : v); }

  function docHtml(doc) {
    var h = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(doc.titulo) + '</title><style>' +
      '@page{size:A4 ' + (doc.horizontal ? 'landscape' : 'portrait') + ';margin:12mm 10mm}' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;font-size:11px;margin:0}' +
      '.cab{background:#9f1239;color:#fff;padding:10px 14px;border-radius:6px;margin-bottom:10px}' +
      '.cab small{color:#fecdd3;font-size:9px;text-transform:uppercase;letter-spacing:.04em}' +
      '.cab h1{font-size:16px;margin:2px 0}.cab p{margin:0;font-size:10px;color:#fecdd3}' +
      'h2{font-size:12px;margin:12px 0 4px;color:#9f1239;text-transform:uppercase}' +
      'table{width:100%;border-collapse:collapse;margin-bottom:6px}' +
      'th{background:#f1f5f9;color:#475569;font-size:9px;text-transform:uppercase;text-align:left;padding:4px 5px;border:1px solid #cbd5e1}' +
      'td{padding:3.5px 5px;border:1px solid #e2e8f0;font-size:10.5px}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}td.c,th.c{text-align:center}' +
      'tr.tot td{background:#fee2e2;font-weight:bold}.nota{font-size:9px;color:#64748b;margin:3px 0}' +
      '.firma{margin-top:26px;font-size:10px}.firma b{display:block;border-top:1px solid #64748b;width:240px;padding-top:4px}' +
      'tr{page-break-inside:avoid}</style></head><body>' +
      '<div class="cab"><small>' + esc(doc.titulo) + '</small><h1>' + esc(doc.empresa || '') + '</h1><p>' + esc(doc.subtitulo || '') + '</p></div>';
    (doc.secciones || []).forEach(function (s) {
      if (s.titulo) h += '<h2>' + esc(s.titulo) + '</h2>';
      if (s.filas && s.filas.length) {
        h += '<table><thead><tr>' + s.cabeceras.map(function (c, i) {
          return '<th class="' + ((s.alinear || [])[i] === 'r' ? 'r' : (s.alinear || [])[i] === 'c' ? 'c' : '') + '">' + esc(c) + '</th>';
        }).join('') + '</tr></thead><tbody>';
        s.filas.forEach(function (f, ri) {
          h += '<tr' + ((s.totales || []).indexOf(ri) >= 0 ? ' class="tot"' : '') + '>' + f.map(function (v, i) {
            return '<td class="' + ((s.alinear || [])[i] === 'r' ? 'r' : (s.alinear || [])[i] === 'c' ? 'c' : '') + '">' + esc(celda(v)) + '</td>';
          }).join('') + '</tr>';
        });
        h += '</tbody></table>';
      } else if (s.vacio) { h += '<p class="nota">' + esc(s.vacio) + '</p>'; }
      if (s.nota) h += '<p class="nota">' + esc(s.nota) + '</p>';
    });
    (doc.notas || []).forEach(function (n) { h += '<p class="nota">' + esc(n) + '</p>'; });
    h += '<div class="firma"><b>' + esc(doc.responsable || RESPONSABLE) + '</b>Auditor / consultor responsable</div></body></html>';
    return h;
  }

  function imprimir(doc) {
    try {
      var f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(f);
      var d = f.contentWindow.document; d.open(); d.write(docHtml(doc)); d.close();
      setTimeout(function () {
        try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { aviso('No se pudo abrir la impresión: ' + e.message, 'error'); }
        setTimeout(function () { try { document.body.removeChild(f); } catch (e) {} }, 60000);
      }, 250);
    } catch (e) { aviso('No se pudo preparar la impresión: ' + (e.message || e), 'error'); }
  }

  // ---- PDF real (A4) ----
  function cargarScript(url) {
    return new Promise(function (ok, fail) {
      var s = document.createElement('script'); s.src = url; s.async = true;
      s.onload = function () { ok(); }; s.onerror = function () { fail(new Error('No se pudo cargar ' + url)); };
      document.head.appendChild(s);
    });
  }
  async function asegurarJsPdf() {
    if (!(root.jspdf && root.jspdf.jsPDF)) await cargarScript(JSPDF_URL);
    var probe = new root.jspdf.jsPDF();
    if (typeof probe.autoTable !== 'function') await cargarScript(AUTOTABLE_URL);
    return root.jspdf.jsPDF;
  }
  // La tipografia estandar del PDF es Latin-1: se cambian los simbolos que no existen en ella.
  function limpiarPdf(s) {
    return String(s == null ? '' : s).replace(/[→⇒]/g, '->').replace(/[✓✔]/g, 'OK').replace(/−/g, '-').replace(/≈/g, '~')
      .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xFF]/g, '');
  }
  async function generarPdf(doc) {
    var JsPDF = await asegurarJsPdf();
    var horizontal = !!doc.horizontal;
    var d = new JsPDF({ unit: 'mm', format: 'a4', orientation: horizontal ? 'landscape' : 'portrait' });
    var W = horizontal ? 297 : 210, M = 12, ANCHO = W - 2 * M, y;
    var L = limpiarPdf;
    d.setFillColor(159, 18, 57); d.rect(0, 0, W, 30, 'F');
    d.setTextColor(254, 205, 211); d.setFont('helvetica', 'normal'); d.setFontSize(8);
    d.text(L(String(doc.titulo || '').toUpperCase()), M, 9);
    d.setTextColor(255, 255, 255); d.setFont('helvetica', 'bold'); d.setFontSize(14);
    d.text(d.splitTextToSize(L(doc.empresa || ''), ANCHO).slice(0, 1), M, 17);
    d.setFont('helvetica', 'normal'); d.setFontSize(8.5); d.setTextColor(254, 205, 211);
    d.text(d.splitTextToSize(L(doc.subtitulo || ''), ANCHO).slice(0, 2), M, 24);
    y = 37;
    (doc.secciones || []).forEach(function (s) {
      if (y > (horizontal ? 175 : 255)) { d.addPage(); y = 16; }
      if (s.titulo) {
        d.setTextColor(159, 18, 57); d.setFont('helvetica', 'bold'); d.setFontSize(9.5);
        d.text(L(s.titulo), M, y); y += 2.5;
      }
      if (s.filas && s.filas.length) {
        var col = {};
        (s.alinear || []).forEach(function (a, i) { col[i] = { halign: a === 'r' ? 'right' : a === 'c' ? 'center' : 'left' }; });
        d.autoTable({
          startY: y, margin: { left: M, right: M, top: 16, bottom: 18 }, theme: 'grid', tableWidth: ANCHO,
          head: [s.cabeceras.map(L)],
          body: s.filas.map(function (f) { return f.map(function (v) { return L(celda(v)); }); }),
          styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak', lineColor: [203, 213, 225], textColor: [51, 65, 85] },
          headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7.5 },
          columnStyles: col,
          didParseCell: function (data) {
            if (data.section === 'body' && (s.totales || []).indexOf(data.row.index) >= 0) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [254, 226, 226]; }
            if (data.section === 'head' && col[data.column.index]) data.cell.styles.halign = col[data.column.index].halign;
          },
          rowPageBreak: 'avoid'
        });
        y = d.lastAutoTable.finalY + 4;
      } else if (s.vacio) {
        d.setFont('helvetica', 'italic'); d.setFontSize(8.5); d.setTextColor(100, 116, 139);
        d.text(L(s.vacio), M, y + 3); y += 8;
      }
      if (s.nota) {
        d.setFont('helvetica', 'italic'); d.setFontSize(7.5); d.setTextColor(100, 116, 139);
        var nl = d.splitTextToSize(L(s.nota), ANCHO); d.text(nl, M, y + 2); y += nl.length * 3.4 + 4;
      }
      y += 3;
    });
    d.setFont('helvetica', 'italic'); d.setFontSize(7.5); d.setTextColor(100, 116, 139);
    (doc.notas || []).forEach(function (n) {
      if (y > (horizontal ? 185 : 270)) { d.addPage(); y = 16; }
      var nl = d.splitTextToSize(L(n), ANCHO); d.text(nl, M, y); y += nl.length * 3.3 + 2;
    });
    if (y > (horizontal ? 170 : 255)) { d.addPage(); y = 24; } else { y += 8; }
    d.setDrawColor(100, 116, 139); d.line(M, y + 8, M + 70, y + 8);
    d.setFont('helvetica', 'bold'); d.setFontSize(9); d.setTextColor(30, 41, 59);
    d.text(L(doc.responsable || RESPONSABLE), M, y + 13);
    d.setFont('helvetica', 'normal'); d.setFontSize(8); d.setTextColor(100, 116, 139);
    d.text('Auditor / consultor responsable', M, y + 17.5);
    var n = d.getNumberOfPages(), alto = horizontal ? 210 : 297;
    for (var p = 1; p <= n; p++) {
      d.setPage(p);
      d.setDrawColor(226, 232, 240); d.line(M, alto - 12, W - M, alto - 12);
      d.setFont('helvetica', 'normal'); d.setFontSize(7); d.setTextColor(100, 116, 139);
      d.text(L('MYPECAR PLUS - ' + (doc.titulo || '') + ' - ' + (doc.empresa || '')), M, alto - 8);
      d.text('Página ' + p + ' de ' + n, W - M, alto - 8, { align: 'right' });
    }
    return { doc: d, blob: d.output('blob'), nombre: (doc.archivo || 'Impuestos') + '.pdf' };
  }

  // ---- Excel (A4, ajustado al ancho) ----
  async function generarExcel(doc) {
    if (typeof ExcelJS === 'undefined') throw new Error('No se cargó la librería de Excel (se requiere internet).');
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Impuestos');
    var maxCols = 1;
    (doc.secciones || []).forEach(function (s) { if (s.cabeceras) maxCols = Math.max(maxCols, s.cabeceras.length); });
    ws.columns = Array.apply(null, Array(maxCols)).map(function (_, i) { return { width: i === 0 ? 34 : 16 }; });
    var fila = 1;
    ws.mergeCells(fila, 1, fila, maxCols);
    ws.getCell(fila, 1).value = String(doc.titulo || '').toUpperCase() + ' - ' + String(doc.empresa || '').toUpperCase();
    ws.getCell(fila, 1).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    ws.getCell(fila, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9F1239' } };
    ws.getRow(fila).height = 24; fila++;
    ws.mergeCells(fila, 1, fila, maxCols);
    ws.getCell(fila, 1).value = doc.subtitulo || '';
    ws.getCell(fila, 1).font = { italic: true, size: 9, color: { argb: 'FF64748B' } }; fila += 2;
    (doc.secciones || []).forEach(function (s) {
      if (s.titulo) {
        ws.mergeCells(fila, 1, fila, maxCols);
        ws.getCell(fila, 1).value = s.titulo;
        ws.getCell(fila, 1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getCell(fila, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } }; fila++;
      }
      if (s.filas && s.filas.length) {
        ws.getRow(fila).values = s.cabeceras; ws.getRow(fila).font = { bold: true };
        for (var c = 1; c <= s.cabeceras.length; c++) {
          ws.getCell(fila, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          if ((s.alinear || [])[c - 1] === 'r') ws.getCell(fila, c).alignment = { horizontal: 'right' };
        }
        fila++;
        s.filas.forEach(function (f, ri) {
          ws.getRow(fila).values = f;
          f.forEach(function (v, ci) { if (typeof v === 'number') ws.getCell(fila, ci + 1).numFmt = '#,##0.00'; });
          if ((s.totales || []).indexOf(ri) >= 0) {
            ws.getRow(fila).font = { bold: true };
            ws.getRow(fila).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          }
          fila++;
        });
      } else if (s.vacio) { ws.getCell(fila, 1).value = s.vacio; ws.getCell(fila, 1).font = { italic: true, color: { argb: 'FF64748B' } }; fila++; }
      if (s.nota) { ws.mergeCells(fila, 1, fila, maxCols); ws.getCell(fila, 1).value = s.nota; ws.getCell(fila, 1).font = { italic: true, size: 8, color: { argb: 'FF64748B' } }; ws.getCell(fila, 1).alignment = { wrapText: true }; ws.getRow(fila).height = 26; fila++; }
      fila++;
    });
    (doc.notas || []).forEach(function (n) {
      ws.mergeCells(fila, 1, fila, maxCols); ws.getCell(fila, 1).value = n;
      ws.getCell(fila, 1).font = { italic: true, size: 8, color: { argb: 'FF94A3B8' } }; ws.getCell(fila, 1).alignment = { wrapText: true }; ws.getRow(fila).height = 24; fila++;
    });
    fila++;
    ws.getCell(fila, 1).value = 'Auditor / consultor responsable: ' + (doc.responsable || RESPONSABLE);
    ws.getCell(fila, 1).font = { bold: true };
    ws.pageSetup = { paperSize: 9, orientation: maxCols > 8 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    ws.headerFooter = { oddFooter: '&L&8MYPECAR PLUS - ' + String(doc.titulo || '').replace(/&/g, '') + '&C&8Página &P de &N&R&8&D' };
    var buf = await wb.xlsx.writeBuffer();
    return { blob: new Blob([buf], { type: 'application/octet-stream' }), nombre: (doc.archivo || 'Impuestos') + '.xlsx' };
  }

  // ---- Descargar / enviar ----
  function aviso(msg, tipo) {
    try { if (typeof root.showToast === 'function') { root.showToast(msg, tipo || 'success'); return; } } catch (e) {}
    try { console.log('[MypecarImpuestos]', msg); } catch (e) {}
  }
  function descargarBlob(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  async function descargarPdf(doc) {
    try { aviso('Preparando el PDF...'); var r = await generarPdf(doc); descargarBlob(r.blob, r.nombre); aviso('PDF listo: ' + r.nombre); }
    catch (e) { console.error(e); aviso('No se pudo armar el PDF (' + (e.message || e) + '). Se abre la impresión normal.', 'error'); imprimir(doc); }
  }
  async function descargarExcel(doc) {
    try { var r = await generarExcel(doc); descargarBlob(r.blob, r.nombre); aviso('Excel exportado: ' + r.nombre); }
    catch (e) { console.error(e); aviso('No se pudo exportar a Excel: ' + (e.message || e), 'error'); }
  }

  var CSS_MODAL = '#mpi-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,Arial,sans-serif}' +
    '#mpi-modal .mpi-card{background:#fff;border-radius:16px;max-width:420px;width:100%;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.35)}' +
    '#mpi-modal h3{margin:0 0 6px;font-size:16px;color:#0f172a}#mpi-modal p{margin:0 0 10px;font-size:13px;color:#475569}' +
    '#mpi-modal label{display:block;font-size:12px;font-weight:700;color:#334155;margin:6px 0 3px}' +
    '#mpi-modal input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:9px;font-size:14px}' +
    '#mpi-modal .mpi-fila{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}' +
    '#mpi-modal button{border:0;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer}';
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { return ''; } }
  function pedirDestino(canal) {
    return new Promise(function (resolve) {
      var prev = document.getElementById('mpi-modal'); if (prev) prev.remove();
      if (!document.getElementById('mpi-css')) { var st = document.createElement('style'); st.id = 'mpi-css'; st.textContent = CSS_MODAL; document.head.appendChild(st); }
      var esWa = canal === 'whatsapp';
      var m = document.createElement('div'); m.id = 'mpi-modal';
      m.innerHTML = '<div class="mpi-card"><h3>' + (esWa ? 'Enviar por WhatsApp' : 'Enviar por correo') + '</h3>' +
        '<p>Se arma el PDF del reporte. En el celular se abre el menú de compartir con el archivo adjunto. En la computadora se descarga el PDF y se abre ' + (esWa ? 'WhatsApp' : 'tu correo') + ' con el mensaje ya escrito; solo adjuntas el archivo.</p>' +
        (esWa ? '<label>Celular (opcional)</label><input id="mpi-dest" inputmode="tel" placeholder="999999999">'
              : '<label>Correo del destinatario (opcional)</label><input id="mpi-dest" type="email" inputmode="email" placeholder="cliente@empresa.com">') +
        '<p style="margin-top:8px;font-size:12px">Déjalo en blanco para elegir el contacto en el menú de tu equipo.</p>' +
        '<div class="mpi-fila"><button id="mpi-no" style="background:#e2e8f0;color:#334155">Cancelar</button><button id="mpi-si" style="background:' + (esWa ? '#16a34a' : '#4f46e5') + ';color:#fff">Enviar</button></div></div>';
      document.body.appendChild(m);
      var inp = m.querySelector('#mpi-dest'); inp.value = ls(esWa ? 'mpi_dest_cel' : 'mpi_dest_correo');
      function cerrar(v) { m.remove(); resolve(v); }
      m.querySelector('#mpi-no').onclick = function () { cerrar(null); };
      m.querySelector('#mpi-si').onclick = function () { var v = inp.value.trim(); ls(esWa ? 'mpi_dest_cel' : 'mpi_dest_correo', v); cerrar(v); };
      m.addEventListener('click', function (e) { if (e.target === m) cerrar(null); });
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50);
    });
  }
  async function enviar(canal, doc, opciones) {
    opciones = opciones || {};
    var destino = (opciones.destino !== undefined && opciones.destino !== null && String(opciones.destino).trim() !== '') ? String(opciones.destino).trim() : await pedirDestino(canal);
    if (destino === null) return;
    try {
      aviso('Preparando el PDF...');
      var r = await generarPdf(doc);
      var texto = (canal === 'correo' ? 'Buenos días,\n\n' : '') + (doc.mensaje || ('Adjunto ' + doc.titulo + ' de ' + doc.empresa + '.')) + (canal === 'correo' ? '\n\nSaludos,\n' + (doc.responsable || RESPONSABLE) : '\n\n' + (doc.responsable || RESPONSABLE));
      var asunto = doc.titulo + ' - ' + doc.empresa;
      var archivo = null;
      try { archivo = new File([r.blob], r.nombre, { type: 'application/pdf' }); } catch (e) { archivo = null; }
      if (!destino && archivo && navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try { await navigator.share({ files: [archivo], title: asunto, text: texto }); aviso('Reporte compartido.'); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      descargarBlob(r.blob, r.nombre);
      if (canal === 'whatsapp') {
        var numero = String(destino).replace(/\D/g, '');
        if (numero && numero.length === 9) numero = '51' + numero;
        root.open('https://wa.me/' + numero + '?text=' + encodeURIComponent(texto + '\n\n(El PDF quedó descargado: adjúntalo en este chat.)'), '_blank');
      } else {
        root.location.href = 'mailto:' + encodeURIComponent(destino) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(texto + '\n\n(El PDF quedó descargado: ' + r.nombre + '. Adjúntalo en este correo.)');
      }
      aviso('PDF descargado. Adjúntalo en el mensaje que se abrió.');
    } catch (e) { console.error(e); aviso('No se pudo preparar el envío: ' + (e.message || e), 'error'); }
  }

  root.MypecarImpuestos = {
    version: VERSION, ORDEN: ORDEN, NOMBRE: NOMBRE, CORTO: CORTO, DECLARA: DECLARA, ETIQUETA_ESTADO: ETIQUETA_ESTADO,
    construir: construir, mesSiguiente: mesSiguiente,
    util: { num: num, mon: mon, dma: dma, fechaLarga: fechaLarga, etiquetaPeriodo: etiquetaPeriodo, etiquetaCorta: etiquetaCorta, periodoMas: periodoMas, esc: esc, quintoDiaHabil: quintoDiaHabil, nombreSeguro: nombreSeguro, MESES: MESES },
    docHtml: docHtml, imprimir: imprimir, pdf: descargarPdf, excel: descargarExcel, enviar: enviar, generarPdf: generarPdf, generarExcel: generarExcel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MypecarImpuestos;
})(typeof window !== 'undefined' ? window : globalThis);
