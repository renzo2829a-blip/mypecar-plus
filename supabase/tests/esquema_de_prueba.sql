-- Esquema mínimo de PRUEBA (equivalente a Supabase) para comprobar policies.sql en un PostgreSQL local. No se aplica en Supabase.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
grant usage on schema public, auth to anon, authenticated, service_role;
create table public.empresas (id uuid primary key default gen_random_uuid(), ruc text, razon_social text, nombre_comercial text,
  estado text not null default 'pendiente', vence_en date, periodo_pago text, plan_nombre text, gracia_dias int default 15,
  datos_reiniciados_en timestamptz, creado_por uuid default auth.uid(), creado_en timestamptz default now());
create table public.empresa_usuarios (empresa_id uuid references public.empresas(id), user_id uuid, rol text default 'asistente', apps_permitidas text[], primary key (empresa_id,user_id));
create table public.invitaciones_pendientes (id uuid primary key default gen_random_uuid(), empresa_id uuid references public.empresas(id), correo text, rol text, apps_permitidas text[], creado_en timestamptz default now());
create table public.app_config (empresa_id uuid not null, app text not null, clave text not null, valor jsonb, actualizado_por uuid, actualizado_en timestamptz default now(), primary key (empresa_id,app,clave));
create table public.app_version_minima (version_minima text, mensaje text);
create table public.solicitudes_pago (id uuid primary key default gen_random_uuid(), empresa_id uuid);
create table public.pagos_recibidos (id uuid primary key default gen_random_uuid());
create table public.avisos_enviados (empresa_id uuid, tipo text);
create table public.administradores (email text primary key);
-- funciones del sistema (versión de prueba equivalente a las reales)
create function public.es_miembro_de_empresa(p uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from empresa_usuarios where empresa_id=p and user_id=auth.uid()) $$;
create function public.soy_owner_de_empresa(p_empresa_id uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from empresa_usuarios where empresa_id=p_empresa_id and user_id=auth.uid() and rol='owner') $$;
create function public.usuario_tiene_acceso_app(p_empresa_id uuid, p_app text) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from empresa_usuarios eu where eu.empresa_id=p_empresa_id and eu.user_id=auth.uid() and (eu.rol='owner' or p_app = any(coalesce(eu.apps_permitidas,'{}')))) $$;
create function public.es_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from administradores a where lower(a.email)=lower(coalesce(auth.jwt()->>'email',''))) $$;
create function public.admin_listar_empresas() returns int language sql as $$ select 1 $$;
create function public.reportar_pago(uuid,text,text) returns int language sql as $$ select 1 $$;
grant all on all tables in schema public to authenticated, anon;  -- como Supabase por defecto: las reglas RLS son las que filtran
grant execute on all functions in schema public to public;
