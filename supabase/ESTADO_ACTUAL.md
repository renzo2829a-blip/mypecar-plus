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

## Pendientes conocidos
- "Leaked password protection": no disponible en el plan Free (el panel pide plan Pro). Se activa en Auth → Sign In / Providers → Email si
  algún día se pasa a Pro.
- Sin respaldos automáticos (plan Free): solo existen las copias `respaldo_*` dentro de la misma base y la foto diaria `app_config_respaldo`.
  Falta un respaldo externo periódico (decisión del dueño sobre dónde guardarlo).
