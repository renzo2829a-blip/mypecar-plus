-- =====================================================================================================
-- MYPECAR PLUS — prueba gratuita de 14 días.                                              2026-11-24
-- Ya aplicado en Supabase el 2026-11-24 (migración "prueba_gratis_14_dias"). Es seguro repetirlo.
--
-- Qué hace:
--   · Una empresa PENDIENTE puede iniciar UNA sola prueba gratuita de 14 días (por empresa, por RUC y por usuario).
--     La prueba es una licencia normal: estado 'autorizada', vence_en = hoy + 14, sin periodo de gracia y plan_nombre = 'prueba'.
--     Al día 15 se aplica el mismo bloqueo que ya existe para licencias vencidas (se invita a suscribirse con Yape; los datos
--     no se borran).
--   · Defensas contra abuso: RUC real (dígito verificador), RUC que no sea de otra empresa ya autorizada de otro usuario,
--     tope global de 20 pruebas por día y solo el dueño de la empresa puede iniciarla.
--   · Una licencia vencida (pasado su periodo de gracia) ya NO puede escribir datos en la nube aunque alguien se salte la
--     pantalla de bloqueo: las reglas de ESCRITURA de app_config exigen licencia vigente. La LECTURA no cambia (así se puede
--     descargar el respaldo). Empresas sin fecha de vencimiento (las anteriores) no se ven afectadas.
-- No se desactiva RLS, no se borra ninguna tabla ni dato, no se toca auth.users ni go_maestro_diario / decolecta_cache.
-- =====================================================================================================
begin;

do $$
begin
  if to_regprocedure('public.ruc_valido(text)') is null or to_regprocedure('public.soy_owner_de_empresa(uuid)') is null
     or to_regprocedure('public.usuario_tiene_acceso_app(uuid, text)') is null then
    raise exception 'Faltan ruc_valido / soy_owner_de_empresa / usuario_tiene_acceso_app: no se aplica nada.';
  end if;
end $$;

-- Registro de pruebas (solo el servidor lo lee o escribe: RLS activo y sin políticas).
create table if not exists public.pruebas_gratis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  ruc text not null,
  user_id uuid not null,
  inicio date not null default current_date,
  fin date not null,
  creado_en timestamptz not null default now(),
  unique (ruc),
  unique (user_id)
);
alter table public.pruebas_gratis enable row level security;
revoke all on public.pruebas_gratis from anon, authenticated;

-- ¿La licencia está vigente? (sin fecha = sin vencimiento; con fecha: hasta vence_en + días de gracia)
create or replace function public.empresa_licencia_vigente(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select e.vence_en is null or (e.vence_en + coalesce(e.gracia_dias, 15)) >= current_date
       from public.empresas e where e.id = p_empresa_id),
    false);
$$;
revoke all on function public.empresa_licencia_vigente(uuid) from public, anon;
grant execute on function public.empresa_licencia_vigente(uuid) to authenticated;

-- Inicia la prueba gratuita de 14 días.
create or replace function public.iniciar_prueba_gratis(p_empresa_id uuid)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e record; v_fin date; v_hoy int;
  c_dias constant int := 14;
  c_tope_por_dia constant int := 20;
begin
  if auth.uid() is null then raise exception 'inicia sesion' using errcode = '42501'; end if;
  if not public.soy_owner_de_empresa(p_empresa_id) then raise exception 'solo el dueno de la empresa' using errcode = '42501'; end if;
  select * into e from public.empresas where id = p_empresa_id;
  if not found then return json_build_object('ok', false, 'motivo', 'empresa_no_existe'); end if;
  if e.estado <> 'pendiente' or coalesce(e.reinicio_pendiente_revision, false) then
    return json_build_object('ok', false, 'motivo', 'empresa_ya_activa');
  end if;
  if not public.ruc_valido(e.ruc) then return json_build_object('ok', false, 'motivo', 'ruc_invalido'); end if;
  if exists (select 1 from public.pruebas_gratis p where p.empresa_id = p_empresa_id or p.ruc = e.ruc or p.user_id = auth.uid()) then
    return json_build_object('ok', false, 'motivo', 'prueba_ya_usada');
  end if;
  if exists (select 1 from public.empresas x where x.id <> p_empresa_id and x.ruc = e.ruc and x.estado = 'autorizada'
             and x.creado_por is distinct from auth.uid()) then
    return json_build_object('ok', false, 'motivo', 'ruc_de_otra_empresa');
  end if;
  select count(*) into v_hoy from public.pruebas_gratis p where p.creado_en > now() - interval '1 day';
  if v_hoy >= c_tope_por_dia then return json_build_object('ok', false, 'motivo', 'tope_diario'); end if;

  v_fin := current_date + c_dias;
  insert into public.pruebas_gratis (empresa_id, ruc, user_id, inicio, fin) values (p_empresa_id, e.ruc, auth.uid(), current_date, v_fin);
  perform set_config('mypecar.activando_por_pago', 'on', true);
  update public.empresas set estado = 'autorizada', vence_en = v_fin, gracia_dias = 0, plan_nombre = 'prueba', periodo_pago = null
   where id = p_empresa_id;
  perform set_config('mypecar.activando_por_pago', '', true);
  return json_build_object('ok', true, 'activada', true, 'vence_en', v_fin, 'dias', c_dias);
end $$;
revoke all on function public.iniciar_prueba_gratis(uuid) from public, anon;
grant execute on function public.iniciar_prueba_gratis(uuid) to authenticated;

-- Escritura en app_config solo con licencia vigente (las reglas se reemplazan en esta misma transacción).
drop policy if exists "escribir app_config de mi empresa" on public.app_config;
create policy "escribir app_config de mi empresa" on public.app_config
  for insert to public
  with check (public.es_miembro_de_empresa(empresa_id) and public.empresa_autorizada(empresa_id)
              and public.empresa_licencia_vigente(empresa_id) and public.usuario_tiene_acceso_app(empresa_id, app));
drop policy if exists "actualizar app_config de mi empresa" on public.app_config;
create policy "actualizar app_config de mi empresa" on public.app_config
  for update to public
  using (public.es_miembro_de_empresa(empresa_id) and public.empresa_autorizada(empresa_id)
         and public.empresa_licencia_vigente(empresa_id) and public.usuario_tiene_acceso_app(empresa_id, app));
drop policy if exists "borrar app_config de mi empresa" on public.app_config;
create policy "borrar app_config de mi empresa" on public.app_config
  for delete to public
  using (public.es_miembro_de_empresa(empresa_id) and public.empresa_autorizada(empresa_id)
         and public.empresa_licencia_vigente(empresa_id) and public.usuario_tiene_acceso_app(empresa_id, app));

-- Cuando un pago (o el administrador) extiende la licencia de una empresa en prueba, deja de figurar como "prueba".
-- (El dueño no puede cambiar su propia licencia: lo siguen protegiendo proteger_licencia_empresa y proteger_estado_empresa.)
create or replace function public.fin_prueba_al_extender_licencia()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.plan_nombre = 'prueba' and old.vence_en is not null and new.vence_en is not null and new.vence_en > old.vence_en then
    new.plan_nombre := null;
  end if;
  return new;
end $$;
revoke all on function public.fin_prueba_al_extender_licencia() from public, anon, authenticated;
drop trigger if exists trg_fin_prueba_al_extender on public.empresas;
create trigger trg_fin_prueba_al_extender
  before update on public.empresas
  for each row execute function public.fin_prueba_al_extender_licencia();

commit;
