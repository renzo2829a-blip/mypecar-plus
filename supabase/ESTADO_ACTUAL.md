# Estado real de Supabase (proyecto MYPECAR) — 2026-11-24

Este documento es la fuente de verdad de lo que hay aplicado. Si cambia algo en Supabase, se actualiza aquí.

## Reglas de acceso (RLS)
- RLS activo en todas las tablas de `public`. Nunca se desactiva.
- Tablas de datos (`app_config`, `ventas`, `compras`, `caja_movimientos`, `diario_*`, `personal_trabajadores`, `activos*`,
  `inventario_*`): leer, insertar, actualizar y borrar exigen **miembro de la empresa + empresa autorizada + permiso para ese módulo**.
  En `app_config` además la **escritura** exige **licencia vigente** (`empresa_licencia_vigente`).
- `empresas`: ver las propias; crear solo a tu nombre y **siempre queda "pendiente"** (disparador `trg_forzar_empresa_nueva_pendiente`);
  editar solo el dueño; el estado y la licencia los protegen `trg_proteger_estado_empresa` y `trg_proteger_licencia_empresa`.
- `empresa_usuarios` e `invitaciones_pendientes`: solo el dueño administra (ver `pg_policies`).
- Sin políticas a propósito (el navegador no las toca): `administradores`, `solicitudes_pago`, `pagos_recibidos`, `avisos_enviados`,
  `pruebas_gratis`, `go_maestro_diario`, `decolecta_cache`, `keepalive_log` y las tablas `respaldo_*`.

## Funciones y disparadores clave
- `reportar_pago` (acceso provisional de 48 h con RUC real, tope diario y tope por hora), `ruc_valido`, `yape_conciliar`,
  `iniciar_prueba_gratis` (prueba de 14 días), `fin_prueba_al_extender_licencia` (el pago convierte la prueba en suscripción),
  `empresa_licencia_vigente`.
- Tarea diaria `suspender_vencidas` (05:10 UTC): pasa a "suspendida" la empresa con licencia vencida y sin gracia.

## Edge Functions
- `ruc-dni` (exige sesión), `avisar` (v6: registro, pago reportado y prueba iniciada), `yape-webhook`, `consulta-documento` (anterior).

## Migraciones (orden)
lote1 (funciones endurecidas) · lote2 (empresas y catálogo con membresía) · lote3 (permisos sobrantes) · respaldo 20-nov ·
admin_activacion_empresas · pagos_yape · acceso_provisional_48h · respaldo 24-nov · grupoA (empresa nueva siempre pendiente) ·
grupoB (provisional a prueba de abuso) · prueba_gratis_14_dias · prueba_gratis_fin_de_prueba_al_pagar.

## Revisión de seguridad (24-nov-2026)
- Migración `quitar_permisos_peligrosos_go_maestro_decolecta`: se quitó TRUNCATE, TRIGGER y REFERENCES a `anon` y `authenticated` en
  `go_maestro_diario` y `decolecta_cache` (con autorización expresa del dueño). RLS y "sin políticas" se mantienen. Reversible con GRANT.
- Migración `minimo_permiso_tablas_internas`: `app_version_minima` queda solo lectura para usuarios con sesión; `app_config_respaldo` y
  `keepalive_log` sin acceso desde el navegador. Ya estaban bloqueadas por RLS; ahora tampoco tienen el permiso.
- Funciones `SECURITY DEFINER`: todas tienen `search_path` fijo. Las internas (disparadores, tareas programadas, Yape, renovar) NO las puede
  ejecutar ni `anon` ni `authenticated`. Las 19 que puede ejecutar un usuario con sesión son las que usa la aplicación (14 vía `rpc`) o las
  que usan las políticas de RLS (`es_miembro_de_empresa`, `empresa_autorizada`, `empresa_licencia_vigente`, `puedo_unirme_como_creador`,
  `ping_db`). Cada una valida por dentro que el usuario sea miembro/dueño/administrador. No se deben revocar.
- `ping_db()` (la única que puede ejecutar `anon`) solo devuelve `{ok, hora}`; no lee datos. Se deja como está por si algún monitor externo
  la usa para mantener activo el proyecto Free.
- Prueba con CLIENTE DEMO DOS (dueño con sesión): ve sus propios datos, lee la versión mínima y no puede escribirla.

## Auditoría de seguridad y usabilidad (24-nov-2026, segunda parte)
- `consulta-documento` (v27): estaba ABIERTA a cualquiera sin sesión (verify_jwt=false) y consultaba DNI/RUC con la clave de
  Decolecta. Ahora es el mismo código que `ruc-dni`: exige sesión, ser miembro de la empresa, número válido y límite de uso.
  Copia en `supabase/functions/consulta-documento/index.ts`.
