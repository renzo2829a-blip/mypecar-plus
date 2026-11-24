-- =====================================================================================================
-- MYPECAR PLUS — activación provisional de 48 horas, a prueba de abuso.                 2026-11-24
-- Este archivo ES el arreglo: se pega ENTERO en Supabase → SQL Editor → Run. Es seguro repetirlo
-- (reemplaza SOLO la función reportar_pago; no toca tablas ni datos).
--
-- Qué ya hacía la función: dar 48 horas UNA sola vez por empresa, por RUC y por usuario.
-- Qué cierra este archivo (formas de abusar que quedaban abiertas):
--   1) RUC inventado: ahora el RUC debe ser real en formato y dígito verificador (módulo 11 de SUNAT).
--   2) RUC ajeno: si ese RUC ya pertenece a una empresa autorizada de OTRO usuario, no hay provisional.
--   3) Cuentas nuevas en serie: tope global de 10 accesos provisionales por día (corta una ráfaga automatizada;
--      el administrador sigue pudiendo activar a mano desde /admin).
--   4) Spam de avisos: máximo 5 avisos de pago por usuario por hora.
-- Todo lo demás (activación inmediata si el Yape ya llegó, conciliación, una vez por empresa/RUC/usuario)
-- queda igual. No se desactiva RLS ni se borra nada.
-- =====================================================================================================
begin;

do $$
begin
  if to_regclass('public.solicitudes_pago') is null or to_regprocedure('public.yape_conciliar()') is null
     or to_regprocedure('public.soy_owner_de_empresa(uuid)') is null then
    raise exception 'Faltan solicitudes_pago / yape_conciliar / soy_owner_de_empresa: no se aplica nada.';
  end if;
end $$;

-- Dígito verificador oficial del RUC (módulo 11).
create or replace function public.ruc_valido(p_ruc text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare f int[] := array[5,4,3,2,7,6,5,4,3,2]; suma int := 0; i int; dv int;
begin
  if p_ruc is null or p_ruc !~ '^(10|15|16|17|20)[0-9]{9}$' then return false; end if;
  for i in 1..10 loop suma := suma + f[i] * substr(p_ruc, i, 1)::int; end loop;
  dv := (11 - (suma % 11)) % 10;
  return dv = substr(p_ruc, 11, 1)::int;
end $$;

create or replace function public.reportar_pago(p_empresa_id uuid, p_plan text, p_nombre_yape text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_monto numeric(10,2); v_id uuid; e record; v_corresponde boolean := false; v_ya boolean;
  v_estado_sol text; v_vence date;
  c_tope_provisionales_por_dia constant int := 10;
  c_max_avisos_por_hora constant int := 5;
  v_ruc_ajeno boolean; v_hoy int;
begin
  if auth.uid() is null then raise exception 'inicia sesion' using errcode = '42501'; end if;
  if not public.soy_owner_de_empresa(p_empresa_id) then raise exception 'solo el dueno de la empresa' using errcode = '42501'; end if;
  if p_plan not in ('mensual','anual') then raise exception 'plan invalido'; end if;
  if length(trim(coalesce(p_nombre_yape, ''))) < 3 then raise exception 'escribe tu nombre como aparece en Yape'; end if;
  -- (4) Tope de avisos por usuario y hora.
  if (select count(*) from public.solicitudes_pago sp where sp.creado_por = auth.uid() and sp.creado_en > now() - interval '1 hour') >= c_max_avisos_por_hora then
    raise exception 'demasiados avisos seguidos, espera un momento' using errcode = '54000';
  end if;
  v_monto := case p_plan when 'mensual' then 59.00 else 590.00 end;

  select * into e from public.empresas where id = p_empresa_id;
  update public.solicitudes_pago set estado = 'reemplazada' where empresa_id = p_empresa_id and estado = 'esperando';
  insert into public.solicitudes_pago (empresa_id, plan, monto, nombre_yape)
  values (p_empresa_id, p_plan, v_monto, trim(p_nombre_yape)) returning id into v_id;
  perform public.yape_conciliar();

  select estado into v_estado_sol from public.solicitudes_pago where id = v_id;
  if v_estado_sol = 'pagada' then
    select vence_en into v_vence from public.empresas where id = p_empresa_id;
    return json_build_object('ok', true, 'monto', v_monto, 'activada', true, 'provisional', false, 'vence_en', v_vence);
  end if;

  -- ¿Le corresponde acceso provisional? Solo empresas pendientes o con licencia vencida, y solo si cumple TODO:
  if e.estado = 'pendiente'
     or (e.estado in ('autorizada','suspendida') and e.vence_en is not null
         and e.vence_en + coalesce(e.gracia_dias, 15) < current_date) then
    -- una sola vez por empresa / RUC / usuario
    select exists (
      select 1 from public.solicitudes_pago sp join public.empresas x on x.id = sp.empresa_id
      where sp.provisional
        and (sp.empresa_id = p_empresa_id
             or (coalesce(e.ruc, '') <> '' and x.ruc = e.ruc)
             or sp.creado_por = auth.uid())
    ) into v_ya;
    -- (2) el RUC no puede ser de otra empresa ya autorizada de otro usuario
    select exists (
      select 1 from public.empresas x
      where x.id <> p_empresa_id and x.ruc = e.ruc and x.estado = 'autorizada'
        and x.creado_por is distinct from auth.uid()
    ) into v_ruc_ajeno;
    -- (3) tope global diario de provisionales
    select count(*) into v_hoy from public.solicitudes_pago sp where sp.provisional and sp.creado_en > now() - interval '1 day';
    -- (1) RUC real
    v_corresponde := (not v_ya) and (not v_ruc_ajeno) and public.ruc_valido(e.ruc) and v_hoy < c_tope_provisionales_por_dia;
  end if;

  if v_corresponde then
    v_vence := current_date + 2;
    perform set_config('mypecar.activando_por_pago', 'on', true);
    update public.empresas set estado = 'autorizada', vence_en = v_vence, gracia_dias = 0 where id = p_empresa_id;
    perform set_config('mypecar.activando_por_pago', '', true);
    update public.solicitudes_pago set provisional = true where id = v_id;
    return json_build_object('ok', true, 'monto', v_monto, 'activada', true, 'provisional', true, 'vence_en', v_vence);
  end if;
  return json_build_object('ok', true, 'monto', v_monto, 'activada', false, 'provisional', false);
end $$;

revoke all on function public.ruc_valido(text) from public, anon;
grant execute on function public.ruc_valido(text) to authenticated;
revoke all on function public.reportar_pago(uuid, text, text) from public, anon;
grant execute on function public.reportar_pago(uuid, text, text) to authenticated;

commit;
