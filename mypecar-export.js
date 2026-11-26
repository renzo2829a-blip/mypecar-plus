/**
 * mypecar-export.js  (version 2026-11-25)
 * ---------------------------------------------------------------------------
 * Modulo COMPARTIDO por 07 Reportes y 08 Auditoria.
 *
 * Que arregla:
 *  1. Excel: todas las hojas que genere la app quedan listas para imprimir
 *     (hoja A4, ajustada al ancho de la pagina, margenes angostos, numero de
 *     pagina en el pie). Se aplica sola a TODOS los Excel de 07 y 08.
 *  2. Informe de Auditoria: botones nuevos  Excel | PDF | Imprimir | Correo |
 *     WhatsApp. El PDF se arma como archivo real (A4), asi que se puede
 *     guardar, imprimir y adjuntar desde cualquier equipo, incluido el celular.
 *  3. Correo y WhatsApp: en celular abre el menu de compartir con el PDF
 *     adjunto; en computadora descarga el PDF y abre el correo o WhatsApp con el
 *     mensaje ya escrito.
 *  4. Recomendaciones: cada hallazgo sale con una accion concreta, un
 *     responsable y un plazo (en pantalla, PDF, Excel y mensajes).
 *  5. Impresion directa (Ctrl+P): la hoja del informe ya no se corta por el
 *     margen lateral.
 *
 * Como instalarlo: copiar este archivo junto a mypecar-sync.js y agregar UNA
 * linea en la app, debajo de la de mypecar-login.js:
 *     <script src="mypecar-export.js"></script>
 * No toca datos, calculos ni sincronizacion. Si el archivo falta, la app
 * funciona igual que antes.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.MypecarExport) return;

  var VERSION = '2026-11-25';
  var RESPONSABLE_POR_DEFECTO = 'CARLOS FLORES FIGUEROA';
  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  var AUTOTABLE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  // Lee una variable global de la app (let/const/function) sin romper si no existe.
  function g(nombre) {
    try { return (0, eval)('typeof ' + nombre + ' !== "undefined" ? ' + nombre + ' : undefined'); }
    catch (e) { return undefined; }
  }
  function aviso(msg, tipo) {
    try { var f = g('showToast'); if (typeof f === 'function') { f(msg, tipo || 'success'); return; } } catch (e) {}
    try { console.log('[MypecarExport]', msg); } catch (e) {}
  }
  function cargarScript(url) {
    return new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { fail(new Error('No se pudo cargar ' + url)); };
      document.head.appendChild(s);
    });
  }
  function soloTexto(html) {
    var d = document.createElement('div'); d.innerHTML = String(html == null ? '' : html);
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }
  // El PDF usa tipografia estandar (Latin-1): se cambian los simbolos que no existen en ella.
  function limpiarPdf(s) {
    return soloTexto(s)
      .replace(/[→⇒]/g, '->').replace(/[✓✔]/g, 'OK').replace(/−/g, '-')
      .replace(/≈/g, '~').replace(/[–—]/g, '-').replace(/…/g, '...')
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/[\u{1F300}-\u{1FAFF}☀-➿️]/gu, '')
      .replace(/[^\x00-\xFF]/g, '');
  }
  function sinTildes(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function nombreArchivoSeguro(s) { return sinTildes(s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, ''); }

  // ------------------------------------------------------------------
  // 1) CSS de impresion (Ctrl+P / boton Imprimir de la pagina)
  // ------------------------------------------------------------------
  var CSS = [
    '@media print {',
    '  @page { size: A4 portrait; margin: 12mm 10mm; }',
    '  html, body { background:#fff !important; width:auto !important; max-width:none !important; height:auto !important; overflow:visible !important; padding:0 !important; margin:0 !important; }',
    '  header, nav, #toast, #mps-badge, #mps-badge-menu, #sello-mypecar, #marca-agua-licencia, #mypecar-badge, .mps-aviso-lic, #mpx-modal { display:none !important; }',
    '  .informe-print-area { width:100% !important; max-width:100% !important; margin:0 !important; border-radius:0 !important; box-shadow:none !important; border:none !important; overflow:visible !important; }',
    '  .informe-print-area .overflow-x-auto { overflow:visible !important; }',
    '  .informe-print-area table { width:100% !important; table-layout:fixed !important; font-size:9px !important; }',
    '  .informe-print-area th, .informe-print-area td { word-break:break-word; overflow-wrap:anywhere; vertical-align:top; }',
    '  .informe-print-area tr { break-inside:avoid; page-break-inside:avoid; }',
    '  .informe-print-area .p-8 { padding:14px 18px !important; }',
    '  .informe-print-area .space-y-8 > * + * { margin-top:14px !important; }',
    '  .informe-print-area .px-8 { padding-left:18px !important; padding-right:18px !important; }',
    '}',
    '.mpx-btn { display:inline-flex; align-items:center; gap:6px; color:#fff; font-size:12px; font-weight:700; padding:10px 14px; border-radius:8px; border:0; cursor:pointer; }',
    '.mpx-btn:hover { filter:brightness(1.1); }',
    '#mpx-barra { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }',
    '#mpx-modal { position:fixed; inset:0; z-index:100001; background:rgba(15,23,42,.6); display:flex; align-items:center; justify-content:center; padding:16px; font-family:Segoe UI,Arial,sans-serif; }',
    '#mpx-modal .mpx-card { background:#fff; border-radius:16px; width:100%; max-width:440px; padding:22px; box-shadow:0 20px 60px rgba(0,0,0,.35); }',
    '#mpx-modal h3 { margin:0 0 4px; font-size:18px; color:#0f172a; }',
    '#mpx-modal p { margin:0 0 12px; font-size:13px; color:#64748b; line-height:1.4; }',
    '#mpx-modal label { display:block; font-size:12px; font-weight:700; color:#334155; margin:10px 0 4px; }',
    '#mpx-modal input { width:100%; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:10px; padding:11px 12px; font-size:16px; }',
    '#mpx-modal .mpx-fila { display:flex; gap:8px; margin-top:16px; }',
    '#mpx-modal .mpx-fila button { flex:1; border:0; border-radius:10px; padding:12px; font-size:14px; font-weight:800; cursor:pointer; }'
  ].join('\n');
  function inyectarCss() {
    if (document.getElementById('mpx-css')) return;
    var st = document.createElement('style'); st.id = 'mpx-css'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // ------------------------------------------------------------------
  // 2) Excel listo para imprimir (todas las hojas de todos los libros)
  // ------------------------------------------------------------------
  function ajustarImpresionLibro(wb) {
    try {
      wb.eachSheet(function (ws) {
        if (ws.__mpxAjustada) return;
        ws.__mpxAjustada = true;
        var ps = ws.pageSetup || {};
        var anchoTotal = 0, n = Math.max(ws.columnCount || 0, (ws.columns || []).length);
        for (var i = 1; i <= n; i++) { var w = ws.getColumn(i).width; anchoTotal += (typeof w === 'number' && w > 0) ? w : 8.43; }
        // Si la hoja ya trae su propia configuracion de impresion completa, se respeta.
        var propia = ps.fitToPage === true;
        if (!propia) {
          ws.pageSetup = Object.assign({}, ps, {
            paperSize: 9,                                   // A4
            orientation: anchoTotal > 95 ? 'landscape' : 'portrait',
            fitToPage: true, fitToWidth: 1, fitToHeight: 0, // todo el ancho en una pagina, alto libre
            horizontalCentered: true,
            margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }
          });
        } else if (!ps.paperSize) {
          ws.pageSetup = Object.assign({}, ps, { paperSize: 9 });
        }
        if (!ws.headerFooter || !ws.headerFooter.oddFooter) {
          ws.headerFooter = Object.assign({}, ws.headerFooter || {}, { oddFooter: '&L&8MYPECAR PLUS&C&8Página &P de &N&R&8&D' });
        }
      });
    } catch (e) { console.warn('[MypecarExport] No se pudo ajustar la impresion del Excel:', e); }
  }
  function instalarParcheExcel() {
    if (typeof ExcelJS === 'undefined' || !ExcelJS.Workbook || ExcelJS.Workbook.__mpxParche) return;
    ExcelJS.Workbook.__mpxParche = true;
    var desc = Object.getOwnPropertyDescriptor(ExcelJS.Workbook.prototype, 'xlsx');
    if (!desc || !desc.get) return;
    Object.defineProperty(ExcelJS.Workbook.prototype, 'xlsx', {
      configurable: true,
      get: function () {
        var x = desc.get.call(this), wb = this;
        if (x && !x.__mpxEnvuelto) {
          x.__mpxEnvuelto = true;
          ['writeBuffer', 'write', 'writeFile'].forEach(function (m) {
            if (typeof x[m] !== 'function') return;
            var original = x[m].bind(x);
            x[m] = function () { ajustarImpresionLibro(wb); return original.apply(null, arguments); };
          });
        }
        return x;
      }
    });
  }

  // ------------------------------------------------------------------
  // 3) Recomendaciones concretas por hallazgo
  // ------------------------------------------------------------------
  var PLAZOS = {
    critico: { quien: 'Contador responsable', cuando: 'Inmediato (24 horas)' },
    alto:    { quien: 'Contador responsable', cuando: 'Antes del cierre (5 días habiles)' },
    medio:   { quien: 'Contador / asistente contable', cuando: '15 días' },
    bajo:    { quien: 'Asistente contable', cuando: 'Próximo cierre mensual' }
  };
  // Cada regla: procedimiento (texto parcial), patron sobre la descripcion, y la accion.
  var REGLAS = [
    { p: 'Conciliaci', d: /falta importar/i, a: 'Exporta el .json del Libro Diario desde 04 (Ajustes > Exportar Datos para Reportes) y vuelve a importarlo aqui. Sin ese archivo no se puede conciliar nada.' },
    { p: 'Conciliaci', d: /Diferencia de S\//i, a: '1) En 01 Registro de Ventas filtra el mes y totaliza lo "Cobrado" por medio de cobro. 2) En 03 Caja y Bancos suma los ingresos del mismo mes por el mismo medio (efectivo, tarjeta, Yape/Plin, transferencia). 3) Compara medio por medio hasta ubicar el día o comprobante que no coincide. 4) Registra el ingreso que falta, o corrige el estado de cobro del comprobante, y regenera el asiento resumen de ventas.' },
    { p: 'Cruce de Compras', d: /falta importar/i, a: 'Exporta el .json de 02 Registro de Compras (Ajustes > Exportar Datos para Reportes) e importalo aqui.' },
    { p: 'Cruce de Compras', d: /sin RUC/i, a: 'Pide el comprobante con RUC al proveedor y corrígelo en 02 Registro de Compras. Mientras no lo tengas, no tomes el IGV como crédito fiscal ni lo deduzcas como gasto. Si es un gasto menor sin comprobante, sustentarlo con la planilla o liquidación de gastos que corresponda y la firma de quien lo autorizo.' },
    { p: 'Cruce de Compras', d: /mismo Tipo\+Serie|mas de una vez/i, a: 'Abre cada par en 02 Registro de Compras y compara fecha, proveedor e importe. Si es el mismo comprobante, elimina el sobrante y regenera el asiento resumen del mes. Si son comprobantes distintos, corrige la serie o número mal digitado. Para que no se repita, busca el número antes de guardar una compra nueva.' },
    { p: 'Cruce de Compras', d: /sin cuenta contable/i, a: 'En 02 Registro de Compras filtra las compras sin cuenta, asigna la cuenta PCGE de cada una (60 mercaderia o insumos, 63 servicios, 65 otros) y regenera el asiento resumen.' },
    { p: 'Márgenes', d: /falta importar/i, a: 'Importa el .json del Libro Diario para poder calcular el margen.' },
    { p: 'Márgenes', d: /vari\S* \+|aumentando|vari. \+/i, a: 'Un margen que sube de golpe suele esconder compras sin registrar. Cruza las compras de insumos del mes contra las guías y facturas recibidas (02 Registro de Compras), confirma que el inventario final esté bien contado y revisa si hubo un cambio de precios de venta. Si todo está registrado, deja constancia del motivo del aumento.' },
    { p: 'Márgenes', d: /vari/i, a: '1) Compara el precio unitario de los 5 insumos que más compras contra el mes anterior (07 Reportes > Análisis de cuenta 60). 2) Revisa mermas y porciones servidas contra la receta estandar. 3) Si el costo subio y el precio de carta no, ajusta los precios de los productos con más rotacion. 4) Cotiza con un segundo proveedor los insumos que subieron.' },
    { p: 'Gastos', d: /umbral individual/i, a: '1) Abre el Libro Mayor de esa cuenta (07 Reportes > Libro Mayor) y lista los comprobantes del mes. 2) Verifica que cada uno tenga comprobante valido, firma de quien lo autorizo y corresponda al mes. 3) Si pagaste varios meses por adelantado, registralo en la cuenta 18 y reconocelo mes a mes. 4) Si es un gasto unico, anotalo en la glosa para que se entienda el siguiente mes.' },
    { p: 'Gastos', d: /concentra/i, a: 'Fija un tope mensual para esa cuenta, pide al menos dos cotizaciones antes de renovar o ampliar el gasto y avisa a gerencia cuando se pase del tope.' },
    { p: 'Balance de Comprobaci', d: /NO cuadra/i, a: '1) En 04 Libro Diario revisa los asientos del mes con Debe distinto de Haber (filtra por asientos descuadrados). 2) Corrige el asiento, o elimina el asiento incompleto y vuelve a generarlo desde su registro de origen. 3) Reexporta el .json y vuelve a ejecutar este procedimiento. No emitas estados financieros hasta que la diferencia sea cero.' },
    { p: 'Balance de Comprobaci', d: /naturaleza contraria/i, a: 'Abre el Libro Mayor de esa cuenta y revisa los asientos del mes. Si el Debe y el Haber están invertidos, corrígelo con un asiento de ajuste. Si el saldo es legitimo (por ejemplo una nota de crédito grande o un anticipo), deja la explicación escrita en la glosa y en el papel de trabajo.' },
    { p: 'Flujo de Caja', d: /negativo/i, a: '1) Arma el flujo proyectado de las próximas 4 semanas (07 Reportes > Flujo de caja proyectado). 2) Posterga las compras que no sean urgentes. 3) Cobra primero lo vencido (07 > Cuentas por cobrar). 4) Si el desfase se repite dos meses seguidos, negocia plazo con los dos proveedores más grandes.' },
    { p: 'Flujo de Caja', d: /minimo de seguridad/i, a: '1) Pospón los pagos que no tengan fecha limite. 2) Acelera la cobranza de lo vencido. 3) Pide a los proveedores principales una ampliación de plazo. 4) Si el saldo bajo se repite, evalúa una linea de capital de trabajo antes de que falte efectivo, no despues.' },
    { p: 'Flujo de Caja', d: /no coincide/i, a: '1) Concilia cada cuenta de efectivo (101, 1041, 1052) contra el arqueo de caja y el extracto bancario del mes. 2) Ubica los asientos que mueven efectivo sin pasar por ventas, compras o caja y revisa su cuenta contraria. 3) Corrige y vuelve a exportar el Libro Diario. Hasta que coincidan, el saldo de efectivo del informe no es confiable.' },
    { p: 'Detracciones', d: /vencida/i, a: 'Deposita hoy el monto en la cuenta de detracciones del proveedor en el Banco de la Nación, guarda la constancia y registrala en 02 Registro de Compras. Mientras el depósito no este hecho no se puede usar el crédito fiscal de esos comprobantes, asi que anota cuanto IGV queda retenido en el calculo del mes.' },
    { p: 'Detracciones', d: /no coincide/i, a: 'Recalcula Total x tasa segun el anexo de SUNAT que corresponda al servicio o bien y corrige el monto en 02 Registro de Compras. Si hubo redondeo o moneda extranjera, deja la nota en el comprobante.' },
    { p: 'Inventario', d: /falta importar/i, a: 'En 09 Inventario ve a Cierre Contable > Exportar para Contabilidad (.json) e importalo aqui.' },
    { p: 'Inventario', d: /merma/i, a: '1) En 09 Inventario abre Reportes > Reporte de Mermas del mes. 2) Identifica los 3 productos y los turnos donde se concentran. 3) Separa lo evitable (mal manejo, vencimiento por exceso de stock, roturas) de lo normal del proceso. 4) Fija una merma máxima por producto, pide la firma del responsable de cada ajuste y revisa el resultado el mes siguiente.' },
    { p: 'Inventario', d: /negativo/i, a: 'Abre el Kardex de cada producto con stock negativo en 09 Inventario. Busca la salida o venta sin entrada y registra la compra que falta, o carga el saldo inicial si nunca se cargo. Haz un conteo fisico de esos productos antes del cierre.' },
    { p: 'Inventario', d: /stock minimo/i, a: 'Haz el pedido de reposición de esos productos esta semana (09 Inventario > Stock menor al mínimo) y revisa si el mínimo configurado todavía sirve para el consumo real.' },
    { p: 'Punto de Equilibrio', d: /por debajo del punto de equilibrio/i, a: '1) Fija la venta mínima diaria que indica el punto de equilibrio y compárala cada semana con la venta real (07 Reportes > Punto de equilibrio). 2) Recorta primero los dos gastos fijos más altos del informe. 3) Aplica receta estandar en los tres insumos más caros. 4) Presenta el plan a los socios con fecha de revisión quincenal.' },
    { p: 'Punto de Equilibrio', d: /costos variables.*(igualan|superan)/i, a: 'Revisa hoy precios de venta e insumos. Confirma que no haya compras de otro periodo o de stock cargadas como consumo del mes y que la clasificación fijo/variable de 04 esté bien. Si el costo es real, sube precios de los productos con más rotacion.' },
    { p: 'Punto de Equilibrio', d: /Margen de seguridad reducido/i, a: 'Controla la venta diaria contra la venta mínima del informe. Si baja de ese nivel tres días seguidos, activa una promocion en las horas de menor venta o reduce turnos de apoyo.' },
    { p: 'Punto de Equilibrio', d: /representan/i, a: '1) Implementa receta estandar (gramaje por plato) en los productos más vendidos. 2) Haz inventario fisico al cierre. 3) Compara los precios de los 3 insumos principales con un segundo proveedor.' },
    { p: 'Punto de Equilibrio', d: /Apalancamiento/i, a: 'Convierte gastos fijos en variables donde se pueda (comision por venta, pago por produccion, alquiler con parte variable). Vigila la venta diaria, no solo el cierre de mes.' },
    { p: 'Punto de Equilibrio', d: /costos fijos variaron/i, a: 'Revisa el devengo: lo pagado por adelantado (alquileres, seguros) va a la cuenta 18 y se reconoce mes a mes; lo del mes anterior que se pago ahora se provisiona en su mes. Corrige en 04 Libro Diario y vuelve a ejecutar.' },
    { p: 'Punto de Equilibrio', d: /./, a: 'Completa el dato que indica el hallazgo en 04 Libro Diario (cierre del mes, cierre de existencias o clasificación de la cuenta 6591) y vuelve a ejecutar este procedimiento.' }
  ];
  function recomendacionConcreta(h) {
    var proc = sinTildes(h.procedimiento || ''), desc = sinTildes(soloTexto(h.descripcion || ''));
    var regla = null;
    for (var i = 0; i < REGLAS.length && !regla; i++) {
      var r = REGLAS[i];
      if (proc.indexOf(sinTildes(r.p)) !== -1 && r.d.test(desc)) regla = r;
    }
    var base = regla ? regla.a : soloTexto(h.recomendacionOriginal || h.recomendacion || 'Revisar el hallazgo con el responsable y dejar constancia de la correccion.');
    var pl = PLAZOS[h.severidad] || PLAZOS.medio;
    return { accion: base, responsable: pl.quien, plazo: pl.cuando };
  }
  function recomendacionTexto(h) {
    var r = recomendacionConcreta(h);
    return r.accion + ' Responsable: ' + r.responsable + '. Plazo: ' + r.plazo + '.';
  }
  // Todo hallazgo nuevo sale con su recomendacion concreta (pantalla, PDF, Excel y mensajes).
  function instalarRecomendaciones() {
    var orig = g('nuevoHallazgo');
    if (typeof orig !== 'function' || orig.__mpx) return;
    var nuevo = function (procedimiento, severidad, descripcion, recomendacion) {
      var h = orig(procedimiento, severidad, descripcion, recomendacion);
      try { h.recomendacionOriginal = h.recomendacion; h.recomendacion = recomendacionTexto(h); } catch (e) {}
      return h;
    };
    nuevo.__mpx = true;
    window.nuevoHallazgo = nuevo;
  }

  // ------------------------------------------------------------------
  // 4) Datos del informe (se leen de la app)
  // ------------------------------------------------------------------
  function datosInforme() {
    var hall = g('hallazgos') || [];
    var cfg = (g('diarioImport') && g('diarioImport').config) || {};
    var appCfg = g('appConfig') || {};
    var periodo = g('periodoAuditado');
    var fmtP = g('formatPeriodoLabel');
    var txt = function (id) { var e = document.getElementById(id); return e ? String(e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
    var conteos = { critico: 0, alto: 0, medio: 0, bajo: 0 };
    hall.forEach(function (h) { if (conteos[h.severidad] !== undefined) conteos[h.severidad]++; });
    return {
      hallazgos: hall, conteos: conteos, total: hall.length,
      empresa: (cfg.nombreComercial || cfg.razonSocial || txt('inf-titulo') || 'EMPRESA').toUpperCase(),
      ruc: cfg.ruc || '-',
      periodo: periodo || '', periodoTexto: (typeof fmtP === 'function' && periodo) ? fmtP(periodo) : (periodo || ''),
      responsable: ((appCfg.auditorResponsable || '').trim() || RESPONSABLE_POR_DEFECTO).toUpperCase(),
      conclusion: txt('inf-conclusion-general'),
      pe: g('resultadoPEAuditado'), sugerenciasPE: g('sugerenciasPEAuditado') || [],
      cfg: cfg
    };
  }
  function hayInforme() {
    var d = datosInforme();
    if (!d.periodo || !g('diarioImport')) { aviso('Ejecuta primero los procedimientos de auditoría.', 'error'); return null; }
    return d;
  }
  var ETIQUETA = { critico: 'CRÍTICO', alto: 'ALTO', medio: 'MEDIO', bajo: 'BAJO' };

  // ------------------------------------------------------------------
  // 5) PDF (A4 vertical)
  // ------------------------------------------------------------------
  async function asegurarJsPdf() {
    if (!(window.jspdf && window.jspdf.jsPDF)) await cargarScript(JSPDF_URL);
    var probe = new window.jspdf.jsPDF();
    if (typeof probe.autoTable !== 'function') await cargarScript(AUTOTABLE_URL);
    return window.jspdf.jsPDF;
  }
  var COLOR_SEV = { critico: [225, 29, 72], alto: [249, 115, 22], medio: [251, 191, 36], bajo: [56, 189, 248] };

  async function generarPdf() {
    var d = hayInforme(); if (!d) return null;
    var JsPDF = await asegurarJsPdf();
    var doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    var W = 210, M = 14, ANCHO = W - 2 * M, y = 0;
    var L = limpiarPdf;

    // Franja de titulo
    doc.setFillColor(30, 41, 59); doc.rect(0, 0, W, 34, 'F');
    doc.setTextColor(203, 213, 225); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('INFORME DE AUDITORIA INTERNA - REVISION DE MES CERRADO', M, 10);
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(doc.splitTextToSize(L(d.empresa), ANCHO).slice(0, 2), M, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(203, 213, 225);
    doc.text(L('RUC: ' + d.ruc + '   |   Periodo auditado: ' + d.periodoTexto + '   |   Emitido el: ' + new Date().toLocaleDateString('es-PE')), M, 30);
    y = 42;

    // Resumen ejecutivo
    doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('RESUMEN EJECUTIVO', M, y); y += 3;
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, theme: 'grid',
      head: [['Crítico', 'Alto', 'Medio', 'Bajo', 'Total hallazgos']],
      body: [[d.conteos.critico, d.conteos.alto, d.conteos.medio, d.conteos.bajo, d.total]],
      styles: { fontSize: 11, halign: 'center', cellPadding: 2.5, lineColor: [203, 213, 225] },
      headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontSize: 8, fontStyle: 'bold' }
    });
    y = doc.lastAutoTable.finalY + 5;
    if (d.conclusion) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(51, 65, 85);
      var lineas = doc.splitTextToSize(L(d.conclusion), ANCHO);
      doc.text(lineas, M, y); y += lineas.length * 4.2 + 4;
    }

    // Punto de equilibrio
    var pe = d.pe;
    if (pe && pe.nMeses > 0 && pe.valido) {
      var F = function (n) { return 'S/ ' + (typeof n === 'number' && isFinite(n) ? n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'); };
      var P = function (n) { return (typeof n === 'number' && isFinite(n)) ? (n * 100).toFixed(1) + '%' : '-'; };
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 59);
      if (y > 235) { doc.addPage(); y = 16; }
      doc.text('PUNTO DE EQUILIBRIO (montos sin IGV)', M, y); y += 3;
      doc.autoTable({
        startY: y, margin: { left: M, right: M }, theme: 'plain',
        body: [
          ['Ventas netas', F(pe.ventas), 'Costos fijos', F(pe.cf)],
          ['Costos variables', F(pe.cv), 'Utilidad operativa', F(pe.utilidadOperativa)],
          ['Margen de contribución', F(pe.mc) + ' (' + P(pe.razonMC) + ')', 'Punto de equilibrio mensual', F(pe.pe)],
          ['Venta mínima diaria (con IGV)', F(pe.peDiarioConIgv), 'Margen de seguridad', F(pe.margenSeguridad) + ' (' + P(pe.msPct) + ')']
        ],
        styles: { fontSize: 8.5, cellPadding: 1.6, textColor: [51, 65, 85] },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 }, 1: { halign: 'right', cellWidth: 46 }, 2: { fontStyle: 'bold', cellWidth: 45 }, 3: { halign: 'right', cellWidth: 46 } },
        didParseCell: function (data) { if (data.row.index % 2 === 0) data.cell.styles.fillColor = [248, 250, 252]; }
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // Hallazgos y recomendaciones
    if (y > 245) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 41, 59);
    doc.text('DETALLE DE HALLAZGOS Y RECOMENDACIONES', M, y); y += 3;
    var filas = d.hallazgos.length ? d.hallazgos.map(function (h, i) {
      var r = recomendacionConcreta(h);
      return [String(i + 1), L(h.procedimiento), ETIQUETA[h.severidad] || '', L(h.descripcion),
        L(r.accion) + '\nResponsable: ' + L(r.responsable) + '\nPlazo: ' + L(r.plazo)];
    }) : [['', '', '', 'Sin hallazgos que reportar en este periodo.', '']];
    doc.autoTable({
      startY: y, margin: { left: M, right: M, top: 16, bottom: 18 }, theme: 'grid',
      head: [['#', 'Procedimiento', 'Severidad', 'Hallazgo', 'Recomendación (acción, responsable y plazo)']],
      body: filas, tableWidth: ANCHO,
      styles: { fontSize: 7.5, cellPadding: 1.8, overflow: 'linebreak', valign: 'top', lineColor: [203, 213, 225], textColor: [51, 65, 85] },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 7, halign: 'center' }, 1: { cellWidth: 27 }, 2: { cellWidth: 16, halign: 'center', fontStyle: 'bold' }, 3: { cellWidth: 55 }, 4: { cellWidth: ANCHO - 7 - 27 - 16 - 55 } },
      didParseCell: function (data) {
        if (data.section === 'body' && data.column.index === 2) {
          var sev = d.hallazgos[data.row.index] && d.hallazgos[data.row.index].severidad;
          var c = COLOR_SEV[sev]; if (c) { data.cell.styles.fillColor = c; data.cell.styles.textColor = sev === 'medio' ? [67, 20, 7] : 255; }
        }
      },
      rowPageBreak: 'avoid'
    });
    y = doc.lastAutoTable.finalY + 12;

    // Firma
    if (y > 255) { doc.addPage(); y = 30; }
    doc.setDrawColor(100, 116, 139); doc.line(M, y + 8, M + 70, y + 8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30, 41, 59);
    doc.text(L(d.responsable), M, y + 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text('Auditor / consultor responsable', M, y + 17.5);

    // Pie en todas las paginas
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setDrawColor(226, 232, 240); doc.line(M, 285, W - M, 285);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
      doc.text(L('MYPECAR PLUS - Informe de auditoría interna - ' + d.empresa + ' - ' + d.periodoTexto), M, 289);
      doc.text('Página ' + p + ' de ' + n, W - M, 289, { align: 'right' });
      doc.text('Revisión interna de control. No constituye una opinion de auditoría bajo NIA.', M, 292.5);
    }
    var nombre = 'Informe_Auditoria_' + nombreArchivoSeguro(d.empresa).slice(0, 30) + '_' + (d.periodo || 'periodo') + '.pdf';
    return { doc: doc, blob: doc.output('blob'), nombre: nombre, datos: d };
  }

  function descargarBlob(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  async function descargarPdf() {
    try {
      aviso('Preparando el PDF...');
      var r = await generarPdf(); if (!r) return;
      descargarBlob(r.blob, r.nombre);
      aviso('PDF listo: ' + r.nombre);
    } catch (e) {
      console.error(e); aviso('No se pudo armar el PDF (' + (e.message || e) + '). Se abre la impresion normal.', 'error');
      try { window.print(); } catch (e2) {}
    }
  }
  async function imprimir() {
    try {
      var r = await generarPdf(); if (!r) return;
      var url = URL.createObjectURL(r.blob);
      var w = window.open(url, '_blank');
      if (!w) { descargarBlob(r.blob, r.nombre); aviso('El navegador bloqueó la ventana. Se descargó el PDF: ábrelo e imprimelo.'); }
      else { aviso('Se abrió el PDF: usa el botón Imprimir de su visor.'); }
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    } catch (e) { console.error(e); try { window.print(); } catch (e2) {} }
  }

  // ------------------------------------------------------------------
  // 6) Excel del informe (A4 horizontal, ajustado al ancho)
  // ------------------------------------------------------------------
  function alturaFila(textos, anchos) {
    var lineas = 1;
    textos.forEach(function (t, i) {
      var cpl = Math.max(8, Math.floor(anchos[i] * 1.05));
      var s = String(t == null ? '' : t), n = 0;
      s.split('\n').forEach(function (p) { n += Math.max(1, Math.ceil(p.length / cpl)); });
      lineas = Math.max(lineas, n);
    });
    return Math.min(409, lineas * 12.5 + 4);
  }
  async function exportarExcel() {
    var d = hayInforme(); if (!d) return;
    try {
      var cfg = d.cfg, wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Informe de Auditoría');
      var anchos = [5, 26, 11, 48, 66];
      ws.columns = anchos.map(function (w) { return { width: w }; });
      var azul = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      ws.mergeCells(1, 1, 1, 5);
      ws.getCell(1, 1).value = 'INFORME DE AUDITORÍA - ' + d.empresa + ' - ' + d.periodoTexto.toUpperCase();
      ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }; ws.getCell(1, 1).fill = azul;
      ws.getCell(1, 1).alignment = { vertical: 'middle', wrapText: true }; ws.getRow(1).height = 28;
      ws.mergeCells(2, 1, 2, 5);
      ws.getCell(2, 1).value = 'RUC: ' + d.ruc + '  |  Emitido el ' + new Date().toLocaleDateString('es-PE') + '  |  Auditor / consultor responsable: ' + d.responsable;
      ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
      ws.mergeCells(3, 1, 3, 5);
      ws.getCell(3, 1).value = 'Hallazgos: ' + d.total + '  (críticos ' + d.conteos.critico + ', altos ' + d.conteos.alto + ', medios ' + d.conteos.medio + ', bajos ' + d.conteos.bajo + ')';
      ws.getCell(3, 1).font = { bold: true, size: 10 };
      var enc = ws.getRow(5);
      enc.values = ['#', 'Procedimiento', 'Severidad', 'Hallazgo', 'Recomendación (acción, responsable y plazo)'];
      enc.font = { bold: true, color: { argb: 'FFFFFFFF' } }; enc.fill = azul; enc.alignment = { vertical: 'middle', wrapText: true }; enc.height = 20;
      var colores = { critico: 'FFE11D48', alto: 'FFF97316', medio: 'FFFBBF24', bajo: 'FF38BDF8' };
      var fila = 6;
      if (!d.hallazgos.length) { ws.mergeCells(fila, 1, fila, 5); ws.getCell(fila, 1).value = 'Sin hallazgos que reportar.'; fila++; }
      d.hallazgos.forEach(function (h, i) {
        var r = recomendacionConcreta(h);
        var vals = [i + 1, h.procedimiento, ETIQUETA[h.severidad] || '', soloTexto(h.descripcion), r.accion + '\nResponsable: ' + r.responsable + '\nPlazo: ' + r.plazo];
        var row = ws.getRow(fila); row.values = vals;
        row.height = alturaFila(vals, anchos);
        for (var c = 1; c <= 5; c++) {
          var cell = row.getCell(c);
          cell.alignment = { wrapText: true, vertical: 'top', horizontal: (c === 1 || c === 3) ? 'center' : 'left' };
          cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
        }
        row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colores[h.severidad] || 'FFE2E8F0' } };
        row.getCell(3).font = { bold: true, color: { argb: h.severidad === 'medio' ? 'FF431407' : 'FFFFFFFF' } };
        fila++;
      });
      var pe = d.pe;
      if (pe && pe.nMeses > 0) {
        fila++;
        ws.mergeCells(fila, 1, fila, 5);
        ws.getCell(fila, 1).value = 'ANÁLISIS DEL PUNTO DE EQUILIBRIO (montos sin IGV)';
        ws.getCell(fila, 1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getCell(fila, 1).fill = azul; fila++;
        [['Ventas netas', pe.ventas], ['Costos variables', pe.cv], ['Margen de contribución', pe.mc], ['% Margen de contribución', pe.razonMC], ['Costos fijos', pe.cf],
          ['Utilidad operativa', pe.utilidadOperativa], ['Punto de equilibrio mensual', pe.pe], ['Venta mínima diaria (con IGV)', pe.valido ? pe.peDiarioConIgv : null],
          ['Margen de seguridad (S/)', pe.margenSeguridad], ['Margen de seguridad (%)', pe.msPct]].forEach(function (p) {
          ws.mergeCells(fila, 1, fila, 2); ws.getCell(fila, 1).value = p[0];
          var c = ws.getCell(fila, 3); c.value = (p[1] === null || p[1] === undefined) ? '—' : p[1]; c.numFmt = p[0].indexOf('%') >= 0 ? '0.0%' : '#,##0.00';
          fila++;
        });
        (d.sugerenciasPE || []).forEach(function (sg) {
          ws.getCell(fila, 2).value = 'Sugerencia'; ws.getCell(fila, 2).alignment = { vertical: 'top' };
          ws.mergeCells(fila, 3, fila, 5);
          var t = sg.titulo + ': ' + sg.texto; ws.getCell(fila, 3).value = t;
          ws.getCell(fila, 3).alignment = { wrapText: true, vertical: 'top' };
          ws.getRow(fila).height = alturaFila(['', '', t], [5, 26, 125]); fila++;
        });
      }
      fila += 2;
      ws.mergeCells(fila, 1, fila, 5);
      ws.getCell(fila, 1).value = 'Auditor / consultor responsable: ' + d.responsable;
      ws.getCell(fila, 1).font = { bold: true };
      fila++;
      ws.mergeCells(fila, 1, fila, 5);
      ws.getCell(fila, 1).value = 'Revisión interna de control. No constituye una opinión de auditoría bajo Normas Internacionales de Auditoría (NIA).';
      ws.getCell(fila, 1).font = { italic: true, size: 8, color: { argb: 'FF94A3B8' } };
      if (cfg && cfg.licenciadoA) { fila++; ws.mergeCells(fila, 1, fila, 5); ws.getCell(fila, 1).value = 'Licenciado a: ' + cfg.licenciadoA + ' — Uso no autorizado para terceros.'; ws.getCell(fila, 1).font = { italic: true, size: 8, bold: true, color: { argb: 'FF64748B' } }; }
      // Logo del negocio (si lo tiene) en una fila nueva al inicio, sin pisar el titulo
      try {
        var logo = cfg && cfg.logoBase64, m = logo && /^data:image\/(png|jpe?g|gif);base64,/.exec(logo);
        if (m) {
          var id = wb.addImage({ base64: logo, extension: m[1] === 'jpg' ? 'jpeg' : m[1] });
          ws.spliceRows(1, 0, []); ws.getRow(1).height = 36;
          ws.addImage(id, { tl: { col: 0.1, row: 0.05 }, ext: { width: 80, height: 38 } });
        }
      } catch (e) { console.warn('Logo omitido en el Excel:', e); }
      // Impresión: A4 horizontal, todo el ancho en una página, títulos repetidos
      ws.pageSetup = {
        paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
        margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
        printTitlesRow: (m ? '6:6' : '5:5')
      };
      ws.headerFooter = { oddFooter: '&L&8MYPECAR PLUS - Informe de auditoría&C&8Página &P de &N&R&8&D' };
      var buf = await wb.xlsx.writeBuffer();
      descargarBlob(new Blob([buf], { type: 'application/octet-stream' }), 'Informe_Auditoria_' + (d.periodo || 'periodo') + '.xlsx');
      aviso('Informe exportado a Excel.');
    } catch (e) { console.error(e); aviso('No se pudo exportar a Excel: ' + (e.message || e), 'error'); }
  }

  // ------------------------------------------------------------------
  // 7) Enviar por correo / WhatsApp
  // ------------------------------------------------------------------
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { return ''; } }
  function mensajeEnvio(d, canal) {
    var principales = d.hallazgos.filter(function (h) { return h.severidad === 'critico' || h.severidad === 'alto'; }).slice(0, 3)
      .map(function (h) { var t = soloTexto(h.descripcion); return '- ' + (t.length > 150 ? t.slice(0, 147) + '...' : t); });
    var resumen = d.total === 0 ? 'No se encontraron hallazgos.' :
      d.total + ' hallazgo(s): ' + d.conteos.critico + ' críticos, ' + d.conteos.alto + ' altos, ' + d.conteos.medio + ' medios y ' + d.conteos.bajo + ' bajos.';
    var cuerpo = 'Adjunto el informe de auditoría interna de ' + d.empresa + ' (RUC ' + d.ruc + '), periodo ' + d.periodoTexto + '.\n\n' +
      'Resultado: ' + resumen + (principales.length ? '\nLos más urgentes:\n' + principales.join('\n') : '') +
      '\n\nCada hallazgo trae su recomendación, responsable y plazo en el PDF.';
    if (canal === 'correo') return 'Buenos días,\n\n' + cuerpo + '\n\nSaludos,\n' + d.responsable;
    return cuerpo + '\n\n' + d.responsable;
  }
  function pedirDestino(canal) {
    return new Promise(function (resolve) {
      var prev = document.getElementById('mpx-modal'); if (prev) prev.remove();
      var esWa = canal === 'whatsapp';
      var m = document.createElement('div'); m.id = 'mpx-modal';
      m.innerHTML = '<div class="mpx-card"><h3>' + (esWa ? 'Enviar por WhatsApp' : 'Enviar por correo') + '</h3>' +
        '<p>Se arma el PDF del informe. En el celular se abre el menú de compartir con el archivo adjunto. En la computadora se descarga el PDF y se abre ' + (esWa ? 'WhatsApp' : 'tu correo') + ' con el mensaje listo: solo adjunta el archivo.</p>' +
        (esWa ? '<label>Celular (con código de país, opcional)</label><input id="mpx-dest" inputmode="tel" placeholder="51999999999">'
              : '<label>Correo del destinatario (opcional)</label><input id="mpx-dest" type="email" inputmode="email" placeholder="cliente@empresa.com">') +
        '<p style="margin-top:8px;font-size:12px">Déjalo en blanco para elegir el contacto en el menú de tu equipo.</p>' +
        '<div class="mpx-fila"><button id="mpx-no" style="background:#e2e8f0;color:#334155">Cancelar</button><button id="mpx-si" style="background:' + (esWa ? '#16a34a' : '#4f46e5') + ';color:#fff">Enviar</button></div></div>';
      document.body.appendChild(m);
      var inp = m.querySelector('#mpx-dest'); inp.value = ls(esWa ? 'mpx_dest_cel' : 'mpx_dest_correo');
      function cerrar(v) { m.remove(); resolve(v); }
      m.querySelector('#mpx-no').onclick = function () { cerrar(null); };
      m.querySelector('#mpx-si').onclick = function () { var v = inp.value.trim(); ls(esWa ? 'mpx_dest_cel' : 'mpx_dest_correo', v); cerrar(v); };
      m.addEventListener('click', function (e) { if (e.target === m) cerrar(null); });
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50);
    });
  }
  async function enviar(canal) {
    var d = hayInforme(); if (!d) return;
    var destino = await pedirDestino(canal);
    if (destino === null) return;
    try {
      aviso('Preparando el PDF...');
      var r = await generarPdf(); if (!r) return;
      var texto = mensajeEnvio(d, canal);
      var asunto = 'Informe de auditoría - ' + d.empresa + ' - ' + d.periodoTexto;
      var archivo = null;
      try { archivo = new File([r.blob], r.nombre, { type: 'application/pdf' }); } catch (e) { archivo = null; }
      // Sin destinatario escrito: menú de compartir del equipo con el PDF adjunto
      if (!destino && archivo && navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try { await navigator.share({ files: [archivo], title: asunto, text: texto }); aviso('Informe compartido.'); return; }
        catch (e) { if (e && e.name === 'AbortError') return; /* otro error: sigue con la ruta normal */ }
      }
      descargarBlob(r.blob, r.nombre);
      if (canal === 'whatsapp') {
        var num = destino.replace(/\D/g, '');
        if (num && num.length === 9) num = '51' + num;
        window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(texto + '\n\n(El PDF quedó descargado: adjúntalo en este chat.)'), '_blank');
      } else {
        var cuerpo = texto + '\n\n(El PDF quedó descargado: ' + r.nombre + '. Adjúntalo en este correo.)';
        window.location.href = 'mailto:' + encodeURIComponent(destino) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(cuerpo);
      }
      aviso('PDF descargado. Adjúntalo en el mensaje que se abrió.');
    } catch (e) { console.error(e); aviso('No se pudo preparar el envío: ' + (e.message || e), 'error'); }
  }

  // ------------------------------------------------------------------
  // 8) Botonera del informe
  // ------------------------------------------------------------------
  function instalarBotonera() {
    var btnExcel = document.querySelector('button[onclick*="exportarInformeAuditoriaExcel"]');
    if (!btnExcel) return;
    var cont = btnExcel.parentElement;
    if (!cont || cont.id === 'mpx-barra') return;
    cont.id = 'mpx-barra'; cont.classList.add('no-print');
    var b = function (color, icono, texto, fn) { return '<button type="button" class="mpx-btn" style="background:' + color + '" onclick="' + fn + '"><i class="fa-solid ' + icono + '"></i> ' + texto + '</button>'; };
    cont.innerHTML =
      b('#15803d', 'fa-file-excel', 'Excel', 'MypecarExport.excel()') +
      b('#4f46e5', 'fa-file-pdf', 'PDF', 'MypecarExport.pdf()') +
      b('#475569', 'fa-print', 'Imprimir', 'MypecarExport.imprimir()') +
      b('#2563eb', 'fa-envelope', 'Correo', "MypecarExport.enviar('correo')") +
      b('#16a34a', 'fa-brands fa-whatsapp', 'WhatsApp', "MypecarExport.enviar('whatsapp')");
  }
  // La funcion que ya existe en la app (usada por onclick o por otros accesos) apunta al nuevo Excel
  function reemplazarFuncionesExistentes() {
    if (typeof g('exportarInformeAuditoriaExcel') === 'function') window.exportarInformeAuditoriaExcel = exportarExcel;
  }

  function iniciar() {
    try { inyectarCss(); } catch (e) { console.warn(e); }
    try { instalarParcheExcel(); } catch (e) { console.warn(e); }
    try { instalarRecomendaciones(); } catch (e) { console.warn(e); }
    try { instalarBotonera(); } catch (e) { console.warn(e); }
    try { reemplazarFuncionesExistentes(); } catch (e) { console.warn(e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  // Segunda pasada cuando todo cargo (ExcelJS y los scripts de la app pueden llegar tarde)
  window.addEventListener('load', function () { setTimeout(iniciar, 50); });

  window.MypecarExport = {
    version: VERSION, excel: exportarExcel, pdf: descargarPdf, imprimir: imprimir, enviar: enviar,
    generarPdf: generarPdf, recomendacionConcreta: recomendacionConcreta, ajustarImpresionLibro: ajustarImpresionLibro
  };
})();