- Datos leídos (mypecar-sync.js `neutralizarHtml`): además de < y >, las comillas " y ' dentro de los textos pasan a ” y ’.
  Cierra la inyección de atributos (p. ej. un nombre de producto con `" onmouseover="…`), comprobada en prueba antes del arreglo.
- `_headers`: Content-Security-Policy con object-src 'none', base-uri 'self', frame-ancestors 'self', form-action 'self'.
- `yape-webhook` exige la clave secreta (rechaza si no está configurada); `avisar` exige sesión y membresía.
- Accesibilidad (mypecar-mobile.js): todo botón de solo ícono recibe nombre y tooltip; los campos sin etiqueta toman la de su
  costado o la de su columna (de ~300 sin etiqueta a 13).

## Portal del administrador (24-nov-2026)
- Migración `admin_portal_resumen_y_pagos`: funciones NUEVAS solo de lectura `admin_resumen_empresas()` (empresas con plan_nombre,
  prueba gratis, usuarios y último pago reportado) y `admin_listar_pagos(p_dias)` (solicitudes y pagos Yape recibidos). Ambas exigen
  `es_admin()`; `anon` sin permiso. `admin.html` las usa y, si fallan, vuelve a `admin_listar_empresas()`.
- Versión mínima: `VERSION_SYNC` y `MYPECAR_APP_VERSION` = 2026-11-24; `app_version_minima` se sube a 2026-11-24 después de publicar.

## Tipo de cambio SUNAT automático (24-nov-2026)
- Tabla `tipo_cambio_sunat` (caché del T.C. publicado por SUNAT; dato público). RLS activo, sin políticas, sin permisos para
  anon/authenticated: solo la usa la Edge Function `tipo-cambio` (verify_jwt, exige sesión, límite 60/min por usuario).
- Fuentes: Decolecta (DECOLECTA_TOKEN) y, para el día de hoy, https://www.sunat.gob.pe/a/txt/tipoCambio.txt. Si ese día no hubo
  publicación, usa el último publicado (hasta 4 días antes). Cada fecha se consulta a la fuente una sola vez.
- En 01/02/03 `config.tcAutomaticoSunat` (encendido en empresas nuevas confirmadas con la nube; las existentes, en Ajustes).
- Portal admin: Google pide elegir cuenta y, si la cuenta no es administradora, lo dice y permite cambiarla.

## Correos al cliente en la prueba gratuita (24-nov-2026)
- `avisar` v7: al iniciar la prueba también envía la **bienvenida** al correo de la sesión del cliente (una vez; clave `bienvenida`).
- `pruebas_gratis.email`: lo guarda `iniciar_prueba_gratis` desde el JWT (no se lee auth.users).
- Edge Function `recordatorios-prueba` (verify_jwt=false; exige la clave de Vault `cron_recordatorios` vía
  `verificar_cron_recordatorios`, solo service_role): correos cuando quedan 4 días, 1 día y al terminar (hasta 3 días después).
  Se marca en `avisos_enviados` solo si el correo salió. `{probar:true}` no envía.
- Tarea `mypecar-recordatorios-prueba` (pg_cron, 14:05 UTC = 09:05 Perú) con **pg_net** (activado para esto). Los permisos de
  `net` para anon/authenticated los otorga supabase_admin y no se pueden quitar desde postgres; el esquema `net` no está en la API.
- **Remitente:** si `RESEND_FROM` no es un dominio verificado en Resend (p. ej. sigue en onboarding@resend.dev), Resend solo
  entrega al correo dueño de la cuenta Resend: los correos a clientes fallan (se ve en los registros de las funciones).

## Pendientes conocidos
- "Leaked password protection": no disponible en el plan Free (el panel pide plan Pro). Se activa en Auth → Sign In / Providers → Email si
  algún día se pasa a Pro.
- Sin respaldos automáticos (plan Free): solo existen las copias `respaldo_*` dentro de la misma base y la foto diaria `app_config_respaldo`.
  Falta un respaldo externo periódico (decisión del dueño sobre dónde guardarlo).

## Aviso de novedades (25-nov-2026)
- `novedades.json` + `mypecar-novedades.js` (cargado en `modulos.html` y los 9 módulos): aviso pequeño con botón «Aceptar» que cada cliente ve una vez por actualización (cookie `mpn` con la versión vista).
- **Al publicar algo que el cliente note:** editar `novedades.json` (cambiar `version`, p. ej. `2026-12-01.1`, y la lista `items`, máx. 5 líneas cortas). Si no se cambia `version`, nadie vuelve a ver el aviso.
- Invitación para instalar la app en el celular: `mypecar-instalar.js` + `manifest.webmanifest` + `sw.js` (cookie `mpi`).
