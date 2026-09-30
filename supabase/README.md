# Supabase · Portal PQR

Proyecto: `niwkegxwwwoahcbsoujy` en la organización Free «Planeacion». Las migraciones `migrations/20260928_portal_pqr.sql` y `migrations/20260928_pqr_admin_grant.sql` fueron aplicadas en este proyecto. La función `functions/pqr-admin/index.ts` fue desplegada con verificación moderna de Auth (`getUser` más perfil administrador); la verificación heredada del gateway está desactivada para esta función. El registro público de usuarios en Auth está desactivado.

La clave `SUPABASE_SERVICE_ROLE_KEY` solo se lee desde el entorno de la función. Nunca debe copiarse al frontend ni a GitHub. Las cuentas se crean desde Administración y reciben un nombre de usuario; Supabase Auth utiliza un identificador técnico `usuario@portal-pqr.invalid` que no se muestra al usuario. Las políticas RLS restringen los casos de Comercial al propio titular y reservan la administración para `admin`.

No se importaron los datos de prueba del piloto. La base oficial comenzó con una sola cuenta, `admin`, y sin tickets.

La migración `20260930120000_tipos_solicitud_edicion.sql` agrega `pqr_create_special` para las solicitudes RDG y EDC. Las RDG directas históricas conservan UUID e historial y cambian su prefijo PQR por RDG; las PQR ordinarias no cambian. Una EDC entra a Redigitación, pasa luego a verificación y solo un Analista de PQR puede dar el cierre definitivo.
