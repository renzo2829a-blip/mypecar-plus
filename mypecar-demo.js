/* MYPECAR PLUS — Datos de ejemplo para empresas nuevas (2026-11-25)
 *
 * Una empresa recién creada no se muestra en blanco con ceros: cada módulo vacío se llena, SOLO EN LA PANTALLA,
 * con datos de ejemplo de una empresa ficticia. Un aviso arriba permite "Quitar datos de ejemplo" con un clic.
 *
 * Garantía de diseño: los datos de ejemplo NUNCA se guardan. Cada registro de ejemplo lleva la marca esDemo:true y
 * mypecar-sync.js (escribirTexto / enlace.publicar) los descarta antes de escribir en el equipo o en la nube.
 * Quitarlos = recargar la página. No se borra nada de la base de datos porque nunca estuvieron en ella.
 *
 * Cuándo aparecen: solo si la empresa se acaba de crear en ESTE equipo (mypecar-sync marca mpdemo_<empresa>=on)
 * o si el usuario lo pide ("cargar datos de ejemplo" al Asistente), y solo en los módulos que están vacíos.
 */
(function () {
  'use strict';
  if (window.__mypecarDemo) return;
  window.__mypecarDemo = true;

  const m = decodeURIComponent(location.pathname).match(/108 (0\d)/);
  const MOD = m ? m[1] : null;
  if (!MOD) return;

  const empresaId = () => { try { return window.MypecarSync && MypecarSync.empresas && MypecarSync.empresas.activaId(); } catch (e) { return null; } };
  const clave = () => 'mpdemo_' + empresaId();
  const estado = () => { try { return localStorage.getItem(clave()); } catch (e) { return null; } };
  const g = n => { try { return (0, eval)('typeof ' + n) !== 'undefined' ? (0, eval)(n) : undefined; } catch (e) { return undefined; } };
  const llamar = async n => { try { if ((0, eval)('typeof ' + n) === 'function') return await (0, eval)(n)(); } catch (e) { console.warn('demo:', n, e && e.message); } };

  function periodoActual() {
    try { const c = g('config'); if (c && c.periodoActivo) return c.periodoActivo; } catch (e) {}
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // ------------------------------------------------------------ empresa ficticia
  function datos(per) {
    const d = n => per + '-' + String(n).padStart(2, '0');
    const r2 = x => Math.round(x * 100) / 100;
    const L = (cuenta, debe, haber, cc) => ({ cuenta, cc: cc || '', debe: r2(debe), haber: r2(haber) });
    const D = { esDemo: true };
    const cfg = g('config') || {};
    const tv = (cfg.tiposVenta && cfg.tiposVenta[0] && cfg.tiposVenta[0].codigo) || '';
    const pv = (cfg.puntosVenta && cfg.puntosVenta[0] && cfg.puntosVenta[0].codigo) || '';
    const venta = (id, dia, tipo, serie, num, cli, ruc, concepto, base, cobrado, medio) => Object.assign({ id, fechaEmision: d(dia), fechaVencimiento: d(dia), tipoDoc: tipo, serie, numero: num, tipoVenta: tv, puntoVenta: pv, clienteRuc: ruc, clienteRazonSocial: cli, concepto, baseGravada: base, igv: r2(base * 0.18), baseNoGravada: 0, isc: 0, otros: 0, total: r2(base * 1.18), moneda: 'PEN', tipoCambio: 1, cuenta: '701', estadoCobro: cobrado ? 'Cobrado' : 'Pendiente', medioCobro: cobrado ? (medio || 'Efectivo') : '', detalleItems: [] }, D);
    const sales = [venta(1, 2, '03', 'B001', '00000101', 'PÚBLICO EN GENERAL', '', 'Venta de mercadería al por menor', 250, true), venta(2, 4, '01', 'F001', '00000045', 'DISTRIBUIDORA SOL S.A.C.', '20512345678', 'Venta de mercadería al por mayor', 4200, false),
      venta(3, 6, '03', 'B001', '00000102', 'PÚBLICO EN GENERAL', '', 'Venta de mercadería al por menor', 180, true), venta(4, 9, '01', 'F001', '00000046', 'FERRETERIA LOS ANDES E.I.R.L.', '20601234567', 'Venta de mercadería', 920, true, 'Transferencia'),
      venta(5, 12, '03', 'B001', '00000103', 'PÚBLICO EN GENERAL', '', 'Venta de mercadería al por menor', 310, true), venta(6, 15, '01', 'F001', '00000047', 'DISTRIBUIDORA SOL S.A.C.', '20512345678', 'Venta de mercadería al por mayor', 5200, false)];
    const clientes = [Object.assign({ ruc: '20512345678', razonSocial: 'DISTRIBUIDORA SOL S.A.C.', cuentaDefault: '701' }, D), Object.assign({ ruc: '20601234567', razonSocial: 'FERRETERIA LOS ANDES E.I.R.L.', cuentaDefault: '701' }, D)];
    const compra = (id, dia, serie, num, prov, ruc, concepto, base, cuenta, pagado) => Object.assign({ id, fechaEmision: d(dia), fechaVencimiento: d(dia), tipoDoc: '01', serie, numero: num, proveedorRuc: ruc, proveedorRazonSocial: prov, concepto, baseGravada: base, igv: r2(base * 0.18), baseNoGravada: 0, isc: 0, otros: 0, total: r2(base * 1.18), moneda: 'PEN', tipoCambio: 1, cuenta, cuentas: [{ cuenta, monto: base }], estadoPago: pagado ? 'Pagado' : 'Pendiente', medioPago: pagado ? 'Transferencia' : '' }, D);
    const purchases = [compra(1, 3, 'F010', '00001234', 'ESTUDIO CONTABLE ASOCIADOS S.A.C.', '20456789123', 'Servicio de contabilidad', 400, '63211', true), compra(2, 5, 'F022', '00000871', 'INMOBILIARIA SAN MARTIN S.A.C.', '20512345679', 'Alquiler de local comercial', 1500, '63511', false),
      compra(3, 8, 'F105', '00004410', 'LUZ DEL SUR S.A.A.', '20331898008', 'Servicio de electricidad', 260, '63611', true), compra(4, 11, 'F300', '00002210', 'TELECOMUNICACIONES DEL PERU S.A.', '20100017491', 'Servicio de internet', 180, '63614', false)];
    const proveedores = [Object.assign({ ruc: '20456789123', razonSocial: 'ESTUDIO CONTABLE ASOCIADOS S.A.C.', nombreComercial: 'Estudio Contable', cuentaDefault: '63211' }, D), Object.assign({ ruc: '20512345679', razonSocial: 'INMOBILIARIA SAN MARTIN S.A.C.', nombreComercial: 'Inmobiliaria San Martín', cuentaDefault: '63511' }, D), Object.assign({ ruc: '20331898008', razonSocial: 'LUZ DEL SUR S.A.A.', nombreComercial: 'Luz del Sur', cuentaDefault: '63611' }, D)];
    const totV = sales.reduce((s, v) => s + v.total, 0), igvV = sales.reduce((s, v) => s + v.igv, 0), baseV = sales.reduce((s, v) => s + v.baseGravada, 0);
    const cobV = sales.filter(v => v.estadoCobro === 'Cobrado').reduce((s, v) => s + v.total, 0);
    const asientos = [
      Object.assign({ id: 1, numero: 1, fecha: d(28), glosa: 'Por el resumen del Registro de Ventas del mes (EJEMPLO)', origen: 'Resumen Ventas', lineas: [L('101', cobV, 0), L('121', totV - cobV, 0), L('40111', 0, igvV), L('701', 0, baseV)] }, D),
      Object.assign({ id: 2, numero: 2, fecha: d(28), glosa: 'Por el resumen del Registro de Compras del mes (EJEMPLO)', origen: 'Resumen Compras', lineas: [L('63211', 400, 0, '94'), L('63511', 1500, 0, '94'), L('63611', 260, 0, '94'), L('63614', 180, 0, '94'), L('40112', 421.2, 0), L('421', 0, 1982.4), L('1041', 0, 778.8)] }, D)
    ];
    const movimientos = [
      Object.assign({ id: 1, fecha: d(3), tipo: 'Egreso', categoria: 'Alquiler', concepto: 'Pago de alquiler del local (EJEMPLO)', lineas: [L('63511', 1200, 0, '94'), L('1041', 0, 1200)], moneda: 'PEN', tipoCambio: 1 }, D),
      Object.assign({ id: 2, fecha: d(7), tipo: 'Ingreso', categoria: 'Aporte', concepto: 'Aporte del dueño a la caja (EJEMPLO)', lineas: [L('1041', 8000, 0), L('5011', 0, 8000)], moneda: 'PEN', tipoCambio: 1 }, D),
      Object.assign({ id: 3, fecha: d(11), tipo: 'Egreso', categoria: 'Servicios', concepto: 'Pago de luz del mes (EJEMPLO)', lineas: [L('63611', 220.34, 0, '94'), L('40112', 39.66, 0), L('101', 0, 260)], moneda: 'PEN', tipoCambio: 1 }, D)
    ];
    const trab = (id, nombres, apellidos, dni, nac, cargo, ing, sueldo, hijos, reg) => Object.assign({ id, nombres, apellidos, dni, fechaNacimiento: nac, cargo, fechaIngreso: ing, fechaCese: '', sueldoBasico: sueldo, tieneHijos: hijos, regimenLaboral: reg, sistemaPension: 'ONP', estado: 'activo', puntoVenta: pv }, D);
    const trabajadores = [trab(1, 'Rosa', 'Quispe Mamani', '00000001', '1992-03-15', 'Vendedora', '2025-03-01', 1300, true, 'pequena'), trab(2, 'Luis', 'Huamán Rojas', '00000002', '1988-07-22', 'Almacenero', '2025-06-15', 1130, false, 'pequena'), trab(3, 'Carmen', 'Flores Díaz', '00000003', '1995-11-02', 'Cajera', '2026-01-10', 1500, false, 'general')];
    const contratos = [Object.assign({ id: 1, trabajadorId: 1, tipoContrato: 'plazo_fijo_mercado', fechaInicio: '2025-03-01', fechaFin: '2027-02-28', remuneracionPactada: 1300, jornada: '8 horas' }, D), Object.assign({ id: 2, trabajadorId: 2, tipoContrato: 'indefinido', fechaInicio: '2025-06-15', fechaFin: null, remuneracionPactada: 1130, jornada: '8 horas' }, D), Object.assign({ id: 3, trabajadorId: 3, tipoContrato: 'indefinido', fechaInicio: '2026-01-10', fechaFin: null, remuneracionPactada: 1500, jornada: '8 horas' }, D)];
    const activos = [Object.assign({ id: 1, nombre: 'Laptop para administración (EJEMPLO)', categoria: 'equipos', marca: 'Lenovo', modelo: 'ThinkPad', serie: 'LN-2025-001', ubicacion: 'Oficina', cc: '94', costo: 3600, valorResidual: 0, tasaDepreciacion: 25, fechaAdquisicion: '2025-02-01', fechaInicioUso: '2025-02-01', estado: 'uso', proveedor: 'TECNO PERU S.A.C.', documento: 'F001-00004567' }, D),
      Object.assign({ id: 2, nombre: 'Estantes metálicos de almacén (EJEMPLO)', categoria: 'muebles', marca: '', modelo: '', serie: '', ubicacion: 'Almacén', cc: '95', costo: 2400, valorResidual: 0, tasaDepreciacion: 10, fechaAdquisicion: '2025-06-10', fechaInicioUso: '2025-06-10', estado: 'uso', proveedor: 'METALES DEL SUR E.I.R.L.', documento: 'F002-00000912' }, D)];
    const productos = [Object.assign({ codigo: 'P001', nombre: 'Arroz extra 50 kg', unidad: 'SAC', controlaStock: true, stockMinimo: 5 }, D), Object.assign({ codigo: 'P002', nombre: 'Aceite vegetal 1 L', unidad: 'UND', controlaStock: true, stockMinimo: 24 }, D), Object.assign({ codigo: 'P003', nombre: 'Azúcar rubia 50 kg', unidad: 'SAC', controlaStock: true, stockMinimo: 4 }, D)];
    const mov = (id, dia, tipo, cod, nom, un, cant, costo, origen) => Object.assign({ id, fecha: d(dia), tipo, productoCodigo: cod, productoNombre: nom, unidad: un, cantidad: cant, costoUnitario: tipo === 'entrada' ? costo : null, puntoVenta: pv, origen, comprobante: tipo === 'entrada' ? 'F010-00001234' : 'B001-00000101', fechaRegistro: d(dia) + 'T10:00:00.000Z' }, D);
    const stockMovs = [mov(1, 3, 'entrada', 'P001', 'Arroz extra 50 kg', 'SAC', 40, 118, 'compra'), mov(2, 3, 'entrada', 'P002', 'Aceite vegetal 1 L', 'UND', 120, 5.4, 'compra'), mov(3, 3, 'entrada', 'P003', 'Azúcar rubia 50 kg', 'SAC', 30, 132, 'compra'),
      mov(4, 6, 'salida', 'P001', 'Arroz extra 50 kg', 'SAC', 12, null, 'venta'), mov(5, 9, 'salida', 'P002', 'Aceite vegetal 1 L', 'UND', 60, null, 'venta'), mov(6, 12, 'salida', 'P003', 'Azúcar rubia 50 kg', 'SAC', 9, null, 'venta'), mov(7, 15, 'salida', 'P001', 'Arroz extra 50 kg', 'SAC', 8, null, 'venta')];
    return { sales, clientes, purchases, proveedores, asientos, movimientos, trabajadores, contratos, activos, productos, stockMovs };
  }

  // ------------------------------------------------------------ por módulo: ¿está vacío? y cómo se llena (solo en memoria)
  const hay = (arr) => Array.isArray(arr) && arr.length > 0;
  const hayEnPeriodos = (campo) => { const pd = g('periodsData'); return !!pd && Object.values(pd).some(p => p && hay(p[campo])); };
  const vacios = {
    '01': () => !hay(g('sales')) && !hay(g('clientes')) && !hayEnPeriodos('sales'),
    '02': () => !hay(g('purchases')) && !hay(g('proveedores')) && !hayEnPeriodos('purchases'),
    '03': () => !hay(g('movimientos')) && !hayEnPeriodos('movimientos'),
    '04': () => !hay(g('asientos')) && !hayEnPeriodos('asientos'),
    '05': () => !hay(g('trabajadores')) && !hay(g('contratos')),
    '06': () => !hay(g('activos')),
    '07': () => !g('ventasImport') && !g('comprasImport') && !g('diarioImport'),
    '08': () => !g('ventasImport') && !g('comprasImport') && !g('diarioImport'),
    '09': () => !hay(g('stockMovimientos')) && !hay((g('config') || {}).productos)
  };
  const IDS_TRAB = new Set();
  window.__mpDemoTrab = IDS_TRAB; // mypecar-sync.js descarta también las filas de planilla de trabajadores de ejemplo

  const sembradores = {
    '01': async (D, per) => { g('clientes').push(...D.clientes); g('sales').push(...D.sales); for (const f of ['renderPeriodSelectors', 'updateCalculations', 'renderRegistro', 'renderClientes', 'updateDashboard']) await llamar(f); },
    '02': async (D, per) => { g('proveedores').push(...D.proveedores); g('purchases').push(...D.purchases); for (const f of ['renderPeriodSelectors', 'updateCalculations', 'renderRegistro', 'renderProveedores', 'updateDashboard']) await llamar(f); },
    '03': async (D, per) => { g('movimientos').push(...D.movimientos); for (const f of ['renderPeriodSelectors', 'updateCalculations', 'renderRegistro', 'updateDashboard']) await llamar(f); },
    '04': async (D, per) => { g('asientos').push(...D.asientos); for (const f of ['renderPeriodSelectors', 'renderAll']) await llamar(f); },
    '05': async (D, per) => { D.trabajadores.forEach(t => IDS_TRAB.add(t.id)); g('trabajadores').push(...D.trabajadores); g('contratos').push(...D.contratos); for (const f of ['poblarSelectoresPeriodo', 'updateDashboard', 'renderFicha', 'renderTrabajadores', 'renderContratos']) await llamar(f); },
    '06': async (D, per) => { g('activos').push(...D.activos); for (const f of ['renderAll', 'updateDashboard']) await llamar(f); },
    '09': async (D, per) => { const c = g('config'); c.productos = (c.productos || []).concat(D.productos); g('stockMovimientos').push(...D.stockMovs); for (const f of ['renderDashboard', 'renderKardex', 'renderProductos', 'renderAlertas']) await llamar(f); },
    '07': async (D, per) => { await importar(D, per); for (const f of ['actualizarEstadoImportacion', 'poblarSelectoresPeriodo', 'poblarSelectorPeriodoCxC', 'poblarSelectorPeriodoCxP', 'poblarPeriodosDJM', 'poblarAniosDJ']) await llamar(f); },
    '08': async (D, per) => { await importar(D, per); for (const f of ['actualizarEstadoImportacion', 'poblarSelectorPeriodoAuditoria']) await llamar(f); }
  };
  async function importar(D, per) {
    const c0 = g('config') || g('appConfig') || {};
    const cfg = { razonSocial: c0.razonSocial || 'MI EMPRESA (EJEMPLO)', nombreComercial: c0.nombreComercial || 'Mi empresa', ruc: c0.ruc || '', igvRate: 0.18, periodoActivo: per, tiposVenta: [], productos: [], puntosVenta: [] };
    const base = () => ({ generadoEl: new Date().toISOString(), config: cfg, customAccounts: [], esDemo: true });
    (0, eval)('ventasImport = ' + JSON.stringify({ ...base(), tipo: 'ventas', periodsData: { [per]: { sales: D.sales } }, clientes: D.clientes }));
    (0, eval)('comprasImport = ' + JSON.stringify({ ...base(), tipo: 'compras', version: 2, periodsData: { [per]: { purchases: D.purchases } }, proveedores: D.proveedores }));
    (0, eval)('diarioImport = ' + JSON.stringify({ ...base(), tipo: 'diario', periodsData: { [per]: { asientos: D.asientos } }, existenciasPorPeriodo: {} }));
  }

  // ------------------------------------------------------------ aviso con "Quitar datos de ejemplo"
  function hayDemoEnMemoria() {
    try {
      if (MOD === '07' || MOD === '08') { const v = g('ventasImport'); return !!(v && v.esDemo); }
      const nombres = { '01': ['sales', 'clientes'], '02': ['purchases', 'proveedores'], '03': ['movimientos'], '04': ['asientos'], '05': ['trabajadores'], '06': ['activos'], '09': ['stockMovimientos'] }[MOD] || [];
      return nombres.some(n => (g(n) || []).some(x => x && x.esDemo === true));
    } catch (e) { return false; }
  }
  function pintarAviso() {
    let b = document.getElementById('mpdemo-aviso');
    if (!hayDemoEnMemoria()) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('div'); b.id = 'mpdemo-aviso'; b.setAttribute('role', 'status');
    b.style.cssText = 'position:sticky;top:0;z-index:9500;background:#fef3c7;border-bottom:2px solid #f59e0b;color:#78350f;padding:8px 14px;font:600 13px/1.35 system-ui,sans-serif;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center';
    b.innerHTML = '<span>🎓 Estás viendo <b>datos de ejemplo</b> (ficticios) para que explores el sistema. No se guardan ni afectan tu contabilidad.</span>';
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Quitar datos de ejemplo';
    btn.style.cssText = 'background:#b45309;color:#fff;border:0;border-radius:8px;padding:7px 12px;font:700 13px system-ui,sans-serif;cursor:pointer';
    btn.onclick = quitar; b.appendChild(btn);
    document.body.insertBefore(b, document.body.firstChild);
  }
  function quitar() { try { localStorage.setItem(clave(), 'quitado'); } catch (e) {} location.reload(); }

  // ------------------------------------------------------------ arranque
  async function intentar(veces) {
    if (!empresaId() || estado() !== 'on') return;
    if (g('config') === undefined && MOD !== '07' && MOD !== '08') { if (veces < 12) setTimeout(() => intentar(veces + 1), 1500); return; }
    if (hayDemoEnMemoria()) { pintarAviso(); return; }
    try {
      if (!vacios[MOD]()) return;
      const per = periodoActual();
      await sembradores[MOD](datos(per), per);
      window.__mpDemoSembrado = true;
      pintarAviso();
      setInterval(pintarAviso, 3000);
    } catch (e) { console.warn('Datos de ejemplo: no se pudieron cargar:', e); }
  }
  window.MypecarDemo = {
    activar() { try { localStorage.setItem(clave(), 'on'); } catch (e) {} location.reload(); },
    quitar, activo: () => estado() === 'on', hayDatosDeEjemplo: hayDemoEnMemoria
  };
  window.addEventListener('load', () => setTimeout(() => intentar(0), 6500));
})();
