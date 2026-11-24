#!/bin/bash
# Comprueba policies.sql en un PostgreSQL LOCAL (no toca Supabase). Uso:
#   crea la base:  psql -c "create database t" ; psql -d t -f supabase/tests/esquema_de_prueba.sql
#   aplica:        psql -d t -f supabase/policies.sql ; psql -d t -f supabase/tests/datos_de_prueba.sql
#   prueba:        PGHOST=/tmp/pgt PGPORT=5544 bash supabase/tests/probar_reglas.sh
# uso: q USUARIO ROL "SQL"   -> ejecuta como ese usuario (JWT simulado) y muestra resultado o error
q(){ psql -d t -At -c "set role $2; select set_config('request.jwt.claim.sub','$1',false), set_config('request.jwt.claim.role','$2',false), set_config('request.jwt.claim.email','$4',false);" -c "$3" 2>&1 | grep -v "^set_config\|^SET\|^$\|^[|]*$" | grep -v "^|" | head -3 | tr '\n' ' '; }
U1=aaaaaaaa-0000-0000-0000-000000000001; U2=aaaaaaaa-0000-0000-0000-000000000002; U3=aaaaaaaa-0000-0000-0000-000000000003; U4=aaaaaaaa-0000-0000-0000-000000000004
E1=11111111-1111-1111-1111-111111111111; E2=22222222-2222-2222-2222-222222222222
t(){ printf "%-74s -> %s\n" "$1" "$(q $2 $3 "$4" x)"; }
t "dueño de E1 lee sus filas de app_config (esperado 2)" $U1 authenticated "select count(*) from app_config where empresa_id='$E1'"
t "dueño de E1 intenta leer filas de E2 (esperado 0)" $U1 authenticated "select count(*) from app_config where empresa_id='$E2'"
t "dueño de E2 intenta leer filas de E1 (esperado 0)" $U2 authenticated "select count(*) from app_config where empresa_id='$E1'"
t "ajeno sin empresa lee app_config (esperado 0)" $U4 authenticated "select count(*) from app_config"
t "asistente (solo ventas) lee app_config de E1 (esperado 1)" $U3 authenticated "select count(*) from app_config where empresa_id='$E1'"
t "asistente intenta leer 'compras' (esperado 0)" $U3 authenticated "select count(*) from app_config where app='compras'"
t "asistente escribe en 'ventas' (esperado INSERT 0 1)" $U3 authenticated "insert into app_config(empresa_id,app,clave,valor,actualizado_por) values ('$E1','ventas','k1','{}','$U3')"
t "asistente escribe en 'compras' (esperado ERROR)" $U3 authenticated "insert into app_config(empresa_id,app,clave,valor) values ('$E1','compras','k2','{}')"
t "dueño de E2 escribe en E1 (esperado ERROR)" $U2 authenticated "insert into app_config(empresa_id,app,clave,valor) values ('$E1','ventas','k3','{}')"
t "dueño de E1 suplanta actualizado_por=U2 (esperado ERROR)" $U1 authenticated "insert into app_config(empresa_id,app,clave,valor,actualizado_por) values ('$E1','ventas','k4','{}','$U2')"
t "dueño de E2 intenta UPDATE en E1 (esperado UPDATE 0)" $U2 authenticated "update app_config set valor='{\"hack\":1}' where empresa_id='$E1'"
t "dueño de E2 intenta DELETE en E1 (esperado DELETE 0)" $U2 authenticated "delete from app_config where empresa_id='$E1'"
t "anónimo lee app_config (esperado 0 o ERROR)" "" anon "select count(*) from app_config"
t "dueño de E1 ve empresas (esperado 1: solo la suya)" $U1 authenticated "select count(*) from empresas"
t "ajeno ve empresas por id (esperado 0)" $U4 authenticated "select count(*) from empresas where id='$E1'"
t "ajeno crea empresa 'autorizada' (esperado: queda pendiente)" $U4 authenticated "insert into empresas(ruc,estado,vence_en) values ('20999999999','autorizada','2099-01-01') returning estado"
t "ajeno crea empresa a nombre de otro (esperado ERROR)" $U4 authenticated "insert into empresas(ruc,creado_por) values ('20888888888','$U1')"
t "ajeno se agrega de dueño a E1 (esperado ERROR)" $U4 authenticated "insert into empresa_usuarios values ('$E1','$U4','owner',null)"
t "ajeno se agrega de dueño a E2 (esperado ERROR)" $U4 authenticated "insert into empresa_usuarios values ('$E2','$U4','owner',null)"
t "creador: se hace dueño de SU empresa nueva (esperado INSERT 0 1)" $U4 authenticated "insert into empresa_usuarios select id,'$U4','owner',null from empresas where creado_por='$U4' limit 1"
t "asistente edita datos de la empresa (esperado UPDATE 0)" $U3 authenticated "update empresas set razon_social='X' where id='$E1'"
t "dueño edita razón social de su empresa (esperado UPDATE 1)" $U1 authenticated "update empresas set razon_social='NUEVA' where id='$E1'"
t "dueño de E1 borra su empresa (esperado ERROR)" $U1 authenticated "delete from empresas where id='$E1'"
t "asistente se da permiso a 'compras' (esperado UPDATE 0)" $U3 authenticated "update empresa_usuarios set apps_permitidas='{ventas,compras}' where user_id='$U3'"
t "dueño da permisos a su asistente (esperado UPDATE 1)" $U1 authenticated "update empresa_usuarios set apps_permitidas='{ventas,compras}' where user_id='$U3'"
t "dueño de E2 modifica permisos en E1 (esperado UPDATE 0)" $U2 authenticated "update empresa_usuarios set rol='owner' where empresa_id='$E1'"
t "asistente lee invitaciones (esperado 0)" $U3 authenticated "select count(*) from invitaciones_pendientes"
t "dueño de E1 lee invitaciones (esperado 1)" $U1 authenticated "select count(*) from invitaciones_pendientes"
t "dueño de E2 lee invitaciones de E1 (esperado 0)" $U2 authenticated "select count(*) from invitaciones_pendientes"
t "usuario lee solicitudes_pago (esperado ERROR permiso)" $U1 authenticated "select count(*) from solicitudes_pago"
t "usuario lee administradores (esperado ERROR permiso)" $U1 authenticated "select count(*) from administradores"
t "anónimo lee app_version_minima (esperado 1)" "" anon "select count(*) from app_version_minima"
t "anónimo ejecuta es_admin (esperado ERROR permiso)" "" anon "select es_admin()"

# --- accesos anónimos ---
for sql in "select count(*) from app_config" "select count(*) from empresas" "select count(*) from empresa_usuarios" "select count(*) from app_version_minima" "select es_admin()" "select admin_listar_empresas()" "select reportar_pago(null,null,null)"; do
 printf "%-48s -> " "anónimo: $sql"; psql -d t -At -c "set role anon" -c "$sql" 2>&1 | grep -v "^SET" | head -1; done
