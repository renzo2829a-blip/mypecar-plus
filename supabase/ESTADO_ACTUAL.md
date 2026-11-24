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

## Pendientes conocidos
- `go_maestro_diario` y `decolecta_cache`: el rol anónimo tiene permisos amplios (incluye TRUNCATE; RLS no los frena). No se tocan por
  regla de la casa; decisión del dueño.
- "Leaked password protection" apagado (se enciende en el panel: Auth → Passwords).
