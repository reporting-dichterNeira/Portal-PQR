# Portal PQR en Vercel

Producción: https://portal-pqr.vercel.app/
Cuenta de Vercel: reporting-dichterneira.
Publicado el 17 de noviembre de 2026 mediante Drop to Deploy con el contenido público de `docs/` del commit 57d3082. Sin proceso de compilación; sitio estático.

Usa el mismo proyecto Supabase Portal PQR (niwkegxwwwoahcbsoujy), las mismas cuentas, tickets y permisos que GitHub Pages. No se copiaron credenciales privadas ni archivos del backend al alojamiento.
Las funciones pqr-audits y pqr-admin permiten el origen exacto https://portal-pqr.vercel.app y siguen validando sesión, perfil y permisos propios.

Desde el 19 de noviembre de 2026, el proyecto está conectado al repositorio reporting-dichterNeira/Portal-PQR. Vercel publica automáticamente los cambios de main con Root Directory = docs y Framework Preset = Other. docs/vercel.json fija el directorio de salida estático. GitHub Pages conserva su publicación desde main. No se requiere volver a cargar archivos mediante Drop para las actualizaciones normales. Las comprobaciones de acceso a las cuentas de GitHub y Vercel siguen vigentes.

Verificado: consulta pública de ENV-000001 devuelve los tres tickets de prueba; el código largo anterior devuelve el mismo consolidado. Preflight de las dos funciones responde 200 para el dominio exacto de producción.
