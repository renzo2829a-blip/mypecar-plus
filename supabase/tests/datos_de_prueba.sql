-- Datos de prueba: 2 empresas, 1 dueño por empresa, 1 asistente de la empresa 1 (solo 'ventas').
-- datos de prueba como superusuario
insert into empresas(id,ruc,razon_social,estado,creado_por) values
 ('11111111-1111-1111-1111-111111111111','20111111111','EMPRESA UNO','autorizada','aaaaaaaa-0000-0000-0000-000000000001'),
 ('22222222-2222-2222-2222-222222222222','20222222222','EMPRESA DOS','autorizada','aaaaaaaa-0000-0000-0000-000000000002');
insert into empresa_usuarios values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','owner',null),
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000003','asistente','{ventas}'),
 ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000002','owner',null);
insert into app_config(empresa_id,app,clave,valor) values
 ('11111111-1111-1111-1111-111111111111','ventas','vendepollo_config','{"x":1}'),
 ('11111111-1111-1111-1111-111111111111','compras','comprapollo_config','{"x":2}'),
 ('22222222-2222-2222-2222-222222222222','ventas','vendepollo_config','{"secreto":"dos"}');
insert into invitaciones_pendientes(empresa_id,correo) values ('11111111-1111-1111-1111-111111111111','x@x.pe');
insert into app_version_minima values ('1.0','ok');
