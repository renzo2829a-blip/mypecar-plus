-- =====================================================================================================
-- ⛔ NO APLICAR ESTE ARCHIVO.  (2026-11-24)
-- Es solo un registro histórico. Supabase YA tiene reglas de acceso (RLS) más estrictas, aplicadas el 20-nov y reforzadas el
-- 24-nov (ver supabase/ESTADO_ACTUAL.md): exigen además que la empresa esté AUTORIZADA y con licencia vigente. Este archivo
-- borra esas reglas y las reemplaza por unas más débiles (sin el control de empresa autorizada), así que pegarlo ABRIRÍA la
-- puerta. Por eso empieza con un freno que aborta todo si alguien lo ejecuta.
-- =====================================================================================================
do $$ begin raise exception 'NO APLICAR: este archivo es historico y debilitaria la seguridad. Ver supabase/ESTADO_ACTUAL.md'; end $$;

-- =====================================================================================================
-- MYPECAR PLUS — reglas de acceso (RLS) de todas las tablas que usa el sistema.      2026-11-24
-- Este archivo ES el arreglo: se pega ENTERO en Supabase → SQL Editor → Run. Es seguro repetirlo.
--
-- Qué garantiza:
--   · Una empresa NUNCA ve, cambia ni borra datos de otra empresa (todo se decide con las funciones del
--     sistema es_miembro_de_empresa / usuario_tiene_acceso_app / soy_owner_de_empresa, que ya existen).
--   · Cada asistente solo toca los módulos que el dueño le habilitó (permiso por app, en la propia base).
--   · Nadie (ni el dueño) puede crear una empresa ya "autorizada": la activación solo la hace el
--     administrador o el pago confirmado.
--   · Las tablas de pagos y administradores no se leen ni escriben desde el navegador.
--
-- Cómo funciona de forma segura:
--   · Todo va dentro de UNA transacción (begin … commit): si algo falla, no cambia NADA.
--   · No se desactiva RLS en ninguna tabla. No se borra ninguna tabla ni ningún dato. No se toca auth.users.
--   · Las políticas viejas de estas tablas se reemplazan por las de abajo EN LA MISMA transacción: nunca hay un
--     instante sin política.
--   · NO se toca go_maestro_diario ni decolecta_cache (RLS activo y sin políticas, a propósito).
--   · Prohibido USING (true) en tablas con datos de clientes: no se usa en ninguna (solo en app_version_minima,
--     que no tiene datos de clientes).
--
-- Tablas que usa el código (mypecar-sync.js / mypecar-login.js / admin.html):
--   app_config, empresas, empresa_usuarios, invitaciones_pendientes, app_version_minima.
--   Solo por funciones del servidor: solicitudes_pago, pagos_recibidos, avisos_enviados, administradores.
--
-- Antes de ejecutar: haz el respaldo mensual (Table Editor → app_config / empresas / empresa_usuarios →
-- Export CSV). Este archivo no borra datos, pero un respaldo reciente es la regla de la casa.
-- =====================================================================================================
begin;

-- ---------------------------------------------------------------------------------------------------
-- 0) Comprobaciones: si falta una función de la que dependen las reglas, se aborta TODO sin cambiar nada.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.es_miembro_de_empresa(uuid)') is null then
    raise exception 'Falta la función es_miembro_de_empresa(uuid): no se aplica nada.';
  end if;
  if to_regprocedure('public.soy_owner_de_empresa(uuid)') is null then
    raise exception 'Falta la función soy_owner_de_empresa(uuid): no se aplica nada.';
  end if;
  if to_regprocedure('public.usuario_tiene_acceso_app(uuid, text)') is null then
    raise exception 'Falta la función usuario_tiene_acceso_app(uuid, text): no se aplica nada.';
  end if;
  if to_regprocedure('public.es_admin()') is null then
    raise exception 'Falta la función es_admin(): no se aplica nada.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 1) Función auxiliar: ¿la empresa es MÍA (la creé yo) y todavía no tiene ningún miembro? Sirve para que quien la crea
--    quede de dueño, sin que nadie pueda auto-agregarse a una empresa ajena. Es "security definer" para no entrar
--    en recursión con las reglas de empresa_usuarios.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.empresa_sin_miembros(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.empresas e where e.id = p_empresa_id and e.creado_por = auth.uid())
     and not exists (select 1 from public.empresa_usuarios eu where eu.empresa_id = p_empresa_id);
$$;
revoke all on function public.empresa_sin_miembros(uuid) from public, anon;
grant execute on function public.empresa_sin_miembros(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2) Una empresa nueva SIEMPRE nace "pendiente" (nadie puede insertarla ya autorizada ni con vencimiento).
--    Complementa a proteger_estado_empresa (que solo vigila los UPDATE).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.forzar_empresa_nueva_pendiente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() <> 'service_role' then
    new.estado := 'pendiente';
    new.vence_en := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_forzar_empresa_nueva_pendiente on public.empresas;
create trigger trg_forzar_empresa_nueva_pendiente
  before insert on public.empresas
  for each row execute function public.forzar_empresa_nueva_pendiente();

-- ---------------------------------------------------------------------------------------------------
-- 3) Activar RLS y reemplazar las políticas de cada tabla (todas las viejas fuera, las nuevas dentro).
-- ---------------------------------------------------------------------------------------------------
do $$
declare t text; pol record;
begin
  foreach t in array array['app_config','empresas','empresa_usuarios','invitaciones_pendientes','app_version_minima',
                           'solicitudes_pago','pagos_recibidos','avisos_enviados','administradores']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'La tabla % no existe: se omite.', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

