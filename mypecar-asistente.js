/* MYPECAR PLUS — Asistente (2026-11-25)
 * Un solo asistente para los 9 módulos: botón flotante "Asistente" en cada app.
 *  - Sabe dónde está cada cosa en TODO el sistema y abre la pestaña (o el módulo) con un botón.
 *  - Responde con los datos de la empresa activa (ventas, compras, IGV, por cobrar, por pagar), leyendo las
 *    fotos que cada módulo ya publica en la nube para los otros (MypecarSync.enlace.leer). Respeta RLS:
 *    solo ve lo de la empresa a la que pertenece el usuario.
 *  - Entiende plurales, errores de tipeo y sinónimos; recuerda la pregunta anterior ("¿y en octubre?").
 *  - En el Libro Diario (04) reutiliza además su motor contable (procesarConsulta).
 *  - 100 % local: no envía el texto de las preguntas a ningún servicio externo.
 */
(function () {
  'use strict';
  if (window.__mypecarAsistente) return;
  window.__mypecarAsistente = true;

  // ---------------------------------------------------------------- conocimiento del sistema
  const MODULOS = [
    { n: '01', app: 'ventas', nombre: 'Registro de Ventas', archivo: '108 01 Registro de Ventas Mypecar Plus.html', claves: ['ventas', 'venta', 'vender', 'facturar', 'boleta', 'factura', 'clientes', 'cobrar', 'cobranza'], desc: 'registras boletas y facturas, cobras las ventas a crédito y dejas listo el IGV' },
    { n: '02', app: 'compras', nombre: 'Registro de Compras', archivo: '108 02 Registro de Compras Mypecar Plus.html', claves: ['compras', 'compra', 'comprar', 'proveedores', 'proveedor', 'credito fiscal', 'gastos'], desc: 'anotas las facturas de tus proveedores y llevas tu crédito fiscal' },
    { n: '03', app: 'caja', nombre: 'Caja y Bancos', archivo: '108 03 Libro de Caja y Bancos Mypecar Plus.html', claves: ['caja', 'bancos', 'banco', 'efectivo', 'yape', 'plin', 'prestamo', 'conciliacion'], desc: 'controlas el dinero que entra y sale de tu caja y de tus cuentas del banco' },
    { n: '04', app: 'diario', nombre: 'Libro Diario', archivo: '108 04 Libro Diario Mypecar Plus.html', claves: ['libro diario', 'contabilidad', 'asientos', 'balance', 'mayor', 'estados financieros', 'impuestos'], desc: 'reúne todos tus asientos y arma tu libro mayor, balances y estados financieros' },
    { n: '05', app: 'personal', nombre: 'Personal y Planilla', archivo: '108 05 Personal Mypecar Plus.html', claves: ['personal', 'planilla', 'trabajadores', 'trabajador', 'empleados', 'sueldos', 'boletas de pago', 'cts', 'gratificacion', 'vacaciones'], desc: 'calculas planilla, boletas de pago, gratificaciones, CTS y vacaciones' },
    { n: '06', app: 'activos', nombre: 'Activos Fijos', archivo: '108 06 Activos Fijos Mypecar Plus.html', claves: ['activos fijos', 'activo', 'depreciacion', 'equipos', 'maquinaria', 'muebles', 'vehiculos'], desc: 'registras tus equipos y el sistema calcula su depreciación' },
    { n: '07', app: 'reportes', nombre: 'Reportes', archivo: '108 07 Reportes Mypecar Plus.html', claves: ['reportes', 'reporte', 'estados financieros', 'dashboard', 'declaracion jurada', 'dj anual', 'detracciones'], desc: 'ves balance, estado de resultados, impuestos del mes y cuentas por cobrar y pagar' },
    { n: '08', app: 'auditoria', nombre: 'Auditoría', archivo: '108 08 Auditoria Mypecar Plus.html', claves: ['auditoria', 'auditar', 'revisar', 'hallazgos', 'diferencias', 'errores'], desc: 'revisas tus cifras y detectas diferencias antes de declarar' },
    { n: '09', app: 'inventario', nombre: 'Inventario y Kardex', archivo: '108 09 Inventario Mypecar Plus.html', claves: ['inventario', 'kardex', 'stock', 'almacen', 'existencias', 'productos', 'mercaderia'], desc: 'controlas tu stock, lo valorizas y evitas vender más de lo que tienes' }
  ];
  // [módulo, id de pestaña, nombre visible, frases extra, para qué sirve]
  const T = [
    ['01', 'dashboard', 'Panel General', [], 'el resumen de tus ventas del mes'], ['01', 'registro', 'Registro de Ventas', ['lista de ventas', 'ver mis ventas', 'comprobantes emitidos', 'cobrar una venta', 'registrar cobro'], 'la lista de tus comprobantes de venta, para buscarlos, cobrarlos o exportarlos'],
    ['01', 'clientes', 'Clientes', ['maestro de clientes', 'agregar cliente', 'ruc de cliente'], 'tus clientes con su RUC y datos'], ['01', 'shortcuts', 'Registrar Venta', ['nueva venta', 'emitir boleta', 'emitir factura', 'hacer una venta', 'registrar una venta'], 'registrar una boleta o factura de venta'],
    ['01', 'resumen', 'Asiento Resumen', ['asiento de ventas'], 'el asiento contable del mes que se envía al Libro Diario'], ['01', 'importar', 'Importar Masivo', ['importar ventas', 'subir excel de ventas'], 'subir muchas ventas de una vez desde Excel'],
    ['02', 'dashboard', 'Panel General', [], 'el resumen de tus compras del mes'], ['02', 'registro', 'Registro de Compras', ['lista de compras', 'ver mis compras', 'compras del mes'], 'la lista de tus facturas de compra'],
    ['02', 'importar', 'Importar Masivo', ['importar compras', 'subir excel de compras'], 'subir muchas compras de una vez desde Excel'], ['02', 'proveedores', 'Proveedores', ['maestro de proveedores', 'agregar proveedor'], 'tus proveedores con su RUC y datos'],
    ['02', 'resumen', 'Asiento Resumen', ['asiento de compras'], 'el asiento contable de tus compras del mes'], ['02', 'shortcuts', 'Registrar Compra', ['nueva compra', 'anotar una factura', 'registrar una compra', 'registrar factura de compra'], 'registrar una factura de compra'],
    ['03', 'dashboard', 'Panel General', [], 'el saldo de caja y bancos del mes'], ['03', 'registro', 'Movimientos', ['movimientos de caja', 'ver movimientos'], 'todos los movimientos de caja y bancos'],
    ['03', 'resumen', 'Asiento Resumen', ['asiento de caja'], 'el asiento contable de caja y bancos'], ['03', 'conciliacion', 'Conciliación Bancaria', ['conciliar banco', 'estado de cuenta del banco'], 'comparar tu libro contra el estado de cuenta del banco'],
    ['03', 'shortcuts', 'Registrar Movimiento', ['pago de alquiler', 'registrar gasto', 'registrar un pago', 'prestamo', 'comision del banco'], 'anotar un pago, un aporte, un préstamo o una comisión'],
    ['04', 'dashboard', 'Panel General', ['cierre de mes'], 'el resumen contable y el control de cierre de mes'], ['04', 'shortcuts', 'Registrar Asiento', ['nuevo asiento', 'crear asiento', 'asiento manual', 'asientos por recibir'], 'registrar un asiento contable o cargar los que llegan de otros módulos'],
    ['04', 'diario', 'Libro Diario', ['lista de asientos', 'editar asiento', 'anular asiento'], 'ver, editar o anular tus asientos'], ['04', 'gastosreparados', 'Gastos Reparados', ['gasto reparado', 'sin comprobante', '65999'], 'gastos sin comprobante válido'],
    ['04', 'mayor', 'Libro Mayor', ['movimientos de una cuenta'], 'los movimientos y el saldo de cada cuenta'], ['04', 'balancecomp', 'Balance de Comprobación', ['sumas y saldos'], 'sumas y saldos de todas tus cuentas'],
    ['04', 'situacion', 'Situación Financiera', ['balance general', 'activo pasivo patrimonio'], 'el balance general: activos, pasivos y patrimonio'], ['04', 'notaseeff', 'Notas a los EEFF', ['notas a los estados financieros'], 'las notas explicativas de tus estados financieros'],
    ['04', 'resultados', 'Estado de Resultados', ['ganancias y perdidas', 'utilidad', 'cuanto gane'], 'cuánto ganaste o perdiste en el mes'], ['04', 'patrimonio', 'Cambios en el Patrimonio', [], 'cómo cambió tu patrimonio'],
    ['04', 'flujoefectivo', 'Flujo de Efectivo', ['de donde salio la plata'], 'de dónde vino y a dónde fue tu dinero'], ['04', 'flujocaja', 'Flujo de Caja', ['proyeccion de caja', 'proyectar'], 'una proyección de tu dinero para los próximos meses'],
    ['04', 'informe', 'Informe Gerencial', ['ratios', 'indicadores financieros'], 'un informe con ratios para decidir'], ['04', 'puntoequilibrio', 'Punto de Equilibrio', ['equilibrio', 'margen de seguridad', 'ventas minimas', 'cuanto debo vender', 'cubrir mis gastos'], 'cuánto debes vender al mes para cubrir tus gastos'],
    ['04', 'impuestos', 'Impuestos', ['igv', 'renta', 'pdt 621', 'declarar', 'pago a cuenta'], 'el IGV y la Renta del mes para tu declaración'], ['04', 'consultas', 'Consultas al Sistema', ['chat del libro diario'], 'el chat contable del Libro Diario'],
    ['04', 'nicniif', 'NIC y NIIF', ['normas contables'], 'una guía de las normas contables'], ['04', 'almacen', 'Almacén', ['existencias para el cierre'], 'la valorización de existencias para el cierre'],
    ['05', 'dashboard', 'Panel General', [], 'el resumen de tu planilla'], ['05', 'ficha', 'Ficha del Personal', ['agregar trabajador', 'nuevo trabajador', 'datos del trabajador', 'registrar trabajador'], 'los datos de cada trabajador'],
    ['05', 'contratos', 'Contratos Laborales', ['contrato de trabajo'], 'los contratos de tus trabajadores'], ['05', 'locadores', 'Locadores de Servicios', ['honorarios', 'independientes'], 'tus locadores de servicios independientes'],
    ['05', 'planilla', 'Planilla Mensual', ['calcular planilla', 'sueldos del mes', 'pagar sueldos'], 'calcular la planilla del mes'], ['05', 'rxh', 'Recibos por Honorarios', ['renta de cuarta', 'cuarta categoria'], 'recibos por honorarios de locadores'],
    ['05', 'renta5ta', '5ta. Categoría', ['renta de quinta', 'impuesto a la renta del trabajador'], 'la Renta de 5ta categoría de tus trabajadores'], ['05', 'boletas', 'Boletas de Pago', ['imprimir boletas', 'boleta de pago'], 'generar e imprimir boletas de pago'],
    ['05', 'vacaciones', 'Vacaciones', ['dias de descanso'], 'las vacaciones acumuladas y gozadas'], ['05', 'cts', 'CTS', ['compensacion por tiempo de servicios', 'deposito de cts'], 'el depósito semestral de CTS'],
    ['05', 'gratificacion', 'Gratificación', ['gratificaciones', 'fiestas patrias', 'navidad', 'bonificacion extraordinaria'], 'la gratificación de julio y diciembre'], ['05', 'liquidacion', 'Liquidaciones', ['beneficios sociales', 'cese de trabajador', 'despedir', 'liquidar'], 'la liquidación al cesar a un trabajador'],
    ['06', 'dashboard', 'Panel General', [], 'el resumen de tus activos'], ['06', 'registro', 'Registro de Activos', ['agregar activo', 'nuevo activo', 'comprar un activo', 'registrar un activo'], 'registrar tus equipos, muebles y vehículos'],
    ['06', 'depreciacion', 'Depreciación Mensual', ['depreciar', 'calcular depreciacion'], 'calcular la depreciación del mes'], ['06', 'bajas', 'Bajas / Ventas', ['dar de baja', 'vender un activo', 'baja de activo'], 'dar de baja o vender un activo'],
    ['07', 'importar', 'Importar Datos', ['cargar datos', 'subir archivos'], 'cargar los datos de los otros módulos'], ['07', 'diario', 'Libro Diario', [], 'el libro diario en formato de reporte'], ['07', 'mayor', 'Libro Mayor', [], 'el libro mayor en formato de reporte'],
    ['07', 'ventas', 'Reg. Ventas', ['registro de ventas sunat', 'sire ventas'], 'el registro de ventas consolidado'], ['07', 'compras', 'Reg. Compras', ['registro de compras sunat', 'sire compras'], 'el registro de compras consolidado'],
    ['07', 'analisis', 'Análisis de Cuenta', [], 'analizar una cuenta contable'], ['07', 'balancecomp', 'Balance de Comprobación', ['sumas y saldos'], 'el balance de comprobación'], ['07', 'situacion', 'Situación Financiera', ['balance general'], 'el balance general'],
    ['07', 'existencias', 'Existencias', [], 'las existencias valorizadas'], ['07', 'notaseeff', 'Notas a los EEFF', [], 'las notas a los estados financieros'], ['07', 'resultados', 'Estado de Resultados', ['utilidad', 'ganancias y perdidas'], 'el estado de resultados'],
    ['07', 'patrimonio', 'Cambios en el Patrimonio', [], 'los cambios en el patrimonio'], ['07', 'informe', 'Informe Gerencial', ['ratios'], 'el informe gerencial'], ['07', 'puntoequilibrio', 'Punto de Equilibrio', ['equilibrio'], 'el punto de equilibrio'],
    ['07', 'flujocaja', 'Flujo de Efectivo', [], 'el flujo de efectivo'], ['07', 'flujocajaproy', 'Flujo de Caja', ['proyeccion'], 'el flujo de caja proyectado'], ['07', 'impuestos', 'Impuestos', ['igv', 'renta', 'pdt 621'], 'los impuestos del mes'],
    ['07', 'resumendia', 'Resumen del Día', ['resumen diario', 'cuanto vendi hoy'], 'el resumen de lo que pasó en el día'], ['07', 'dashventas', 'Dashboard Ventas', ['grafico de ventas'], 'gráficos de tus ventas'], ['07', 'dashgastos', 'Dashboard Gastos', ['grafico de gastos'], 'gráficos de tus gastos'],
    ['07', 'cxc', 'Cuentas por Cobrar', ['clientes me deben', 'quien me debe', 'facturas pendientes de cobro'], 'lo que te deben tus clientes, con vencimientos'], ['07', 'cxp', 'Cuentas por Pagar', ['debo a proveedores', 'facturas pendientes de pago'], 'lo que debes a tus proveedores, con vencimientos'],
    ['07', 'general', 'Reporte General', ['reporte completo'], 'un reporte general del negocio'], ['07', 'detracciones', 'Detracciones', ['spot', 'detraccion'], 'las detracciones pendientes de depositar'],
    ['07', 'djmensual', 'DJ Mensual', ['declaracion jurada mensual', 'pdt 621', 'plame'], 'la declaración jurada mensual'], ['07', 'djanual', 'DJ Anual', ['declaracion jurada anual', 'renta anual'], 'la declaración jurada anual de Renta'],
    ['07', 'auditoria', 'Auditoría', [], 'la auditoría dentro de Reportes'],
    ['08', 'importar', 'Importar Datos', [], 'cargar los datos a auditar'], ['08', 'ajustes', 'Parámetros de Auditoría', ['mes a auditar', 'tolerancia'], 'elegir el mes y los límites de la revisión'],
    ['08', 'procedimientos', 'Procedimientos', ['ejecutar auditoria', 'hallazgos'], 'ejecutar las 9 revisiones automáticas'], ['08', 'informe', 'Informe de Auditoría', ['exportar auditoria'], 'el informe final de la auditoría'],
    ['09', 'dashboard', 'Panel General', [], 'el resumen de tu inventario'], ['09', 'kardex', 'Kardex', ['kardex valorizado', 'entradas y salidas'], 'las entradas y salidas de cada producto, valorizadas'],
    ['09', 'importar', 'Importar', ['importar productos'], 'importar movimientos y productos'], ['09', 'ajuste', 'Ajuste Manual', ['corregir stock', 'merma', 'ajustar inventario'], 'corregir el stock a mano'],
    ['09', 'cierre', 'Cierre Contable', ['valorizacion de inventario', 'exportar para contabilidad'], 'valorizar tu inventario al cierre del mes'], ['09', 'reportes', 'Reportes', ['reporte de stock'], 'reportes de inventario'],
    ['01', 'settings', 'Ajustes', ['tipo de cambio', 'dolares', 'tc sunat', 'tipo de cambio automatico'], 'el tipo de cambio (puede ser automático de SUNAT), la tasa de IGV y los datos de la empresa'], ['02', 'settings', 'Ajustes', ['tipo de cambio', 'dolares'], 'el tipo de cambio y los datos de la empresa'], ['03', 'settings', 'Ajustes', ['tipo de cambio', 'dolares'], 'el tipo de cambio y los datos de la empresa'],
    ['*', 'seguridad', 'Seguridad', ['respaldo', 'copia de seguridad', 'backup', 'bitacora', 'quien cambio'], 'tu copia de respaldo y el historial de cambios'], ['*', 'alertas', 'Alertas', ['avisos', 'pendientes'], 'avisos de cosas por revisar'],
    ['*', 'settings', 'Ajustes', ['configuracion', 'regimen tributario', 'datos de la empresa', 'tasa de igv', 'plan de cuentas'], 'la configuración de la empresa y del módulo']
  ];
  const TABS = T.map(t => ({ m: t[0], id: t[1], nombre: t[2], claves: [t[2]].concat(t[3]), desc: t[4] }));
  const FAQ = [
    { k: ['como empiezo', 'por donde empiezo', 'primeros pasos', 'primera vez', 'no se usar'], r: 'Empieza por <b>01 Ventas</b> y <b>02 Compras</b>, sigue con <b>03 Caja y Bancos</b> y <b>04 Libro Diario</b>, y mira tu balance en <b>07 Reportes</b>. En el Libro Diario, "Asientos por recibir" trae solos los resúmenes de los otros módulos.', a: [{ mod: '01', label: 'Ir a Registro de Ventas' }] },
    { k: ['que modulos hay', 'cuantos modulos', 'que puede hacer', 'para que sirve mypecar', 'que es mypecar'], r: 'MYPECAR PLUS tiene 9 módulos que trabajan juntos: <b>01 Ventas, 02 Compras, 03 Caja y Bancos, 04 Libro Diario, 05 Personal, 06 Activos Fijos, 07 Reportes, 08 Auditoría y 09 Inventario</b>. Registras una vez y la información fluye sola al Libro Diario y a los reportes. Dime qué quieres hacer y te llevo.' },
    { k: ['precio', 'cuanto cuesta', 'plan mensual', 'planes', 'cuanto pago', 'costo de mypecar'], r: 'El plan mensual cuesta <b>S/ 59 con IGV incluido</b>, y puedes probarlo 14 días gratis sin tarjeta. Los planes anual y para estudios contables están en la página principal.' },
    { k: ['soporte', 'ayuda humana', 'hablar con alguien', 'whatsapp', 'contacto', 'reclamo'], r: 'Puedes escribirnos por WhatsApp desde el botón verde de la página principal (mypecar.net.pe).' },
    { k: ['cambiar de empresa', 'otra empresa', 'cambiar empresa', 'agregar empresa'], r: 'Para cambiar de empresa, usa el nombre de la empresa en la parte de arriba (menú de empresa). Cada empresa ve solo sus propios datos.' },
    { k: ['tutorial', 'video', 'videos', 'ver ejemplo'], r: 'Tenemos un video corto por cada módulo y uno general: <b>mypecar.net.pe/tutoriales.html</b>.', a: [{ url: 'tutoriales.html', label: 'Ver tutoriales en video' }] },
    { k: ['mis datos estan seguros', 'seguridad de mis datos', 'privacidad'], r: 'Cada empresa ve únicamente sus propios datos y todo se guarda en la nube con respaldo del dispositivo. Puedes dar acceso a tu contador desde Ajustes.' }
  ];

  // ---------------------------------------------------------------- utilidades de lenguaje
  const STOP = new Set(['que', 'del', 'los', 'las', 'por', 'para', 'con', 'una', 'como', 'cual', 'cuales', 'el', 'la', 'de', 'en', 'y', 'o', 'un', 'al', 'se', 'su', 'es', 'mi', 'me', 'lo', 'mis', 'quiero', 'puedo', 'hay', 'donde', 'dime']);
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:()"]/g, ' ').replace(/\s+/g, ' ').trim();
  const raiz = w => { w = norm(w); return w.length > 5 ? w.replace(/(ciones|cion|mente|ando|iendo|ados|adas|idos|idas|es|s|ado|ada|ido|ida|ar|er|ir)$/, '') : w.replace(/(es|s)$/, ''); };
  const toks = t => norm(t).split(' ').filter(w => w.length > 1 && !STOP.has(w)).map(raiz);
  function casi(a, b) { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, d = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; } } return d + (a.length - i) + (b.length - j) <= 1; }
  const igual = (p, k) => p === k || (k.length >= 5 && p.length >= 5 && casi(p, k)) || (k.length >= 4 && p.length >= 4 && (p.startsWith(k) || k.startsWith(p)));
  function frasePresente(frase, raices) { const rc = toks(frase); if (!rc.length) return 0; return rc.every(k => raices.some(r => igual(r, k))) ? rc.length * 2 + (rc.length > 1 ? 1 : 0) : 0; }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  // Solo se permiten estas etiquetas; todo lo demás se escapa (las respuestas del motor del 04 incluyen nombres de cuentas).
  const limpiar = h => esc(h).replace(/&lt;(\/?)(b|br|strong|i|ul|ol|li)\s*\/?&gt;/gi, '<$1$2>');
  const soles = n => 'S/ ' + (Math.round((+n || 0) * 100) / 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------------------------------------------------------------- contexto: módulo actual, periodo
  function moduloActual() {
    const m = decodeURIComponent(location.pathname).match(/108 (0\d)/);
    return m ? m[1] : null;
  }
  function periodoHoy() { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function periodoDeTexto(txt) {
    const t = norm(txt); const base = periodoHoy(); const anioBase = +base.slice(0, 4);
    const ym = t.match(/\b(20\d\d)\b/);
    for (let i = 0; i < 12; i++) {
      const nom = MESES[i]; if (t.includes(nom) || (i === 8 && t.includes('septiembre'))) return (ym ? ym[1] : anioBase) + '-' + String(i + 1).padStart(2, '0');
    }
    if (/\bmes pasado\b|\bmes anterior\b/.test(t)) { let y = +base.slice(0, 4), m = +base.slice(5) - 1; if (m < 1) { m = 12; y--; } return y + '-' + String(m).padStart(2, '0'); }
    return null;
  }
  const etiquetaPeriodo = p => MESES[+p.slice(5) - 1] + ' ' + p.slice(0, 4);

  // ---------------------------------------------------------------- datos de la empresa (fotos de la nube)
  const cache = {};
  async function foto(app, tipo) {
    const S = window.MypecarSync; if (!S || !S.enlace) return null;
    tipo = tipo || 'reportes'; const k = app + '|' + tipo;
    const hit = cache[k]; if (hit && Date.now() - hit.t < 45000) return hit.v;
    let v = null; try { v = await S.enlace.leer(app, tipo); } catch (e) {}
    cache[k] = { t: Date.now(), v }; return v;
  }
  function datosPeriodo(f, clave, periodo) { const pd = f && f.payload && f.payload.periodsData; const x = pd && pd[periodo] && pd[periodo][clave]; return Array.isArray(x) ? x : []; }
  const num = x => { const n = parseFloat(x); return isFinite(n) ? n : 0; };
  const pendienteVenta = v => v.tipoDoc !== '07' && String(v.estadoCobro || '').toLowerCase() !== 'cobrado' && String(v.estadoCobro || '').toLowerCase() !== 'anulado';
  const pendienteCompra = c => c.tipoDoc !== '07' && String(c.estadoPago || '').toLowerCase() !== 'pagado' && String(c.estadoPago || '').toLowerCase() !== 'anulado';
  const hace = f => { try { const m = Math.round((Date.now() - new Date(f.actualizado_en).getTime()) / 60000); return m < 2 ? 'hace un momento' : m < 90 ? 'hace ' + m + ' min' : m < 2880 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' días'; } catch (e) { return ''; } };
  const SIN_DATOS = mod => `Todavía no veo datos de <b>${mod.nombre}</b> en la nube para esta empresa. Registra algo en ese módulo (y espera unos segundos a que se guarde), y vuelve a preguntarme.`;

  async function datosVentas(p) {
    const f = await foto('ventas'); const mod = MODULOS[0]; if (!f) return { html: SIN_DATOS(mod), a: [{ mod: '01', label: 'Ir a Registro de Ventas' }] };
    const L = datosPeriodo(f, 'sales', p); if (!L.length) return { html: `No encontré ventas registradas en <b>${etiquetaPeriodo(p)}</b>. (Datos guardados ${hace(f)}.)` };
    let total = 0, igv = 0, base = 0; L.forEach(v => { const s = v.tipoDoc === '07' ? -1 : 1; total += num(v.total) * s; igv += num(v.igv) * s; base += (num(v.baseGravada) + num(v.baseNoGravada)) * s; });
    return { html: `Ventas de <b>${etiquetaPeriodo(p)}</b>: <b>${soles(total)}</b> en total (${soles(base)} + IGV ${soles(igv)}), en ${L.length} comprobante${L.length === 1 ? '' : 's'}.<br><i>Datos guardados ${hace(f)}.</i>`, a: [{ mod: '01', tab: 'registro', label: 'Ver mis ventas' }] };
  }
  async function datosCompras(p) {
    const f = await foto('compras'); const mod = MODULOS[1]; if (!f) return { html: SIN_DATOS(mod), a: [{ mod: '02', label: 'Ir a Registro de Compras' }] };
    const L = datosPeriodo(f, 'purchases', p); if (!L.length) return { html: `No encontré compras registradas en <b>${etiquetaPeriodo(p)}</b>. (Datos guardados ${hace(f)}.)` };
    let total = 0, igv = 0, base = 0; L.forEach(c => { const s = c.tipoDoc === '07' ? -1 : 1; total += num(c.total) * s; igv += num(c.igv) * s; base += (num(c.baseGravada) + num(c.baseNoGravada)) * s; });
    return { html: `Compras de <b>${etiquetaPeriodo(p)}</b>: <b>${soles(total)}</b> en total (${soles(base)} + IGV ${soles(igv)}), en ${L.length} comprobante${L.length === 1 ? '' : 's'}.<br><i>Datos guardados ${hace(f)}.</i>`, a: [{ mod: '02', tab: 'registro', label: 'Ver mis compras' }] };
  }
  async function datosIgv(p) {
    const [fv, fc] = [await foto('ventas'), await foto('compras')];
    if (!fv && !fc) return { html: 'Para calcular tu IGV necesito ver tus ventas y compras guardadas en la nube. Aún no encuentro datos.', a: [{ mod: '04', tab: 'impuestos', label: 'Abrir Impuestos (Libro Diario)' }] };
    let igvV = 0, igvC = 0;
    datosPeriodo(fv, 'sales', p).forEach(v => igvV += num(v.igv) * (v.tipoDoc === '07' ? -1 : 1));
    datosPeriodo(fc, 'purchases', p).forEach(c => igvC += num(c.igv) * (c.tipoDoc === '07' ? -1 : 1));
    const dif = igvV - igvC;
    return { html: `IGV de <b>${etiquetaPeriodo(p)}</b> (aproximado): ventas ${soles(igvV)} − compras ${soles(igvC)} = <b>${dif >= 0 ? soles(dif) + ' por pagar' : soles(-dif) + ' a favor (crédito fiscal)'}</b>.<br><b>⚠ Es solo un cálculo aproximado.</b> Para declarar, usa el cálculo oficial en <b>Impuestos</b> del Libro Diario.`, a: [{ mod: '04', tab: 'impuestos', label: 'Abrir Impuestos' }] };
  }
  async function datosPorCobrar() {
    const f = await foto('ventas'); if (!f) return { html: SIN_DATOS(MODULOS[0]), a: [{ mod: '07', tab: 'cxc', label: 'Abrir Cuentas por Cobrar' }] };
    const pd = f.payload.periodsData || {}; let tot = 0, n = 0, clientes = {};
    Object.keys(pd).forEach(p => (pd[p].sales || []).filter(pendienteVenta).forEach(v => { tot += num(v.montoNetoPendiente != null ? v.montoNetoPendiente : v.total); n++; const k = v.clienteRazonSocial || v.clienteRuc || 'Sin nombre'; clientes[k] = (clientes[k] || 0) + num(v.total); }));
    if (!n) return { html: 'No veo ventas pendientes de cobro. ¡Todo cobrado!' };
    const top = Object.entries(clientes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => `• ${esc(e[0])}: ${soles(e[1])}`).join('<br>');
    return { html: `Te deben aproximadamente <b>${soles(tot)}</b> en ${n} comprobante${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} de cobro.<br>Los que más deben:<br>${top}<br><i>Datos guardados ${hace(f)}.</i>`, a: [{ mod: '07', tab: 'cxc', label: 'Abrir Cuentas por Cobrar' }] };
  }
  async function datosPorPagar() {
    const f = await foto('compras'); if (!f) return { html: SIN_DATOS(MODULOS[1]), a: [{ mod: '07', tab: 'cxp', label: 'Abrir Cuentas por Pagar' }] };
    const pd = f.payload.periodsData || {}; let tot = 0, n = 0, provs = {};
    Object.keys(pd).forEach(p => (pd[p].purchases || []).filter(pendienteCompra).forEach(c => { tot += num(c.montoNetoPendiente != null ? c.montoNetoPendiente : c.total); n++; const k = c.proveedorRazonSocial || c.proveedorRuc || 'Sin nombre'; provs[k] = (provs[k] || 0) + num(c.total); }));
    if (!n) return { html: 'No veo compras pendientes de pago.' };
    const top = Object.entries(provs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => `• ${esc(e[0])}: ${soles(e[1])}`).join('<br>');
    return { html: `Debes aproximadamente <b>${soles(tot)}</b> en ${n} comprobante${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} de pago.<br>Los que más debes:<br>${top}<br><i>Datos guardados ${hace(f)}.</i>`, a: [{ mod: '07', tab: 'cxp', label: 'Abrir Cuentas por Pagar' }] };
  }
  async function datosPersonal() {
    const f = await foto('personal', 'resumen'); const r = f && f.payload;
    if (!r) return { html: 'Todavía no veo datos de <b>Personal y Planilla</b> en la nube. Abre el módulo 05 una vez (con tus trabajadores registrados), espera unos segundos y vuelve a preguntarme.', a: [{ mod: '05', label: 'Ir a Personal y Planilla' }] };
    const pl = r.planilla || {};
    return { html: `Tienes <b>${r.trabajadoresActivos}</b> trabajador${r.trabajadoresActivos === 1 ? '' : 'es'} activo${r.trabajadoresActivos === 1 ? '' : 's'}.<br>Planilla de <b>${etiquetaPeriodo(r.periodo)}</b> (${r.trabajadoresEnPlanilla} en planilla): ingresos ${soles(pl.ingresos)}, descuentos ${soles(pl.descuentos)}, <b>neto a pagar ${soles(pl.neto)}</b>. Costo total para la empresa: ${soles(pl.costoEmpleador)}.<br><i>Datos guardados ${hace(f)}.</i>`, a: [{ mod: '05', tab: 'planilla', label: 'Abrir Planilla Mensual' }] };
  }
  async function datosActivos() {
    const f = await foto('activos', 'resumen'); const r = f && f.payload;
    if (!r) return { html: 'Todavía no veo datos de <b>Activos Fijos</b> en la nube. Abre el módulo 06 una vez (con tus activos registrados), espera unos segundos y vuelve a preguntarme.', a: [{ mod: '06', label: 'Ir a Activos Fijos' }] };
    return { html: `Tienes <b>${r.cantidad}</b> activo${r.cantidad === 1 ? '' : 's'} fijo${r.cantidad === 1 ? '' : 's'}: costo ${soles(r.costoTotal)}, depreciación acumulada ${soles(r.depreciacionAcumulada)}, <b>valor neto ${soles(r.valorNeto)}</b>.<br>Depreciación de ${etiquetaPeriodo(r.periodo)}: <b>${soles(r.depreciacionDelMes)}</b>.<br><i>Datos guardados ${hace(f)}.</i>`, a: [{ mod: '06', tab: 'depreciacion', label: 'Abrir Depreciación Mensual' }] };
  }
  async function datosInventario(soloBajos) {
    const f = await foto('inventario', 'resumen'); const r = f && f.payload;
    if (!r) return { html: 'Todavía no veo datos de <b>Inventario</b> en la nube. Abre el módulo 09 una vez (con tus productos), espera unos segundos y vuelve a preguntarme.', a: [{ mod: '09', label: 'Ir a Inventario' }] };
    const bajos = (r.bajoMinimo || []).map(b => `• ${esc(b.nombre)}: ${b.stock} ${esc(b.unidad)} (mínimo ${b.minimo})`).join('<br>');
    const aviso = bajos ? `<br><b>Con poco stock:</b><br>${bajos}` : '<br>Ningún producto está por debajo de su stock mínimo.';
    return { html: (soloBajos ? '' : `Tu inventario vale <b>${soles(r.valorTotal)}</b> (método ${esc(r.metodo)}), con ${r.productos} producto${r.productos === 1 ? '' : 's'}.`) + aviso + `<br><i>Datos guardados ${hace(f)}.</i>`, a: [{ mod: '09', tab: 'kardex', label: 'Abrir Kardex' }] };
  }
  const INTENCIONES_DATOS = [
    { id: 'personal', k: ['cuantos trabajadores', 'mis trabajadores', 'cuanto pago de planilla', 'planilla del mes', 'cuanto cuesta mi planilla', 'cuanto pago a mis trabajadores', 'total de planilla', 'cuantos empleados'], f: () => datosPersonal() },
    { id: 'activos', k: ['cuanto valen mis activos', 'mis activos', 'valor de mis activos', 'depreciacion del mes', 'cuanto deprecio', 'cuantos activos'], f: () => datosActivos() },
    { id: 'inventario', k: ['valor de mi inventario', 'cuanto vale mi inventario', 'valor del inventario', 'mi inventario', 'valor de mi stock'], f: () => datosInventario(false) },
    { id: 'stockbajo', k: ['poco stock', 'stock bajo', 'productos por agotarse', 'que debo reponer', 'que reponer', 'stock minimo', 'se me acaba'], f: () => datosInventario(true) },
    { id: 'porcobrar', k: ['quien me debe', 'me deben', 'clientes me deben', 'cuanto me deben', 'por cobrar', 'pendiente de cobro', 'pendientes de cobro'], f: () => datosPorCobrar() },
    { id: 'porpagar', k: ['cuanto debo a', 'debo a proveedores', 'por pagar', 'pendiente de pago', 'pendientes de pago', 'le debo'], f: () => datosPorPagar() },
    { id: 'igv', k: ['cuanto debo de igv', 'igv a pagar', 'cuanto igv', 'pagar de igv', 'mi igv', 'el igv'], f: p => datosIgv(p) },
    { id: 'ventas', k: ['cuanto vendi', 'cuanto vendo', 'total de ventas', 'mis ventas', 'ventas del mes', 'ventas de', 'cuanto se vendio', 'vendi en'], f: p => datosVentas(p) },
    { id: 'compras', k: ['cuanto compre', 'total de compras', 'mis compras', 'compras del mes', 'compras de', 'cuanto gaste en compras', 'compre en'], f: p => datosCompras(p) }
  ];
  let ultima = null; // { id, texto }

  // ---------------------------------------------------------------- cerebro
  function puntuarTabs(txt) {
    const r = toks(txt); const modActual = moduloActual(); const res = [];
    for (const t of TABS) {
      let p = 0; t.claves.forEach(c => { p = Math.max(p, frasePresente(c, r)); });
      if (!p) continue;
      const mods = t.m === '*' ? [modActual || '01'] : [t.m];
      mods.forEach(m => {
        const mod = MODULOS.find(x => x.n === m); let pp = p;
        if (mod && mod.claves.some(c => frasePresente(c, r) > 0 && toks(c).length)) pp += 1; // nombraron el módulo
        if (m === modActual) pp += 0.5; // desempate: el módulo donde estás
        res.push({ t, m, p: pp });
      });
    }
    return res.sort((a, b) => b.p - a.p);
  }
  function accionPestana(x) { return { mod: x.m, tab: x.t.id, label: 'Abrir ' + x.t.nombre + (x.m !== moduloActual() ? ' (' + (MODULOS.find(m => m.n === x.m) || {}).nombre + ')' : '') }; }
  function respuestaNav(lista) {
    const mejor = lista[0]; const mod = MODULOS.find(m => m.n === mejor.m);
    const otras = lista.filter(x => x !== mejor && x.p >= mejor.p - 0.5 && !(x.m === mejor.m && x.t.id === mejor.t.id)).slice(0, 2);
    const trozo = x => `<b>${esc(x.t.nombre)}</b> (módulo ${x.m} ${esc((MODULOS.find(m => m.n === x.m) || {}).nombre)}): ${esc(x.t.desc)}.`;
    return { html: (otras.length ? 'Encontré esto:<br>• ' + [mejor].concat(otras).map(trozo).join('<br>• ') : trozo(mejor)), a: [mejor].concat(otras).map(accionPestana) };
  }
  function buscarFaq(txt) { const r = toks(txt); let mejor = null, mp = 0; FAQ.forEach(f => f.k.forEach(k => { const p = frasePresente(k, r); if (p > mp) { mp = p; mejor = f; } })); return mp >= 2 ? mejor : null; }
  function buscarModulo(txt) {
    const r = toks(txt); let mejor = null, mp = 0;
    MODULOS.forEach(m => { const p = Math.max(frasePresente(m.nombre, r), ...m.claves.map(c => frasePresente(c, r))); if (p > mp) { mp = p; mejor = m; } });
    return mp >= 2 ? mejor : null;
  }

  async function responder(textoOriginal) {
    const txt = norm(textoOriginal); const r = toks(txt); const periodo = periodoDeTexto(txt) || periodoHoy();
    if (/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey)\b/.test(txt) && txt.split(' ').length <= 4) return { html: '¡Hola! Soy el asistente de MYPECAR PLUS. Pregúntame dónde está algo en cualquier módulo, o por los números de tu empresa (ventas, compras, IGV, quién te debe).' };
    if (/^(gracias|muchas gracias|ok gracias|listo gracias|genial|perfecto)\b/.test(txt)) return { html: '¡Con gusto! Aquí estoy si necesitas algo más.' };

    if (/\b(datos|data)\b.*\b(ejemplo|demo|prueba)\b|\b(ejemplo|demo)\b.*\bdatos\b/.test(txt) && window.MypecarDemo) {
      if (/\b(quita|quitar|borra|borrar|saca|sacar|elimina|eliminar|sin)\b/.test(txt)) return { html: 'Con este botón se quitan los datos de ejemplo de esta empresa. No se borra nada tuyo: los ejemplos nunca se guardaron.', a: [{ demo: 'quitar', label: 'Quitar datos de ejemplo' }] };
      return { html: 'Puedo mostrarte datos de ejemplo (ficticios) en los módulos que estén vacíos, solo en pantalla: no se guardan ni afectan tu contabilidad, y los quitas con un clic.', a: [{ demo: 'activar', label: 'Cargar datos de ejemplo' }] };
    }
    // 1) Datos de la empresa
    let mejor = null, mp = 0; INTENCIONES_DATOS.forEach(i => i.k.forEach(k => { const p = frasePresente(k, r); if (p > mp) { mp = p; mejor = i; } }));
    if (mejor && mp >= 4) { ultima = { id: mejor.id, texto: textoOriginal }; return await mejor.f(periodo); }
    // Seguimiento corto: "¿y en octubre?" repite la última pregunta de datos
    if (ultima && txt.split(' ').length <= 5 && (/^y\b/.test(txt) || periodoDeTexto(txt))) { const i = INTENCIONES_DATOS.find(x => x.id === ultima.id); if (i && periodoDeTexto(txt)) return await i.f(periodoDeTexto(txt)); }
    // Palabras sueltas de dinero
    if (/\b(vendi|ventas?)\b/.test(txt) && /\b(cuanto|total|mes)\b/.test(txt)) { ultima = { id: 'ventas', texto: textoOriginal }; return await datosVentas(periodo); }
    if (/\bigv\b/.test(txt) && /\b(cuanto|pagar|debo|toca)\b/.test(txt)) { ultima = { id: 'igv', texto: textoOriginal }; return await datosIgv(periodo); }

    // 2) Navegación: ¿en qué pestaña está lo que preguntan?
    const nav = puntuarTabs(txt);
    const preguntaDonde = /\b(donde|abrir|abre|ir a|llevame|llevar|encuentro|veo|ver|hacer|registrar|calcular|como)\b/.test(txt);
    if (nav.length && (preguntaDonde || nav[0].p >= 3)) return respuestaNav(nav);

    // 3) Motor contable del Libro Diario (solo existe en el 04): cifras de cuentas, utilidad, balance, NIC...
    if (typeof window.procesarConsulta === 'function') {
      try { const x = window.procesarConsulta(textoOriginal); if (typeof x === 'string' && !/No estoy seguro de haber entendido/.test(x)) return { html: limpiar(x.replace(/\[\[ir:([a-z]+)\|([^\]]{1,60})\]\]/g, '')) }; } catch (e) {}
    }
    // 4) Preguntas frecuentes y módulos
    const faq = buscarFaq(txt); if (faq) return { html: faq.r, a: faq.a };
    const mod = buscarModulo(txt);
    if (mod) return { html: `<b>${mod.n} ${esc(mod.nombre)}</b>: ${esc(mod.desc)}.`, a: [{ mod: mod.n, label: 'Abrir ' + mod.nombre }] };
    if (nav.length) return respuestaNav(nav);
    return { html: 'No estoy seguro de haber entendido. Prueba, por ejemplo:<br>• <i>¿Cuánto vendí este mes?</i><br>• <i>¿Quién me debe?</i><br>• <i>¿Dónde calculo la CTS?</i><br>• <i>¿Cómo registro una compra?</i><br>• <i>¿Cuánto debo de IGV?</i>' };
  }

  // ---------------------------------------------------------------- navegación
  function abrir(a) {
    const actual = moduloActual();
    if (a.url) { location.href = a.url; return; }
    if (a.demo && window.MypecarDemo) { window.MypecarDemo[a.demo](); return; }
    if (!a.mod || a.mod === actual) { if (a.tab && typeof window.switchTab === 'function') { try { window.switchTab(a.tab); cerrar(); } catch (e) {} } return; }
    const m = MODULOS.find(x => x.n === a.mod); if (!m) return;
    location.href = encodeURI(m.archivo) + (a.tab ? '?tab=' + a.tab : '');
  }
  // Llegada desde otro módulo con ?tab=
  (function () {
    const t = new URLSearchParams(location.search).get('tab'); if (!t || !/^[a-z0-9]+$/i.test(t)) return;
    let n = 0; const iv = setInterval(() => { n++; try { if (typeof window.switchTab === 'function' && document.getElementById('tab-' + t)) { window.switchTab(t); clearInterval(iv); } } catch (e) {} if (n > 40) clearInterval(iv); }, 500);
  })();

  // ---------------------------------------------------------------- interfaz
  let panel, lista, input, btn, historial = [];
  function cerrar() { if (panel) panel.style.display = 'none'; if (btn) btn.setAttribute('aria-expanded', 'false'); }
  function agregar(rol, html, acciones) {
    const fila = document.createElement('div'); fila.style.cssText = 'display:flex;margin:8px 0;' + (rol === 'u' ? 'justify-content:flex-end' : 'justify-content:flex-start');
    const b = document.createElement('div');
    b.style.cssText = 'max-width:88%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;' + (rol === 'u' ? 'background:#0f8f7f;color:#fff;border-bottom-right-radius:4px' : 'background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:4px');
    if (rol === 'u') b.textContent = html; else b.innerHTML = String(html).replace(/&lt;/g, '&lt;');
    (acciones || []).forEach(a => { const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = a.label + ' →'; bt.style.cssText = 'display:block;margin-top:8px;background:#0f8f7f;color:#fff;border:0;border-radius:10px;padding:8px 12px;font:600 13px inherit;cursor:pointer;text-align:left'; bt.onclick = () => abrir(a); b.appendChild(bt); });
    fila.appendChild(b); lista.appendChild(fila); lista.scrollTop = lista.scrollHeight;
  }
  async function enviar(texto) {
    texto = String(texto || '').trim(); if (!texto) return; input.value = '';
    agregar('u', texto);
    const sg = document.getElementById('mpa-sug'); if (sg) sg.style.display = 'none';
    const espera = document.createElement('div'); espera.style.cssText = 'color:#64748b;font-size:13px;margin:6px 0'; espera.textContent = 'Revisando…'; lista.appendChild(espera); lista.scrollTop = lista.scrollHeight;
    let r; try { r = await responder(texto); } catch (e) { r = { html: 'Tuve un problema al buscar eso. Intenta de nuevo en unos segundos.' }; }
    espera.remove(); agregar('s', r.html, r.a);
  }
  function construir() {
    if (document.getElementById('mpa-btn')) return;
    const css = document.createElement('style');
    css.textContent = '#mpa-btn{position:fixed;left:14px;bottom:14px;z-index:9000;background:#0f8f7f;color:#fff;border:0;border-radius:999px;padding:12px 16px;font:700 14px/1 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer;display:flex;gap:8px;align-items:center}#mpa-btn:hover{background:#0b7a6c}' +
      '#mpa-panel{position:fixed;left:14px;bottom:66px;z-index:9001;width:380px;max-width:calc(100vw - 28px);height:min(560px,calc(100vh - 100px));background:#f1f5f9;border-radius:18px;box-shadow:0 14px 40px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '#mpa-panel header{background:linear-gradient(135deg,#04231f,#0f8f7f);color:#fff;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;font-weight:700}#mpa-panel header button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:0 4px}' +
      '#mpa-lista{flex:1;overflow:auto;padding:8px 12px}#mpa-sug{display:flex;gap:6px;flex-wrap:wrap;padding:6px 12px}#mpa-sug button{background:#fff;border:1px solid #cbd5e1;color:#334155;border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer}' +
      '#mpa-form{display:flex;gap:8px;padding:10px;background:#fff;border-top:1px solid #e2e8f0}#mpa-form input{flex:1;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;font-size:16px;min-width:0}#mpa-form button{background:#0f8f7f;color:#fff;border:0;border-radius:12px;padding:0 16px;font-weight:700;cursor:pointer}' +
      '@media print{#mpa-btn,#mpa-panel{display:none!important}}';
    document.head.appendChild(css);
    btn = document.createElement('button'); btn.id = 'mpa-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Abrir el asistente de MYPECAR PLUS'); btn.setAttribute('aria-expanded', 'false'); btn.innerHTML = '<span aria-hidden="true">💬</span> Asistente';
    panel = document.createElement('div'); panel.id = 'mpa-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Asistente de MYPECAR PLUS');
    panel.innerHTML = '<header><span>Asistente MYPECAR</span><button type="button" aria-label="Cerrar asistente">×</button></header><div id="mpa-lista" aria-live="polite"></div><div id="mpa-sug"></div><form id="mpa-form"><input type="text" id="mpa-input" placeholder="Pregúntame lo que necesites…" aria-label="Escribe tu pregunta" autocomplete="off" maxlength="300"><button type="submit">Enviar</button></form>';
    document.body.appendChild(panel); document.body.appendChild(btn);
    lista = panel.querySelector('#mpa-lista'); input = panel.querySelector('#mpa-input');
    panel.querySelector('header button').onclick = cerrar;
    panel.querySelector('#mpa-form').addEventListener('submit', e => { e.preventDefault(); enviar(input.value); });
    const sug = ['¿Cuánto vendí este mes?', '¿Quién me debe?', '¿Cuánto debo de IGV?', '¿Cuánto pago de planilla?', '¿Qué productos tienen poco stock?'];
    const cont = panel.querySelector('#mpa-sug'); sug.forEach(s => { const b = document.createElement('button'); b.type = 'button'; b.textContent = s; b.onclick = () => enviar(s); cont.appendChild(b); });
    btn.onclick = () => {
      const abierto = panel.style.display === 'flex'; panel.style.display = abierto ? 'none' : 'flex'; btn.setAttribute('aria-expanded', String(!abierto));
      if (!abierto) { if (!lista.children.length) agregar('s', '¡Hola! Soy el asistente de MYPECAR PLUS. Te digo <b>dónde está cada cosa</b> en los 9 módulos y te respondo con los <b>números de tu empresa</b>. ¿Qué necesitas?'); setTimeout(() => input.focus(), 50); }
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
  }
  function iniciar() { if (/legal|index|admin|calculadora|ayuda|tutoriales|modulos/.test(location.pathname) && !moduloActual()) return; construir(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  window.MypecarAsistente = { responder };
})();
