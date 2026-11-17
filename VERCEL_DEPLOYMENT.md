# Portal PQR en Vercel

Producción: https://portal-pqr.vercel.app/
Cuenta de Vercel: reporting-dichterneira.
Publicado el 17 de noviembre de 2026 mediante Drop to Deploy con el contenido público de `docs/` del commit 57d3082. Sin proceso de compilación; sitio estático.

Usa el mismo proyecto Supabase Portal PQR (niwkegxwwwoahcbsoujy), las mismas cuentas, tickets y permisos que GitHub Pages. No se copiaron credenciales privadas ni archivos del backend al alojamiento.
Las funciones pqr-audits y pqr-admin permiten el origen exacto https://portal-pqr.vercel.app y siguen validando sesión, perfil y permisos propios.

La publicación fue manual: todavía no hay despliegue automático desde GitHub en este proyecto. Para actualizar Vercel, volver a publicar exclusivamente docs/. GitHub Pages sigue publicándose desde main.

Verificado: consulta pública de ENV-000001 devuelve los tres tickets de prueba; el código largo anterior devuelve el mismo consolidado. Preflight de las dos funciones responde 200 para el dominio exacto de producción.