-- ===== app_config: datos de trabajo de cada empresa (una fila por empresa + módulo + clave) =====
-- Solo entra quien tiene permiso para ESE módulo de ESA empresa (el dueño siempre lo tiene).
create policy app_config_leer on public.app_config
  for select to authenticated
  using (public.usuario_tiene_acceso_app(empresa_id, app));
create policy app_config_crear on public.app_config
  for insert to authenticated
  with check (public.usuario_tiene_acceso_app(empresa_id, app)
              and (actualizado_por is null or actualizado_por = auth.uid()));
create policy app_config_actualizar on public.app_config
  for update to authenticated
  using (public.usuario_tiene_acceso_app(empresa_id, app))
  with check (public.usuario_tiene_acceso_app(empresa_id, app)
              and (actualizado_por is null or actualizado_por = auth.uid()));
create policy app_config_borrar on public.app_config
  for delete to authenticated
  using (public.usuario_tiene_acceso_app(empresa_id, app));

-- ===== empresas =====
-- Ver: solo las empresas donde eres miembro (o la que acabas de crear, para que el alta devuelva la fila).
create policy empresas_ver on public.empresas
  for select to authenticated
  using (public.es_miembro_de_empresa(id) or creado_por = auth.uid());
-- Crear: solo a tu nombre y SIEMPRE pendiente (la activación la hace el administrador o el pago confirmado).
create policy empresas_crear on public.empresas
  for insert to authenticated
  with check (creado_por = auth.uid() and estado = 'pendiente');
-- Editar: solo el dueño. El estado y la licencia los protegen los triggers proteger_estado_empresa y
-- proteger_licencia_empresa (solo el administrador o el pago confirmado los cambian).
create policy empresas_editar on public.empresas
  for update to authenticated
  using (public.soy_owner_de_empresa(id))
  with check (public.soy_owner_de_empresa(id));
-- Borrar: nadie desde el navegador (regla de la casa: no se borran empresas).

-- ===== empresa_usuarios (quién pertenece a cada empresa y a qué módulos entra) =====
-- Ver: tu propia fila, o todas las de tu empresa si eres dueño.
create policy empresa_usuarios_ver on public.empresa_usuarios
  for select to authenticated
  using (user_id = auth.uid() or public.soy_owner_de_empresa(empresa_id));
-- Crear: solo para quedar como dueño de una empresa que TÚ acabas de crear (y que aún no tiene miembros). Agregar gente la hace el dueño
-- con la función invitar_miembro_por_correo, no insertando filas directamente.
create policy empresa_usuarios_primer_dueno on public.empresa_usuarios
  for insert to authenticated
  with check (user_id = auth.uid() and rol = 'owner' and public.empresa_sin_miembros(empresa_id));
-- Editar permisos de módulos: solo el dueño de esa empresa.
create policy empresa_usuarios_editar on public.empresa_usuarios
  for update to authenticated
  using (public.soy_owner_de_empresa(empresa_id))
  with check (public.soy_owner_de_empresa(empresa_id));
-- Borrar: nadie directo (quitar dueños se hace con quitar_codueno, que valida que quede al menos uno).

-- ===== invitaciones_pendientes: solo el dueño de la empresa =====
create policy invitaciones_dueno on public.invitaciones_pendientes
  for all to authenticated
  using (public.soy_owner_de_empresa(empresa_id))
  with check (public.soy_owner_de_empresa(empresa_id));

-- ===== app_version_minima: aviso de versión mínima (sin datos de clientes; lo lee cualquiera, nadie lo escribe) =====
do $$
begin
  if to_regclass('public.app_version_minima') is not null then
    create policy version_minima_leer on public.app_version_minima
      for select to anon, authenticated
      using (true);
  end if;
end $$;

-- ===== Tablas del servidor: RLS activo y SIN políticas = el navegador no lee ni escribe nada =====
--   solicitudes_pago, pagos_recibidos, avisos_enviados, administradores
--   (solo las funciones reportar_pago, yape_conciliar, admin_* y las Edge Functions, que son "security definer"
--   o usan la llave del servidor, las tocan).
do $$
declare t text;
begin
  foreach t in array array['solicitudes_pago','pagos_recibidos','avisos_enviados','administradores']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4) Funciones llamadas desde el navegador: solo usuarios con sesión (nunca anónimos).
--    (ping_db y yape_conciliar no se tocan aquí.)
-- ---------------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_activar_empresa','admin_listar_empresas','admin_suspender_empresa','es_admin',
                        'hacer_codueno','quitar_codueno','invitar_miembro_por_correo','leer_catalogo_maestro_diario',
                        'listar_miembros_empresa','reiniciar_empresa_como_nueva','reportar_pago',
                        'soy_owner_de_empresa','usuario_tiene_acceso_app','es_miembro_de_empresa')
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;

commit;

-- =====================================================================================================
-- Verificación (opcional, después de ejecutar): debe devolver SOLO las políticas nuevas, y rls_activo = true.
--   select tablename, policyname, cmd, roles from pg_policies where schemaname='public' order by 1,2;
--   select relname, relrowsecurity as rls_activo from pg_class where relnamespace='public'::regnamespace and relkind='r';
-- =====================================================================================================
