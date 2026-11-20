/**
 * mypecar-login.js
 * ============================================================================
 * Pantalla compartida de "Inicia sesión / Elige tu empresa" para las 9 apps
 * de MYPECAR CONTABLE. Un solo archivo, incluido igual en cada app — así
 * ninguna app tiene que dibujar su propio formulario de acceso.
 *
 * REQUISITOS (deben estar cargados ANTES de este archivo):
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *   <script src="mypecar-sync.js"></script>
 *   <script src="mypecar-login.js"></script>
 *
 * CÓMO USARLO (dentro de tu función de inicialización, DESPUÉS de MypecarSync.init):
 *
 *   MypecarSync.init({ url: '...', anonKey: '...', app: 'inventario' });
 *   await MypecarLogin.asegurarAcceso({ tituloApp: 'Inventario' });
 *   await MypecarSync.pullAll();
 *   // ... el resto de tu inicializarApp() sigue exactamente igual ...
 *
 * QUÉ HACE asegurarAcceso():
 *   - Si el archivo NO está conectado a Supabase (no se configuró url/anonKey,
 *     o falta el <script> de supabase-js), no bloquea nada: muestra un aviso
 *     chiquito de "trabajando sin nube" y la app sigue funcionando 100% local,
 *     como siempre.
 *   - Si ya había una sesión guardada y una empresa elegida, no muestra nada
 *     y continúa de inmediato (excepto que revalida la sesión si hay internet).
 *   - Si falta iniciar sesión y/o elegir empresa, muestra una pantalla
 *     completa (no se puede usar la app por debajo) hasta que el usuario:
 *       1) inicia sesión (o crea una cuenta), y
 *       2) elige una empresa ya creada, o crea una nueva.
 *   - Agrega una etiqueta fija arriba a la derecha con el nombre de la
 *     empresa activa, para cerrar sesión o cambiar de empresa sin recargar
 *     todo el flujo desde cero.
 * ============================================================================
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // Anti-parpadeo (2026-11-20): en las 9 apps, la pantalla de la aplicación
  // se pintaba unos instantes antes de que apareciera el login. Se oculta la
  // página desde que carga este archivo (va en el <head>) y se muestra de
  // nuevo cuando asegurarAcceso() termina o cuando aparece una pantalla de
  // login/bloqueo (que cubre todo). Seguro: pase lo que pase, a los 6 segundos
  // la página se muestra sola, para que nunca quede en blanco.
  // Solo se aplica en los módulos ("108 0X ... Mypecar Plus.html"), no en
  // la landing (index.html), modulos.html ni legal.html.
  // ---------------------------------------------------------------------
  function liberarPagina() {
    try { document.documentElement.classList.remove('mps-esperando'); } catch (e) {}
  }
  (function ocultarHastaVerificar() {
    try {
      let ruta = location.pathname;
      try { ruta = decodeURIComponent(ruta); } catch (e) {}
      if (!/108\s*0\d/.test(ruta)) return;
      // Encabezado uniforme (2026-11-20): mismo tamaño de letra, logo, recuadros y pestañas en
      // los 9 módulos, y las pestañas se acomodan en filas (sin barra de desplazamiento
      // horizontal). Solo escritorio; en celular manda mypecar-mobile.js.
      const eu = document.createElement('style');
      eu.id = 'mps-encabezado-uniforme';
      eu.textContent = [
        '@media (min-width:641px){',
        'header{position:static !important}',
        'header #header-logo-circulo{width:40px !important;height:40px !important;padding:4px !important;border-width:2px !important}',
        'header h1{font-size:20px !important;line-height:1.15 !important;letter-spacing:0 !important}',
        'header h1 span{font-size:11px !important}',
        'header .px-3.py-1\\.5{padding:3px 10px !important}',
        'header .px-3.py-1\\.5 p:first-child{font-size:9px !important}',
        'header .px-3.py-1\\.5 p:last-child{font-size:12px !important}',
        'header nav, header .mpm-tabs{display:flex !important;flex-wrap:wrap !important;overflow:visible !important;gap:2px !important;margin-top:6px !important;padding-top:4px !important;padding-bottom:4px !important}',
        'header nav > *, header .mpm-tabs > *{flex:0 0 auto !important;white-space:nowrap !important;font-size:13px !important;padding:5px 9px !important;line-height:1.3 !important;border-radius:8px !important;margin-left:0 !important}',
        'main{padding-top:14px !important;padding-bottom:18px !important}',
        'main .space-y-6>*{margin-top:0 !important;margin-bottom:0 !important}',
        'main .space-y-6>*+*{margin-top:14px !important}',
        'main .space-y-8>*{margin-top:0 !important;margin-bottom:0 !important}',
        'main .space-y-8>*+*{margin-top:16px !important}',
        'main .p-6{padding:14px 16px !important}',
        'main .p-5{padding:12px 14px !important}',
        'main .py-6{padding-top:14px !important;padding-bottom:14px !important}',
        'main .gap-6{gap:14px !important}',
        'main .mb-6{margin-bottom:14px !important}',
        'main .mt-6{margin-top:14px !important}',
        'main .rounded-2xl{border-radius:14px !important}',
        'main .text-2xl{font-size:20px !important;line-height:1.25 !important}',
        'main .text-xl{font-size:17px !important;line-height:1.3 !important}',
        'main .text-lg{font-size:15px !important;line-height:1.35 !important}',
        'main .p-2\\.5{padding:7px 10px !important}',
        'main .py-2\\.5{padding-top:8px !important;padding-bottom:8px !important}',
        'main .px-6{padding-left:16px !important;padding-right:16px !important}',
        'main table th,main table td{padding-top:6px !important;padding-bottom:6px !important}',
        'main .h-56{height:160px !important}',
        'main .h-64{height:190px !important}',
        'main .h-72{height:210px !important}',
        'main .h-80{height:260px !important}',
        'main .h-96{height:300px !important}',
        '}'
      ].join('\n');
      (document.head || document.documentElement).appendChild(eu);
      const st = document.createElement('style');
      st.id = 'mps-anti-parpadeo';
      st.textContent = 'html.mps-esperando body{visibility:hidden!important}';
      (document.head || document.documentElement).appendChild(st);
      document.documentElement.classList.add('mps-esperando');
      setTimeout(liberarPagina, 6000);
    } catch (e) { liberarPagina(); }
  })();

  const EMPRESA_NOMBRE_KEY = 'mypecar_empresa_activa_nombre';
  let estilosInyectados = false;
  let overlayEl = null;

  // ARREGLO (2026-09-24, 2do hallazgo del mismo día -- causa raíz de que el
  // globito siga mostrando una empresa vieja aunque el encabezado ya esté
  // bien): EMPRESA_NOMBRE_KEY era una SOLA clave global, compartida por
  // todas las empresas -- justo lo que el resto del sistema ya dejó de
  // hacer con los datos reales (ver el aislamiento por empresa en
  // mypecar-sync.js, sufijo "::emp_<id>"). El nombre del globito solo se
  // refresca con un dato en vivo de Supabase (obtenerDatos); si esa llamada
  // falla justo en ese instante (sin internet, Supabase lento), el código
  // ya conservaba "el último nombre conocido" -- pero como la clave era
  // global, ese "último nombre conocido" podía ser el de una empresa
  // TOTALMENTE DISTINTA (p.ej. seguía en pantalla "DEMO DOS" porque fue la
  // última que se pudo confirmar por red, aunque la empresa realmente
  // activa ahora fuera "PIOS CHICKEN SANTA CLARA", ya correcta en el
  // encabezado porque esos datos sí están aislados localmente por empresa
  // y no dependen de la red). Se corrige guardando y leyendo el nombre
  // cacheado también con el sufijo "::emp_<id>" -- así, si la red falla, el
  // peor caso es no tener aún un nombre cacheado PARA ESA empresa (se
  // muestra el genérico "Empresa activa" hasta que la red vuelva), pero
  // nunca se muestra el nombre de una empresa distinta.
  function claveNombreEmpresa(empresaId) {
    return empresaId ? (EMPRESA_NOMBRE_KEY + '::emp_' + empresaId) : EMPRESA_NOMBRE_KEY;
  }

  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // Estilos (inyectados una sola vez, sin depender de ningún CSS externo)
  // ---------------------------------------------------------------------
  function injectStyles() {
    if (estilosInyectados) return;
    estilosInyectados = true;
    const css = `
      @font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url('fonts/manrope-latin-wght-normal.woff2') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
      .mps-overlay { position:fixed; inset:0; z-index:99999; overflow-y:auto;
        background:linear-gradient(135deg,#04231f 0%,#0b5d52 55%,#0f8f7f 100%);
        display:flex; align-items:center; justify-content:center; padding:14px 16px; box-sizing:border-box;
        font-family: 'Manrope','Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif; }
      .mps-overlay input, .mps-overlay button, .mps-overlay select, .mps-overlay textarea, .mps-aviso-lic { font-family:inherit; }
      .mps-card { background:#fff; border-radius:20px; width:100%; max-width:390px; margin:auto;
        box-shadow:0 30px 80px rgba(2,8,23,.45); padding:22px 24px 20px; box-sizing:border-box; }
      .mps-marca { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
      .mps-logo { flex:none; width:42px; height:42px; border-radius:12px; background:#fff;
        box-shadow:0 4px 14px rgba(15,23,42,.14), inset 0 0 0 1px #e2e8f0; display:grid; place-items:center; }
      .mps-logo svg { width:23px; height:23px; }
      .mps-marca-n { font-size:17px; font-weight:800; color:#0f172a; line-height:1.1; letter-spacing:.2px; }
      .mps-marca-s { font-size:12px; color:#64748b; margin-top:2px; }
      .mps-titulo { font-size:21px; font-weight:800; color:#0f172a; margin:0 0 4px; line-height:1.15; }
      .mps-subtitulo { font-size:13px; color:#64748b; margin:0 0 14px; line-height:1.4; }
      .mps-tabs { display:flex; gap:6px; margin-bottom:14px; background:#f1f5f9; border-radius:12px; padding:4px; }
      .mps-tab { flex:1; text-align:center; padding:9px 6px; border-radius:9px; font-size:13px;
        font-weight:700; color:#64748b; cursor:pointer; user-select:none; }
      .mps-tab.activa { background:#fff; color:#0f172a; box-shadow:0 1px 4px rgba(15,23,42,.14); }
      .mps-label { font-size:12.5px; font-weight:700; color:#1e293b; margin:10px 0 4px; display:block; }
      .mps-input { width:100%; box-sizing:border-box; padding:10px 14px; border:1px solid #dbe3ee; background:#f8fafc;
        border-radius:12px; font-size:14px; min-height:44px; margin-bottom:2px; color:#0f172a; }
      .mps-input::placeholder { color:#94a3b8; }
      .mps-input:focus { outline:none; border-color:#0f766e; background:#fff; box-shadow:0 0 0 4px rgba(15,118,110,.14); }
      .mps-btn { width:100%; padding:11px 14px; min-height:44px; border:none; border-radius:12px; font-size:14px;
        font-weight:800; cursor:pointer; margin-top:12px; transition:filter .15s, transform .1s; }
      .mps-btn:active { transform:scale(.99); }
      .mps-btn-primario { background:#0f766e; color:#fff; box-shadow:0 8px 20px rgba(15,118,110,.28); }
      .mps-btn-primario:hover { filter:brightness(1.07); }
      .mps-btn-primario:disabled { opacity:.6; cursor:default; box-shadow:none; }
      .mps-btn-secundario { background:#fff; color:#0f172a; border:1px solid #dbe3ee; }
      .mps-link { color:#0f766e; font-size:12.5px; font-weight:600; cursor:pointer; text-decoration:underline; }
      .mps-error { background:#fef2f2; color:#b91c1c; font-size:12.5px; border-radius:10px;
        padding:9px 11px; margin-top:10px; line-height:1.4; }
      .mps-ok { background:#f0fdf4; color:#15803d; font-size:12.5px; border-radius:10px;
        padding:9px 11px; margin-top:10px; line-height:1.4; }
      .mps-empresa-item { display:flex; align-items:center; justify-content:space-between; gap:12px;
        border:1px solid #dbe3ee; border-radius:13px; padding:11px 14px; margin-bottom:8px; background:#fff;
        cursor:pointer; transition:.15s; }
      .mps-empresa-item:hover { border-color:#0f766e; background:#f0fdfa; box-shadow:0 6px 16px rgba(15,118,110,.10); }
      .mps-empresa-nombre { font-weight:800; font-size:14px; color:#0f172a; }
      .mps-empresa-ruc { font-size:12px; color:#64748b; margin-top:2px; }
      .mps-ir { flex:none; color:#0f766e; font-weight:800; font-size:12.5px; white-space:nowrap; }
      .mps-btn-google { background:#fff; color:#0f172a; border:1px solid #dbe3ee; display:flex; align-items:center;
        justify-content:center; gap:10px; margin-top:0; }
      .mps-btn-google:hover { background:#f8fafc; }
      .mps-btn-google:disabled { opacity:.6; cursor:default; }
      .mps-separador { display:flex; align-items:center; gap:12px; color:#94a3b8; font-size:12px; margin:12px 0 2px; }
      .mps-separador::before, .mps-separador::after { content:""; flex:1; height:1px; background:#e2e8f0; }
      .mps-terminos { display:flex; align-items:flex-start; gap:9px; margin-top:12px; font-size:12.5px; color:#334155; line-height:1.4; cursor:pointer; }
      .mps-terminos input { flex:none; width:18px; height:18px; margin-top:1px; accent-color:#0f766e; cursor:pointer; }
      .mps-terminos a { color:#0f766e; font-weight:700; }
      .mps-ayuda { font-size:12px; color:#64748b; margin:9px 0 0; line-height:1.4; }
      .mps-centro { text-align:center; margin:10px 0 0; }
      .mps-contacto { display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:14px; }
      .mps-contacto-btn { display:block; width:100%; box-sizing:border-box; text-align:center; text-decoration:none;
        background:#16a34a; color:#fff; font-weight:800; font-size:14px; padding:11px 14px; border-radius:12px; }
      .mps-aviso-lic { position:fixed; top:10px; left:50%; transform:translateX(-50%); z-index:99997; width:calc(100vw - 24px); max-width:560px; box-sizing:border-box;
        display:flex; align-items:flex-start; gap:10px; border-radius:14px; padding:10px 12px 10px 14px; font-size:13.5px; line-height:1.4;
        box-shadow:0 8px 24px rgba(15,23,42,.18); font-family:'Manrope','Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif; }
      .mps-aviso-lic.amb { background:#fffbeb; border:1px solid #fcd34d; color:#92400e; }
      .mps-aviso-lic.roj { background:#fef2f2; border:1px solid #fca5a5; color:#991b1b; }
      .mps-aviso-lic a { color:inherit; font-weight:800; }
      .mps-aviso-lic .x { flex:none; cursor:pointer; font-weight:800; opacity:.7; padding:0 2px; }
      .mps-contador { font-size:12px; color:#64748b; margin:10px 0 8px; }
      @media (max-width:480px) {
        .mps-card { padding:20px 16px 18px; border-radius:18px; }
        .mps-titulo { font-size:20px; }
        .mps-input { font-size:16px; }
      }
      .mps-pie { text-align:center; margin-top:12px; font-size:12px; color:#94a3b8; line-height:1.4; }
      .mps-barra { display:flex; align-items:center; justify-content:space-between; gap:10px; flex:none; width:100%;
        box-sizing:border-box; background:#04231f; padding:5px 14px; min-height:36px;
        font-family:'Manrope','Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif; }
      .mps-volver { display:inline-flex; align-items:center; gap:6px; background:rgba(255,255,255,.12); color:#fff;
        border:1px solid rgba(255,255,255,.28); border-radius:999px; padding:5px 13px; font-size:12.5px; font-weight:700;
        text-decoration:none; white-space:nowrap; }
      .mps-volver:hover { background:rgba(255,255,255,.22); }
      .mps-badge { background:#fff; border:1px solid #e2e8f0; border-radius:999px; padding:5px 13px; font-size:12.5px;
        font-weight:700; color:#0f172a; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:62vw; }
      .mps-badge:hover { background:#f0fdfa; }
      @media print { .mps-barra { display:none !important; } }
      .mps-pestana { display:inline-flex; align-items:center; gap:6px; flex:none; white-space:nowrap; cursor:pointer;
        padding:6px 14px; border-radius:8px; font-size:14px; font-weight:600; line-height:1.4; color:#fff !important;
        background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.32); text-decoration:none !important;
        font-family:inherit; margin-left:4px; }
      .mps-pestana:hover { background:rgba(255,255,255,.26); }
      @media print { .mps-pestana { display:none !important; } }
      .mps-selector { cursor:pointer; }
      .mps-selector::after { content:" ▾"; opacity:.85; }
      .mps-selector:hover { filter:brightness(1.15); }
      .mps-badge-menu { position:fixed; top:40px; right:12px; z-index:99998; background:#fff; color:#0f172a;
        border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.22);
        font-family:'Manrope','Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif; overflow:auto; min-width:230px; max-width:min(340px,92vw); max-height:70vh; }
      .mps-menu-titulo { padding:9px 14px 4px; font-size:11px; font-weight:800; letter-spacing:.6px; text-transform:uppercase; color:#64748b; }
      .mps-menu-emp { padding:8px 14px; cursor:pointer; font-size:13.5px; font-weight:700; line-height:1.25; }
      .mps-menu-emp small { display:block; font-weight:500; font-size:11.5px; color:#64748b; }
      .mps-menu-emp.activa { background:#f0fdfa; color:#0f766e; }
      .mps-menu-emp:hover { background:#f1f5f9; }
      .mps-menu-sep { border:0; border-top:1px solid #e2e8f0; margin:4px 0; }
      .mps-menu-item, .mps-menu-carga { padding:9px 14px; font-size:13px; cursor:pointer; }
      .mps-menu-carga { color:#64748b; cursor:default; }
      .mps-menu-item:hover { background:#f1f5f9; }
      .mps-aviso-local { position:fixed; bottom:10px; left:10px; z-index:99998; background:#fffbeb;
        border:1px solid #fde68a; color:#92400e; border-radius:8px; padding:7px 11px; font-size:12px;
        font-family: 'Manrope','Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif; }
    `;
    const styleTag = document.createElement('style');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
  }

  function limpiarOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }

  function mensajeError(err) {
    const m = (err && err.message) || String(err);
    if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/already registered|user already exists/i.test(m)) return 'Ya existe una cuenta con ese correo. Intenta iniciar sesión.';
    if (/password should be at least/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
    if (/rate limit/i.test(m)) return 'Demasiados intentos seguidos. Espera un minuto e intenta de nuevo.';
    return 'Ocurrió un problema: ' + m;
  }

  // ---------------------------------------------------------------------
  // Aviso "sin nube" (cuando MypecarSync no está conectado a Supabase)
  // ---------------------------------------------------------------------
  function mostrarAvisoSinNube() {
    injectStyles();
    if (document.getElementById('mps-aviso-local')) return;
    const div = document.createElement('div');
    div.id = 'mps-aviso-local';
    div.className = 'mps-aviso-local';
    div.textContent = '⚠️ Trabajando solo en este dispositivo (sin conexión a la nube configurada).';
    document.body.appendChild(div);
  }

  // ---------------------------------------------------------------------
  // Flujo principal
  // ---------------------------------------------------------------------
  function asegurarAcceso(opciones) {
    opciones = opciones || {};
    injectStyles();

    return new Promise(async (resolveOriginal) => {
      const resolve = (v) => { liberarPagina(); resolveOriginal(v); };
      const estado = global.MypecarSync ? global.MypecarSync.getEstado() : { conectadoASupabase: false };

      if (!estado.conectadoASupabase) {
        mostrarAvisoSinNube();
        resolve({ modo: 'local' });
        return;
      }

      // ¿Ya había sesión y empresa activa? Si hay internet, validamos que la
      // sesión siga viva; si no hay internet, confiamos en lo guardado
      // (filosofía: la app debe poder abrirse sin conexión).
      if (estado.empresaActiva) {
        if (!navigator.onLine) {
          await resolverSiAutorizada(estado.empresaActiva, opciones, resolve);
          return;
        }
        try {
          const session = await global.MypecarSync.auth.sesionActual();
          if (session) {
            await resolverSiAutorizada(estado.empresaActiva, opciones, resolve);
            return;
          }
        } catch (e) { /* sigue al flujo de login */ }
      }

      mostrarFlujoCompleto(opciones, async () => {
        await resolverSiAutorizada(global.MypecarSync.empresas.activaId(), opciones, resolve);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Control de licenciamiento (2026-09-12): antes de dejar pasar a la app,
  // se confirma en la nube que la empresa esté "autorizada" (ver
  // mypecar-sync.js → empresas.obtenerEstado — el estado real vive en
  // Supabase y solo Carlos puede cambiarlo desde el Table Editor). Si no
  // lo está, se muestra una pantalla de bloqueo en vez de resolver la
  // promesa — la app que llamó a asegurarAcceso() se queda esperando (su
  // "await MypecarLogin.asegurarAcceso(...)") sin poder continuar, así que
  // ninguna pantalla ni dato de la app llega a pintarse.
  // ---------------------------------------------------------------------
  async function resolverSiAutorizada(empresaId, opciones, resolve) {
    const estadoEmpresa = await global.MypecarSync.empresas.obtenerEstado(empresaId);
    if (estadoEmpresa !== 'autorizada') {
      mostrarBloqueoPorAprobacion(opciones, estadoEmpresa);
      return;
    }
    // Control de acceso por app (2026-09-16): además de que la EMPRESA esté
    // autorizada, el usuario puntual tiene que tener PERMISO para ESTA app en
    // particular — lo decide el Contador Jefe (dueño) desde "Gestionar
    // accesos". El dueño mismo siempre tiene acceso a todo (ver
    // usuario_tiene_acceso_app en la base de datos), así que este paso nunca
    // lo bloquea a él.
    const appActual = global.MypecarSync.appActual ? global.MypecarSync.appActual() : null;
    const tieneAcceso = await global.MypecarSync.empresas.tieneAccesoApp(empresaId, appActual);
    if (!tieneAcceso) {
      mostrarBloqueoPorPermisoApp(opciones, empresaId);
      return;
    }
    // ARREGLO (2026-09-24, causa raíz REAL de "el globito muestra una
    // empresa distinta a la del encabezado"): EMPRESA_NOMBRE_KEY solo se
    // actualizaba en el instante exacto de elegir una empresa del listado
    // (ver renderElegirEmpresa/renderFormCrearEmpresa más abajo) — pero esta
    // función, resolverSiAutorizada(), es el camino que se usa en TODAS las
    // demás cargas de página normales (ya había sesión y empresa activa, no
    // se pasó por el listado). En ese camino nunca se refrescaba el nombre
    // cacheado del globito, así que se quedaba pegado con el nombre de la
    // ÚLTIMA empresa elegida a mano alguna vez — aunque la empresa
    // REALMENTE activa (y los datos/encabezado de la propia app, ya
    // correctamente aislados por empresa) hubiera cambiado desde entonces,
    // por ejemplo al cambiar de empresa en OTRA pestaña/app, o con una
    // simple recarga (F5) después de eso. Por eso Carlos veía el encabezado
    // correcto (p.ej. "PIOS CHICKEN SANTA CLARA") pero el globito con el
    // nombre de otra empresa (p.ej. "DEMO DOS"). Se corrige refrescando el
    // nombre cacheado con el dato real de Supabase ANTES de pintar el
    // globito, cada vez que se confirma el acceso — si no hay conexión justo
    // en este instante, se conserva el último nombre conocido (igual que el
    // resto del archivo hace en estos casos) en vez de dejar la app sin
    // poder abrir.
    try {
      const datosEmpresaActiva = await global.MypecarSync.empresas.obtenerDatos(empresaId);
      if (datosEmpresaActiva) {
        lsSet(claveNombreEmpresa(empresaId), datosEmpresaActiva.nombreComercial || datosEmpresaActiva.razonSocial || 'Empresa');
      }
    } catch (e) { /* sin conexión justo ahora: se conserva el último nombre conocido -- PERO SOLO el de ESTA MISMA empresa (clave aislada), nunca el de otra */ }
    montarBadge(opciones);
    resolve({ modo: 'nube', empresaId });
  }

  function mostrarBloqueoPorPermisoApp(opciones, empresaId) {
    limpiarOverlay();
    overlayEl = document.createElement('div');
    overlayEl.className = 'mps-overlay';
    liberarPagina();
    document.body.appendChild(overlayEl);

    overlayEl.innerHTML = `
      <div class="mps-card">
        <p class="mps-titulo">🔒 No tienes acceso a esta aplicación</p>
        <p class="mps-subtitulo" style="margin-bottom:0;">Tu Contador Jefe (administrador de esta empresa) todavía no te dio permiso para usar "${escapeHtml(opciones.tituloApp || 'esta aplicación')}". Tus datos guardados en otras apps no se ven afectados — consulta con él para que te habilite el acceso desde "Gestionar accesos".</p>
        <p style="text-align:center;margin-top:18px;">
          <span class="mps-link" id="mps-link-otra-empresa-permiso">Elegir otra empresa</span>
          &nbsp;·&nbsp;
          <span class="mps-link" id="mps-link-cerrar-sesion-permiso">Cerrar sesión</span>
        </p>
      </div>
    `;
    overlayEl.querySelector('#mps-link-otra-empresa-permiso').addEventListener('click', () => {
      renderElegirEmpresa(opciones, () => window.location.reload());
    });
    overlayEl.querySelector('#mps-link-cerrar-sesion-permiso').addEventListener('click', async () => {
      try { await global.MypecarSync.auth.cerrarSesion(); } catch (e) {}
      window.location.reload();
    });
  }

  function mostrarBloqueoPorAprobacion(opciones, estadoEmpresa) {
    limpiarOverlay();
    overlayEl = document.createElement('div');
    overlayEl.className = 'mps-overlay';
    liberarPagina();
    document.body.appendChild(overlayEl);

    let titulo, mensaje, msgWa;
    if (estadoEmpresa === 'vencida') {
      titulo = '⏰ Licencia vencida';
      mensaje = 'La licencia de esta empresa venció y terminó el periodo de gracia. Tus datos siguen guardados: apenas se renueve, vuelve a abrir esta página y todo estará como lo dejaste.';
      msgWa = 'Hola, quiero renovar mi licencia de MYPECAR PLUS.';
    } else if (estadoEmpresa === 'suspendida') {
      titulo = '⛔ Licencia no vigente';
      mensaje = 'Tu licencia no está vigente. Escríbenos para renovarla: apenas se registre el pago, vuelves a entrar y todo estará como lo dejaste.';
      msgWa = 'Hola, mi empresa figura suspendida en MYPECAR PLUS y quiero renovar mi licencia.';
    } else {
      titulo = '⏳ Empresa pendiente de aprobación';
      mensaje = 'Tu empresa fue registrada correctamente, pero todavía no fue activada. Comunícate con tu proveedor del sistema (con tu RUC a la mano) para activarla — apenas la activen, vuelve a abrir esta página.';
      msgWa = 'Hola, registré mi empresa en MYPECAR PLUS y quiero activarla.';
    }

    overlayEl.innerHTML = `
      <div class="mps-card">
        ${marcaHtml('Cuentas claras para tu empresa')}
        <p class="mps-titulo">${titulo}</p>
        <p class="mps-subtitulo" style="margin-bottom:0;">${mensaje}</p>
        ${contactoHtml(msgWa)}
        <p style="text-align:center;margin-top:18px;">
          <span class="mps-link" id="mps-link-otra-empresa">Elegir otra empresa</span>
          &nbsp;·&nbsp;
          <span class="mps-link" id="mps-link-cerrar-sesion-bloqueo">Cerrar sesión</span>
        </p>
      </div>
    `;
    overlayEl.querySelector('#mps-link-otra-empresa').addEventListener('click', () => {
      renderElegirEmpresa(opciones, () => window.location.reload());
    });
    overlayEl.querySelector('#mps-link-cerrar-sesion-bloqueo').addEventListener('click', async () => {
      try { await global.MypecarSync.auth.cerrarSesion(); } catch (e) {}
      window.location.reload();
    });
  }

  function mostrarFlujoCompleto(opciones, alTerminar) {
    limpiarOverlay();
    overlayEl = document.createElement('div');
    overlayEl.className = 'mps-overlay';
    liberarPagina();
    document.body.appendChild(overlayEl);

    (async () => {
      let session = null;
      try { session = await global.MypecarSync.auth.sesionActual(); } catch (e) {}
      if (session) {
        renderElegirEmpresa(opciones, alTerminar);
      } else {
        renderLogin(opciones, alTerminar);
      }
    })();
  }

  // Cabecera de marca de las pantallas de ingreso (solo presentación)
  function marcaHtml(subtitulo) {
    return '<div class="mps-marca"><div class="mps-logo" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg></div>' +
      '<div><div class="mps-marca-n">MYPECAR PLUS</div><div class="mps-marca-s">' + subtitulo + '</div></div></div>';
  }

  // ---------------------------------------------------------------------
  // Paso 1: Iniciar sesión / Crear cuenta
  // ---------------------------------------------------------------------
  // Datos para que el cliente te escriba cuando su empresa está pendiente, por vencer o vencida.
  // COMPLÉTALOS: whatsapp = número con código de país y sin signos (ej. '51999999999');
  // correo = el que quieras mostrar. Si los dejas vacíos, los avisos dicen "tu proveedor".
  const CONTACTO = { whatsapp: '51996378921', correo: 'carlosfloresf2030@gmail.com' };

  function contactoHtml(mensajeWa) {
    const partes = [];
    const wa = String(CONTACTO.whatsapp || '').replace(/\D/g, '');
    if (wa) partes.push('<a class="mps-contacto-btn" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(mensajeWa || 'Hola, necesito ayuda con MYPECAR PLUS.') + '">Escribir por WhatsApp</a>');
    if (CONTACTO.correo) partes.push('<a class="mps-link" href="mailto:' + escapeHtml(CONTACTO.correo) + '">' + escapeHtml(CONTACTO.correo) + '</a>');
    return partes.length ? '<div class="mps-contacto">' + partes.join('') + '</div>' : '';
  }

  // Versión vigente de los Términos y la Política de privacidad (legal.html).
  // Si se cambia el texto legal, subir esta fecha: se volverá a registrar la aceptación.
  const VERSION_TERMINOS = '2026-11-13';
  const TERMINOS_KEY = 'mypecar_terminos_ok';

  const SVG_GOOGLE = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

  function renderLogin(opciones, alTerminar, pestañaInicial) {
    overlayEl.innerHTML = `
      <div class="mps-card">
        ${marcaHtml('Cuentas claras para tu empresa')}
        <p class="mps-titulo">${opciones.tituloApp ? escapeHtml(opciones.tituloApp) : 'Inicia sesión'}</p>
        <p class="mps-subtitulo">Entra para consultar las cuentas de tus empresas.</p>
        <div id="mps-zona-form"></div>
        <div id="mps-zona-msg"></div>
        <p class="mps-pie">Tus datos siguen guardándose en este dispositivo aunque no tengas internet.</p>
      </div>
    `;

    function filaTerminos() {
      let ya = false;
      try { ya = localStorage.getItem(TERMINOS_KEY) === VERSION_TERMINOS; } catch (e) {}
      return `
        <label class="mps-terminos">
          <input type="checkbox" id="mps-acepto" ${ya ? 'checked' : ''} />
          <span>Acepto los <a href="legal.html#terminos" target="_blank" rel="noopener">Términos</a> y la
          <a href="legal.html#privacidad" target="_blank" rel="noopener">Política de privacidad</a>.</span>
        </label>`;
    }
    function aceptoMarcado() {
      const ok = overlayEl.querySelector('#mps-acepto').checked;
      if (!ok) { mostrarMsg('Obligatorio: marca la casilla de Términos y Política de privacidad para ingresar.', 'error'); return false; }
      try { localStorage.setItem(TERMINOS_KEY, VERSION_TERMINOS); } catch (e) {}
      return true;
    }

    function renderPrincipal() {
      const zona = overlayEl.querySelector('#mps-zona-form');
      zona.innerHTML = `
        <button class="mps-btn mps-btn-google" id="mps-btn-google" type="button">${SVG_GOOGLE}<span>Continuar con Google</span></button>
        <div class="mps-separador"><span>o con tu correo</span></div>
        <label class="mps-label" for="mps-email">Correo electrónico</label>
        <input class="mps-input" type="email" id="mps-email" autocomplete="username" inputmode="email" placeholder="tu@empresa.com" />
        <button class="mps-btn mps-btn-primario" id="mps-btn-enlace" type="button">Ingresar con correo</button>
        ${filaTerminos()}
        <p class="mps-ayuda">Te enviaremos un enlace de acceso a tu correo. No necesitas contraseña.</p>
        <p class="mps-centro"><span class="mps-link" id="mps-link-pass">Ya tengo contraseña</span></p>
      `;
      overlayEl.querySelector('#mps-btn-google').addEventListener('click', async () => {
        if (!aceptoMarcado()) return;
        await conAcciónBotón('mps-btn-google', async () => { await global.MypecarSync.auth.iniciarConGoogle(); });
      });
      overlayEl.querySelector('#mps-btn-enlace').addEventListener('click', async () => {
        const email = overlayEl.querySelector('#mps-email').value.trim();
        if (!email) { mostrarMsg('Escribe tu correo electrónico.', 'error'); return; }
        if (!aceptoMarcado()) return;
        await conAcciónBotón('mps-btn-enlace', async () => {
          await global.MypecarSync.auth.enviarEnlaceMagico(email);
          mostrarMsg('Listo. Revisa tu correo (' + escapeHtml(email) + ') y haz clic en el enlace para entrar. Si no lo ves, mira en Spam.', 'ok');
        });
      });
      overlayEl.querySelector('#mps-link-pass').addEventListener('click', renderPassword);
    }

    function renderPassword() {
      overlayEl.querySelector('#mps-zona-msg').innerHTML = '';
      const zona = overlayEl.querySelector('#mps-zona-form');
      zona.innerHTML = `
        <label class="mps-label" for="mps-email">Correo electrónico</label>
        <input class="mps-input" type="email" id="mps-email" autocomplete="username" inputmode="email" placeholder="tu@empresa.com" />
        <label class="mps-label" for="mps-pass">Contraseña</label>
        <input class="mps-input" type="password" id="mps-pass" autocomplete="current-password" placeholder="••••••••" />
        <button class="mps-btn mps-btn-primario" id="mps-btn-login" type="button">Iniciar sesión</button>
        ${filaTerminos()}
        <p class="mps-centro"><span class="mps-link" id="mps-link-volver">← Volver</span></p>
      `;
      overlayEl.querySelector('#mps-btn-login').addEventListener('click', async () => {
        const email = overlayEl.querySelector('#mps-email').value.trim();
        const pass = overlayEl.querySelector('#mps-pass').value;
        if (!email || !pass) { mostrarMsg('Completa tu correo y contraseña.', 'error'); return; }
        if (!aceptoMarcado()) return;
        await conAcciónBotón('mps-btn-login', async () => {
          await global.MypecarSync.auth.iniciarSesion(email, pass);
          renderElegirEmpresa(opciones, alTerminar);
        });
      });
      overlayEl.querySelector('#mps-link-volver').addEventListener('click', () => { overlayEl.querySelector('#mps-zona-msg').innerHTML = ''; renderPrincipal(); });
    }

    function mostrarMsg(texto, tipo) {
      const zona = overlayEl.querySelector('#mps-zona-msg');
      zona.innerHTML = `<div class="${tipo === 'error' ? 'mps-error' : 'mps-ok'}">${texto}</div>`;
    }

    async function conAcciónBotón(idBoton, fn) {
      const btn = overlayEl.querySelector('#' + idBoton);
      const original = btn.innerHTML;
      btn.disabled = true; btn.textContent = 'Un momento...';
      overlayEl.querySelector('#mps-zona-msg').innerHTML = '';
      try { await fn(); }
      catch (e) { mostrarMsg(mensajeError(e), 'error'); }
      finally { if (overlayEl.contains(btn)) { btn.disabled = false; btn.innerHTML = original; } }
    }

    if (pestañaInicial === 'password') renderPassword(); else renderPrincipal();
  }

  // ---------------------------------------------------------------------
  // Paso 2: Elegir empresa (o crear la primera)
  // ---------------------------------------------------------------------
  function renderElegirEmpresa(opciones, alTerminar) {
    overlayEl.innerHTML = `
      <div class="mps-card">
        ${marcaHtml('Empresas de tu cuenta')}
        <p class="mps-titulo">¿En qué empresa quieres trabajar hoy?</p>
        <p class="mps-subtitulo">Elige la empresa que vas a administrar. Puedes cambiar de empresa cuando quieras.</p>
        <div id="mps-lista-empresas"><p style="font-size:13px;color:#64748b;">Cargando tus empresas...</p></div>
        <div id="mps-zona-msg"></div>
        <p style="text-align:center;margin-top:14px;">
          <span class="mps-link" id="mps-link-cerrar-sesion">Cerrar sesión</span>
        </p>
      </div>
    `;
    overlayEl.querySelector('#mps-link-cerrar-sesion').addEventListener('click', async () => {
      try { await global.MypecarSync.auth.cerrarSesion(); } catch (e) {}
      renderLogin(opciones, alTerminar, 'login');
    });

    // Deja constancia en la cuenta de qué versión de los Términos aceptó (si la marcó en este equipo)
    try {
      if (localStorage.getItem(TERMINOS_KEY) === VERSION_TERMINOS && global.MypecarSync.auth.registrarAceptacion) {
        global.MypecarSync.auth.registrarAceptacion(VERSION_TERMINOS).catch(() => {});
      }
    } catch (e) {}

    cargarEmpresas();

    async function cargarEmpresas() {
      const zona = overlayEl.querySelector('#mps-lista-empresas');
      try {
        const lista = await global.MypecarSync.empresas.listarMias();
        if (!lista || lista.length === 0) {
          renderFormCrearEmpresa(true);
          return;
        }
        zona.innerHTML = '';
        if (lista.length > 4) {
          const bus = document.createElement('div');
          bus.innerHTML = '<label class="mps-label">Buscar por nombre o RUC</label><input class="mps-input" id="mps-buscar-emp" placeholder="Nombre de empresa o RUC" /><p class="mps-contador" id="mps-cont-emp"></p>';
          zona.appendChild(bus);
          const inp = bus.querySelector('#mps-buscar-emp');
          inp.addEventListener('input', () => {
            const q = inp.value.trim().toLowerCase(); let n = 0;
            zona.querySelectorAll('.mps-empresa-item').forEach(it => {
              const ok = !q || it.textContent.toLowerCase().indexOf(q) !== -1;
              it.style.display = ok ? '' : 'none'; if (ok) n++;
            });
            bus.querySelector('#mps-cont-emp').textContent = n + (n === 1 ? ' empresa disponible' : ' empresas disponibles');
          });
        }
        lista.forEach(emp => {
          const item = document.createElement('div');
          item.className = 'mps-empresa-item';
          item.innerHTML = `
            <div>
              <div class="mps-empresa-nombre">${escapeHtml(emp.nombre_comercial || emp.razon_social || 'Empresa')}</div>
              <div class="mps-empresa-ruc">RUC ${escapeHtml(emp.ruc || '-')}</div>
            </div>
            <div class="mps-ir">Trabajar aquí →</div>
          `;
          item.addEventListener('click', () => {
            global.MypecarSync.empresas.seleccionar(emp.id);
            lsSet(claveNombreEmpresa(emp.id), emp.nombre_comercial || emp.razon_social || 'Empresa');
            limpiarOverlay();
            alTerminar();
          });
          zona.appendChild(item);
        });
        const otra = document.createElement('p');
        otra.style.textAlign = 'center';
        otra.style.marginTop = '12px';
        otra.innerHTML = '<span class="mps-link" id="mps-link-otra-empresa">+ Registrar otra empresa</span>';
        zona.appendChild(otra);
        zona.querySelector('#mps-link-otra-empresa').addEventListener('click', () => renderFormCrearEmpresa(false));
      } catch (e) {
        zona.innerHTML = `<div class="mps-error">${mensajeError(e)}</div>`;
      }
    }

    function renderFormCrearEmpresa(esLaPrimera) {
      const zona = overlayEl.querySelector('#mps-lista-empresas');
      zona.innerHTML = `
        ${esLaPrimera ? '<p style="font-size:13px;color:#64748b;margin:0 0 10px;">Todavía no tienes ninguna empresa registrada. Crea la primera:</p>' : ''}
        <label class="mps-label">RUC</label>
        <input class="mps-input" id="mps-emp-ruc" placeholder="20123456789" />
        <label class="mps-label">Razón social</label>
        <input class="mps-input" id="mps-emp-razon" placeholder="NEGOCIOS GOURMET RD S.A.C." />
        <label class="mps-label">Nombre comercial</label>
        <input class="mps-input" id="mps-emp-comercial" placeholder="Pollería Santa Clara" />
        <button class="mps-btn mps-btn-primario" id="mps-btn-crear-empresa">Guardar empresa</button>
        ${!esLaPrimera ? '<button class="mps-btn mps-btn-secundario" id="mps-btn-volver-lista">Volver a mi lista</button>' : ''}
      `;
      if (!esLaPrimera) {
        overlayEl.querySelector('#mps-btn-volver-lista').addEventListener('click', cargarEmpresas);
      }
      overlayEl.querySelector('#mps-btn-crear-empresa').addEventListener('click', async () => {
        const ruc = overlayEl.querySelector('#mps-emp-ruc').value.trim();
        const razonSocial = overlayEl.querySelector('#mps-emp-razon').value.trim();
        const nombreComercial = overlayEl.querySelector('#mps-emp-comercial').value.trim();
        const msgZona = overlayEl.querySelector('#mps-zona-msg');
        if (!razonSocial) { msgZona.innerHTML = '<div class="mps-error">Escribe al menos la razón social.</div>'; return; }
        const btn = overlayEl.querySelector('#mps-btn-crear-empresa');
        btn.disabled = true; btn.textContent = 'Guardando...';
        try {
          const emp = await global.MypecarSync.empresas.crear({ ruc, razonSocial, nombreComercial });
          global.MypecarSync.empresas.seleccionar(emp.id);
          lsSet(claveNombreEmpresa(emp.id), emp.nombre_comercial || emp.razon_social || 'Empresa');
          limpiarOverlay();
          alTerminar();
        } catch (e) {
          msgZona.innerHTML = `<div class="mps-error">${mensajeError(e)}</div>`;
          btn.disabled = false; btn.textContent = 'Guardar empresa';
        }
      });
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------------
  // Etiqueta fija (badge) para cambiar de empresa / cerrar sesión
  // ---------------------------------------------------------------------
  // Aviso flotante cuando la licencia está por vencer (15 días antes) o ya venció (periodo de gracia).
  function mostrarAvisoLicencia() {
    try {
      const sync = global.MypecarSync;
      if (!sync || !sync.empresas || !sync.empresas.obtenerLicencia) return;
      const emp = sync.empresas.activaId && sync.empresas.activaId();
      const lic = emp ? sync.empresas.obtenerLicencia(emp) : null;
      if (!lic || lic.bloqueada || lic.dias > 15) return;
      if (sessionStorage.getItem('mps_aviso_lic_' + emp + '_' + lic.vence_en) === 'cerrado') return;
      if (document.getElementById('mps-aviso-lic')) return;
      const f = lic.vence_en.split('-').reverse().join('/');
      let clase = 'amb', texto;
      if (lic.dias > 1) texto = 'Tu licencia vence en <b>' + lic.dias + ' días</b> (' + f + '). Renueva para no perder el acceso.';
      else if (lic.dias === 1) texto = 'Tu licencia vence <b>mañana</b> (' + f + '). Renueva para no perder el acceso.';
      else if (lic.dias === 0) texto = 'Tu licencia vence <b>hoy</b>. Renueva para no perder el acceso.';
      else { clase = 'roj'; texto = 'Tu licencia <b>venció el ' + f + '</b>. Te quedan <b>' + lic.diasDeGracia + (lic.diasDeGracia === 1 ? ' día' : ' días') + '</b> para renovar; después se suspenderá el acceso.'; }
      const wa = String(CONTACTO.whatsapp || '').replace(/\D/g, '');
      if (wa) texto += ' <a target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Hola, quiero renovar mi licencia de MYPECAR PLUS.') + '">Renovar</a>';
      else if (CONTACTO.correo) texto += ' Escríbenos a <a href="mailto:' + escapeHtml(CONTACTO.correo) + '">' + escapeHtml(CONTACTO.correo) + '</a>.';
      const div = document.createElement('div');
      div.id = 'mps-aviso-lic'; div.className = 'mps-aviso-lic ' + clase;
      div.innerHTML = '<span>' + texto + '</span><span class="x" title="Cerrar">✕</span>';
      div.querySelector('.x').addEventListener('click', () => {
        try { sessionStorage.setItem('mps_aviso_lic_' + emp + '_' + lic.vence_en, 'cerrado'); } catch (e) {}
        div.remove();
      });
      document.body.appendChild(div);
    } catch (e) { /* el aviso nunca debe impedir abrir la app */ }
  }

  function montarBadge(opciones) {
    mostrarAvisoLicencia();
    // Limpia lo que haya de una llamada anterior.
    ['mps-barra', 'mps-badge', 'mps-badge-menu'].forEach(id => {
      const e = document.getElementById(id); if (e && e.parentNode) e.parentNode.removeChild(e);
    });
    document.querySelectorAll('[data-mps-extra]').forEach(e => e.parentNode && e.parentNode.removeChild(e));
    const empresaIdActiva = global.MypecarSync.empresas.activaId();
    const nombre = lsGet(claveNombreEmpresa(empresaIdActiva), null) || 'Empresa activa';

    // Dónde poner "← Módulos": en la barra de pestañas del encabezado, junto a "Ajustes".
    const ajustes = document.getElementById('btn-tab-settings');
    const navEl = ajustes ? ajustes.parentElement : document.querySelector('header nav');
    // Dónde cambiar de empresa: el recuadro "Sede contable" del encabezado.
    const nameEl = document.getElementById('nav-empresa-name');

    if (!navEl && !nameEl) { montarBarraRespaldo(opciones, nombre); return; }

    if (navEl) {
      const volver = document.createElement('a');
      volver.id = 'mps-volver';
      volver.setAttribute('data-mps-extra', '1');
      volver.href = 'modulos.html';
      volver.className = 'mps-pestana';
      volver.innerHTML = '<span aria-hidden="true">←</span> Módulos';
      volver.setAttribute('aria-label', 'Volver a la pantalla de módulos');
      navEl.appendChild(volver);
    }

    if (nameEl) {
      // El recuadro "Sede contable" se vuelve el selector de empresa.
      const box = (nameEl.parentElement && /sede contable/i.test(nameEl.parentElement.textContent)) ? nameEl.parentElement : nameEl;
      box.classList.add('mps-selector');
      box.title = 'Cambiar de empresa';
      box.setAttribute('role', 'button');
      box.tabIndex = 0;
      box.addEventListener('click', () => toggleMenu(opciones, box));
      box.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleMenu(opciones, box); } });
    } else if (navEl) {
      // Módulos sin recuadro de empresa (Reportes, Auditoría): una pestaña con la empresa.
      const chip = document.createElement('button');
      chip.id = 'mps-badge';
      chip.type = 'button';
      chip.setAttribute('data-mps-extra', '1');
      chip.className = 'mps-pestana';
      chip.textContent = '🏢 ' + nombre + ' ▾';
      chip.title = 'Cambiar de empresa, gestionar accesos o cerrar sesión';
      chip.addEventListener('click', () => toggleMenu(opciones, chip));
      navEl.appendChild(chip);
    }
  }

  // Respaldo: si un módulo no tuviera encabezado reconocible, se usa una barra delgada arriba.
  function montarBarraRespaldo(opciones, nombre) {
    const barra = document.createElement('div');
    barra.id = 'mps-barra';
    barra.className = 'mps-barra';
    const volver = document.createElement('a');
    volver.id = 'mps-volver';
    volver.className = 'mps-volver';
    volver.href = 'modulos.html';
    volver.textContent = '← Módulos';
    barra.appendChild(volver);
    const badge = document.createElement('div');
    badge.id = 'mps-badge';
    badge.className = 'mps-badge';
    badge.textContent = '🏢 ' + nombre + ' ▾';
    badge.addEventListener('click', () => toggleMenu(opciones, badge));
    barra.appendChild(badge);
    document.body.insertBefore(barra, document.body.firstChild);
  }

  // Menú de empresa: lista de tus empresas (nombre comercial) para cambiar,
  // y más abajo "Gestionar accesos" (solo dueño) y "Cerrar sesión".
  async function toggleMenu(opciones, ancla) {
    const existente = document.getElementById('mps-badge-menu');
    if (existente) { existente.parentNode.removeChild(existente); return; }
    const menu = document.createElement('div');
    menu.id = 'mps-badge-menu';
    menu.className = 'mps-badge-menu';
    const r = ancla ? ancla.getBoundingClientRect() : null;
    if (r) {
      menu.style.top = Math.round(r.bottom + 6) + 'px';
      menu.style.bottom = 'auto';
      const derecha = Math.max(8, Math.round(window.innerWidth - r.right));
      menu.style.right = derecha + 'px';
    }
    menu.innerHTML = '<div class="mps-menu-carga">Cargando…</div>';
    document.body.appendChild(menu);

    const empresaId = global.MypecarSync.empresas.activaId();
    let esOwner = false, lista = [];
    try { esOwner = await global.MypecarSync.empresas.esOwner(empresaId); } catch (e) {}
    try { lista = (await global.MypecarSync.empresas.listarMias()) || []; } catch (e) {}
    if (!menu.parentNode) return; // se cerró mientras cargaba

    const nombreDe = emp => emp.nombre_comercial || emp.razon_social || 'Empresa';
    const filas = lista.map(emp => `
      <div class="mps-menu-emp${emp.id === empresaId ? ' activa' : ''}" data-emp="${escapeHtml(emp.id)}">
        <span>${emp.id === empresaId ? '✓ ' : ''}${escapeHtml(nombreDe(emp))}</span>
        <small>RUC ${escapeHtml(emp.ruc || '-')}</small>
      </div>`).join('');
    menu.innerHTML = `
      ${lista.length ? '<div class="mps-menu-titulo">Cambiar de empresa</div>' + filas + '<hr class="mps-menu-sep">' : ''}
      ${esOwner ? '<div id="mps-menu-accesos" class="mps-menu-item">Gestionar accesos</div>' : ''}
      <div id="mps-menu-nueva" class="mps-menu-item">+ Registrar otra empresa</div>
      <div id="mps-menu-salir" class="mps-menu-item">Cerrar sesión</div>
    `;

    menu.querySelectorAll('.mps-menu-emp').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-emp');
        if (id === empresaId) { menu.parentNode && menu.parentNode.removeChild(menu); return; }
        const emp = lista.find(x => x.id === id);
        try { global.MypecarSync.empresas.seleccionar(id); } catch (e) { return; }
        if (emp) lsSet(claveNombreEmpresa(id), nombreDe(emp));
        // Recarga para que todo el módulo quede con los datos de la empresa elegida.
        location.reload();
      });
    });
    const acc = menu.querySelector('#mps-menu-accesos');
    if (acc) acc.addEventListener('click', () => {
      menu.parentNode.removeChild(menu);
      renderGestionarAccesos(opciones, empresaId);
    });
    menu.querySelector('#mps-menu-nueva').addEventListener('click', () => {
      menu.parentNode.removeChild(menu);
      mostrarFlujoCompleto(opciones, () => location.reload());
    });
    menu.querySelector('#mps-menu-salir').addEventListener('click', async () => {
      menu.parentNode.removeChild(menu);
      try { await global.MypecarSync.auth.cerrarSesion(); } catch (e) {}
      lsSet(EMPRESA_NOMBRE_KEY, null);
      location.reload();
    });
    setTimeout(() => {
      function cerrar(ev) {
        if (ev.type === 'keydown' && ev.key !== 'Escape') return;
        if (ev.type === 'click' && (menu.contains(ev.target) || (ancla && ancla.contains(ev.target)))) return;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener('click', cerrar);
        document.removeEventListener('keydown', cerrar);
      }
      document.addEventListener('click', cerrar);
      document.addEventListener('keydown', cerrar);
    }, 0);
  }

  // ---------------------------------------------------------------------
  // Panel "Gestionar accesos" (2026-09-16) — solo para el dueño (Contador
  // Jefe). Muestra la lista de miembros de la empresa activa y, para cada
  // uno que no sea dueño, una casilla por cada una de las 9 apps para
  // decidir si puede entrar o no. El dueño siempre tiene acceso a todo, así
  // que no se le muestran casillas — no tendría efecto quitárselas.
  // ---------------------------------------------------------------------
  const APPS_MYPECAR = [
    { app: 'ventas', etiqueta: '01 Ventas' },
    { app: 'compras', etiqueta: '02 Compras' },
    { app: 'caja', etiqueta: '03 Caja y Bancos' },
    { app: 'diario', etiqueta: '04 Libro Diario' },
    { app: 'personal', etiqueta: '05 Personal' },
    { app: 'activos', etiqueta: '06 Activos Fijos' },
    { app: 'reportes', etiqueta: '07 Reportes' },
    { app: 'auditoria', etiqueta: '08 Auditoría' },
    { app: 'inventario', etiqueta: '09 Inventario' }
  ];

  function renderGestionarAccesos(opciones, empresaId) {
    limpiarOverlay();
    overlayEl = document.createElement('div');
    overlayEl.className = 'mps-overlay';
    liberarPagina();
    document.body.appendChild(overlayEl);
    overlayEl.innerHTML = `
      <div class="mps-card" style="max-width:470px;">
        <p class="mps-titulo">Gestionar accesos</p>
        <p class="mps-subtitulo">Elige qué módulos puede usar cada persona. Tú, como dueño, entras a todos.</p>
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;margin-bottom:10px;background:#f8fafc;">
          <label class="mps-label" style="margin-top:0;">Agregar persona</label>
          <details style="margin:0 0 6px;"><summary style="font-size:12px;color:#0f766e;cursor:pointer;">¿Cómo funciona?</summary><p style="font-size:12px;color:#64748b;margin:4px 0 0;line-height:1.4;">Escribe su correo y pulsa Agregar. Si todavía no tiene cuenta, queda como invitación pendiente y se vincula sola cuando cree su cuenta con ese mismo correo.</p></details>
          <div style="display:flex;gap:8px;">
            <input class="mps-input" id="mps-agregar-correo" placeholder="correo@ejemplo.com" style="margin:0;flex:1 1 auto;min-width:0;width:auto;min-height:40px;" />
            <button class="mps-btn mps-btn-primario" id="mps-btn-agregar-correo" style="margin:0;white-space:nowrap;padding:0 14px;width:auto;flex:0 0 auto;min-height:40px;font-size:13px;">Agregar</button>
          </div>
          <div id="mps-zona-msg-agregar"></div>
        </div>
        <div id="mps-zona-invitaciones"></div>
        <div id="mps-zona-miembros"><p style="font-size:13px;color:#64748b;">Cargando miembros...</p></div>
        <div id="mps-zona-msg"></div>
        <p style="text-align:center;margin-top:16px;">
          <span class="mps-link" id="mps-link-volver-accesos">Volver</span>
        </p>
      </div>
    `;
    overlayEl.querySelector('#mps-link-volver-accesos').addEventListener('click', () => {
      limpiarOverlay();
      montarBadge(opciones);
    });
    overlayEl.querySelector('#mps-btn-agregar-correo').addEventListener('click', async () => {
      const input = overlayEl.querySelector('#mps-agregar-correo');
      const correo = input.value.trim();
      const msgZona = overlayEl.querySelector('#mps-zona-msg-agregar');
      msgZona.innerHTML = '';
      if (!correo) { msgZona.innerHTML = '<div class="mps-error">Escribe un correo.</div>'; return; }
      const btn = overlayEl.querySelector('#mps-btn-agregar-correo');
      btn.disabled = true; btn.textContent = 'Agregando...';
      try {
        const resultado = await global.MypecarSync.empresas.agregarMiembroPorCorreo(empresaId, correo, 'asistente');
        if (resultado && resultado.ok) {
          if (resultado.estado === 'pendiente') {
            msgZona.innerHTML = `<div class="mps-ok">${escapeHtml(correo)} todavía no tiene cuenta — quedó como invitación pendiente. En cuanto cree su cuenta con ese correo, quedará vinculada sola. Mientras tanto, ya puedes marcarle qué apps podrá usar, más abajo.</div>`;
          } else {
            msgZona.innerHTML = `<div class="mps-ok">${escapeHtml(correo)} fue agregado/a. Ahora marca qué apps puede usar, más abajo.</div>`;
          }
          input.value = '';
          cargarMiembros();
          cargarInvitacionesPendientes();
        } else {
          const motivo = resultado && resultado.motivo;
          const textos = {
            ya_es_miembro: 'Esa persona ya tiene acceso a esta empresa — búscala en la lista de abajo.',
            ya_invitado: 'Ya hay una invitación pendiente para ese correo — búscala en "Invitaciones pendientes", más abajo.',
            no_autorizado: 'Solo el dueño de la empresa puede agregar personas.',
            rol_invalido: 'Ocurrió un problema interno al agregar a esa persona.'
          };
          msgZona.innerHTML = `<div class="mps-error">${textos[motivo] || 'No se pudo agregar a esa persona.'}</div>`;
        }
      } catch (e) {
        msgZona.innerHTML = `<div class="mps-error">${mensajeError(e)}</div>`;
      } finally {
        btn.disabled = false; btn.textContent = 'Agregar';
      }
    });
    cargarMiembros();
    cargarInvitacionesPendientes();

    async function cargarInvitacionesPendientes() {
      const zona = overlayEl.querySelector('#mps-zona-invitaciones');
      try {
        const invitaciones = await global.MypecarSync.empresas.listarInvitacionesPendientes(empresaId);
        if (!invitaciones || invitaciones.length === 0) { zona.innerHTML = ''; return; }
        const filas = invitaciones.map(inv => {
          const permitidas = new Set(inv.apps_permitidas || []);
          const casillas = APPS_MYPECAR.map(a => `
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#334155;padding:2px 0;">
              <input type="checkbox" data-app="${a.app}" ${permitidas.has(a.app) ? 'checked' : ''} />
              ${a.etiqueta}
            </label>
          `).join('');
          return `
            <div class="mps-invitacion-card" data-invitacion-id="${escapeHtml(inv.id)}" style="border:1px dashed #cbd5e1;border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fffbeb;">
              <div class="mps-empresa-nombre" style="font-size:13.5px;">${escapeHtml(inv.correo)}</div>
              <div class="mps-empresa-ruc" style="margin-bottom:6px;">Invitación pendiente — todavía no crea su cuenta</div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 6px;">${casillas}</div>
              <div style="display:flex;gap:8px;margin-top:10px;">
                <button class="mps-btn mps-btn-primario" style="padding:6px 10px;font-size:12px;min-height:32px;margin-top:0;" data-guardar-invitacion="${escapeHtml(inv.id)}">Guardar</button>
                <button class="mps-btn mps-btn-secundario" style="padding:6px 10px;font-size:12px;min-height:32px;margin-top:0;" data-cancelar-invitacion="${escapeHtml(inv.id)}">Cancelar invitación</button>
              </div>
            </div>
          `;
        }).join('');
        zona.innerHTML = `<p class="mps-label" style="margin-top:0;">Invitaciones pendientes</p>${filas}`;
        zona.querySelectorAll('[data-guardar-invitacion]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const invId = btn.dataset.guardarInvitacion;
            const card = zona.querySelector(`.mps-invitacion-card[data-invitacion-id="${invId}"]`);
            const seleccionadas = Array.from(card.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.dataset.app);
            const textoOriginal = btn.textContent;
            btn.disabled = true; btn.textContent = 'Guardando...';
            const msgZona = overlayEl.querySelector('#mps-zona-msg');
            msgZona.innerHTML = '';
            try {
              await global.MypecarSync.empresas.actualizarAppsInvitacionPendiente(invId, seleccionadas);
              msgZona.innerHTML = '<div class="mps-ok">Apps de la invitación actualizadas.</div>';
            } catch (e) {
              msgZona.innerHTML = `<div class="mps-error">${mensajeError(e)}</div>`;
            } finally {
              btn.disabled = false; btn.textContent = textoOriginal;
            }
          });
        });
        zona.querySelectorAll('[data-cancelar-invitacion]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('¿Cancelar esta invitación pendiente? Si esa persona ya tiene el enlace o intenta registrarse después, no quedará vinculada automáticamente a tu empresa.')) return;
            const invId = btn.dataset.cancelarInvitacion;
            try {
              await global.MypecarSync.empresas.cancelarInvitacionPendiente(invId);
              cargarInvitacionesPendientes();
            } catch (e) {
              overlayEl.querySelector('#mps-zona-msg').innerHTML = `<div class="mps-error">${mensajeError(e)}</div>`;
            }
          });
        });
      } catch (e) {
        // No es crítico: si falla (ej. todavía no se corrió el script SQL
        // nuevo), simplemente no se muestra esta sección.
        zona.innerHTML = '';
      }
    }

    async function cargarMiembros() {
      const zona = overlayEl.querySelector('#mps-zona-miembros');
      try {
        const miembros = await global.MypecarSync.empresas.listarMiembros(empresaId);
        if (!miembros || miembros.length === 0) {
          zona.innerHTML = '<p style="font-size:13px;color:#64748b;">No se encontraron miembros.</p>';
          return;
        }
        zona.innerHTML = '';
        miembros.forEach(m => {
          const card = document.createElement('div');
          card.style.cssText = 'border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;margin-bottom:8px;';
          if (m.rol === 'owner') {
            card.innerHTML = `
              <div class="mps-empresa-nombre" style="font-size:13.5px;">${escapeHtml(m.email)}</div>
              <div class="mps-empresa-ruc" style="margin-bottom:6px;">Dueño de la empresa — acceso a todas las apps</div>
              <button class="mps-btn mps-btn-secundario" style="padding:6px 10px;font-size:12px;min-height:32px;margin-top:0;" data-quitar-dueno="${escapeHtml(m.user_id)}">Quitar como dueño(a)</button>
            `;
            card.querySelector('[data-quitar-dueno]').addEventListener('click', async () => {
              if (!confirm(`¿Quitarle el rol de dueño(a) a ${m.email}? Quedará como asistente, sin acceso a "Gestionar accesos", y tendrás que marcarle qué apps puede usar.`)) return;
              const btn = card.querySelector('[data-quitar-dueno]');
              const textoOriginal = btn.textContent;
              btn.disabled = true; btn.textContent = 'Aplicando...';
              const msgZona = overlayEl.querySelector('#mps-zona-msg');
              msgZona.innerHTML = '';
              try {
                const resultado = await global.MypecarSync.empresas.quitarCodueno(empresaId, m.user_id, 'asistente');
                if (resultado && resultado.ok) {
                  msgZona.innerHTML = `<div class="mps-ok">${escapeHtml(m.email)} ya no es dueño(a). Ahora puedes marcarle qué apps puede usar.</div>`;
                  cargarMiembros();
                } else {
                  const motivo = resultado && resultado.motivo;
                  const textos = {
                    ultimo_dueno: 'No se puede quitar: es el único dueño que queda. Primero nombra a otra persona como co-dueño(a).',
                    no_autorizado: 'Solo el dueño de la empresa puede hacer este cambio.',
                    no_encontrado: 'No se encontró a esa persona.'
                  };
                  msgZona.innerHTML = `<div class="mps-error">${textos[motivo] || 'No se pudo completar el cambio.'}</div>`;
                  btn.disabled = false; btn.textContent = textoOriginal;
                }
              } catch (e) {
                msgZona.innerHTML = `<div class="mps-error">${mensajeError(e)}</div>`;
                btn.disabled = false; btn.textContent = textoOriginal;
              }
            });
          } else {
            const permitidas = new Set(m.apps_permitidas || []);
            const casillas = APPS_MYPECAR.map(a => `
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#334155;padding:2px 0;">
                <input type="checkbox" data-app="${a.app}" ${permitidas.has(a.app) ? 'checked' : ''} />
                ${a.etiqueta}
              </label>
            `).join('');
            card.innerHTML = `
              <div class="mps-empresa-nombre" style="font-size:13.5px;">${escapeHtml(m.email)}</div>
              <div class="mps-empresa-ruc" style="margin-bottom:6px;">${escapeHtml(m.rol)}</div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 6px;">${casillas}</div>
              <div style="display:flex;gap:8px;margin-top:10px;">
                <button class="mps-btn mps-btn-primario" style="padding:6px 10px;font-size:12px;min-height:32px;margin-top:0;" data-guardar="${escapeHtml(m.user_id)}">Guardar</button>
                <button class="mps-btn mps-btn-secundario" style="padding:6px 10px;font-size:12px;min-height:32px;margin-top:0;" data-hacer-dueno="${escapeHtml(m.user_id)}">Hacer también dueño(a)</button>
              </div>
            `;
            card.querySelector('[data-guardar]').addEventListener('click', async (ev) => {
              const btn = ev.target;
              const seleccionadas = Array.from(card.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.dataset.app);
              const textoOriginal = btn.textContent;
              btn.disabled = true; btn.textContent = 'Guardando...';
              const msgZona = overlayEl.querySelector('#mps-zona-msg');
              msgZona.innerHTML = '';
              try {
                await global.MypecarSync.empresas.actualizarPermisosApp(empresaId, m.user_id, seleccionadas);
                msgZona.innerHTML = `<div class="mps-ok">Permisos de ${escapeHtml(m.email)} actualizados.</div>`;
              } catch (e) {
                msgZona.innerHTML = `<div class="mps-error">${mensajeError(e)}</div>`;
              } finally {
                btn.disabled = false; btn.textContent = textoOriginal;
              }
            });
            card.querySelector('[data-hacer-dueno]').addEventListener('click', async () => {
              if (!confirm(`¿Nombrar a ${m.email} también como dueño(a) de la empresa? Tendrá acceso total a las 9 apps y podrá gestionar accesos de todo el equipo, igual que tú.`)) return;
              const btn = card.querySelector('[data-hacer-dueno]');
              const textoOriginal = btn.textContent;
              btn.disabled = true; btn.textContent = 'Aplicando...';
              const msgZona = overlayEl.querySelector('#mps-zona-msg');
              msgZona.innerHTML = '';
              try {
                const resultado = await global.MypecarSync.empresas.hacerCodueno(empresaId, m.user_id);
                if (resultado && resultado.ok) {
                  msgZona.innerHTML = `<div class="mps-ok">${escapeHtml(m.email)} ahora también es dueño(a) de la empresa.</div>`;
                  cargarMiembros();
                } else {
                  msgZona.innerHTML = '<div class="mps-error">No se pudo completar el cambio.</div>';
                  btn.disabled = false; btn.textContent = textoOriginal;
                }
              } catch (e) {
                msgZona.innerHTML = `<div class="mps-error">${mensajeError(e)}</div>`;
                btn.disabled = false; btn.textContent = textoOriginal;
              }
            });
          }
          zona.appendChild(card);
        });
      } catch (e) {
        zona.innerHTML = `<div class="mps-error">${mensajeError(e)}</div>`;
      }
    }
  }

  global.MypecarLogin = { asegurarAcceso };
})(window);
