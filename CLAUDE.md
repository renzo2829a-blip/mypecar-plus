# MYPECAR PLUS — instrucciones para Claude Code

Sistema contable en línea para MYPEs peruanas. Son 9 apps HTML estáticas (01 Ventas, 02 Compras, 03 Caja y Bancos, 04 Libro Diario, 05 Personal, 06 Activos Fijos, 07 Reportes, 08 Auditoría, 09 Inventario) más `index.html`, `legal.html`, `mypecar-login.js`, `mypecar-sync.js`, `mypecar-mobile.js` y `mypecar-ruc-gratis.js`. Se publican en un Worker de Cloudflare en mypecar.net.pe. Los datos viven en Supabase (proyecto `byucdwgerwpoqicklycf`, plan Free, sin backups automáticos).

El dueño no programa. Explica todo en español, en lenguaje sencillo, y haz el trabajo técnico tú mismo.

## Reglas obligatorias
- Antes de cualquier cambio en la base de datos, confirma que existe un respaldo reciente y dilo.
- Nunca borres tablas ni registros. Nunca desactives RLS. Nunca toques `auth.users`.
- No borres una política sin dejar otra que la reemplace. Prohibido `USING (true)` en tablas con datos de clientes.
- No cambies `go_maestro_diario` ni `decolecta_cache` (RLS activo y sin políticas a propósito).
- Autorización permanente del dueño (20-nov-2026): cuando se actualice la aplicación y sea necesario, publica los cambios en Cloudflare (mypecar.net.pe, Worker `damp-haze-1675`) sin volver a pedir permiso. La publicación es automática: al unir un cambio a `main`, GitHub Actions (`.github/workflows/publicar-cloudflare.yml`) ejecuta `build.sh` y `wrangler deploy`. Antes de publicar prueba el cambio y confirma que el login y el cambio de empresa no se rompen; después reporta qué se publicó. Si falta acceso o falla la publicación, dilo; no improvises.
- Nunca pongas claves privadas, `service_role` ni contraseñas en el código. En el frontend solo va la clave `sb_publishable_…`.
- Cada empresa solo debe ver sus propios datos (`es_miembro_de_empresa(empresa_id)`). El login y el cambio de empresa no deben romperse.
- No declares resuelto algo que no hayas probado. Distingue siempre: diagnosticado, corregido, pendiente.
- Los archivos `mypecar-sync.js` y `mypecar-login.js` deben conservar exactamente ese nombre: las 9 apps los cargan por nombre.

## Forma de trabajar
- Primero lee y audita; después propón; después aplica.
- Cambios en la base de datos: un grupo a la vez, y vuelve a consultar el Security Advisor después de cada grupo.
- Prueba con la empresa de prueba (CLIENTE DEMO DOS), nunca con datos reales de clientes.
- Los informes se firman: CARLOS FLORES FIGUEROA.
