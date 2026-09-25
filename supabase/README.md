# Migración futura a Supabase

La versión de GitHub Pages usa un adaptador local en `docs/assets/app.js`. Las vistas consumen un único objeto `Store`; para migrar, se reemplazan sus métodos por llamadas a Supabase sin modificar las pantallas ni los estados del flujo.

Antes de conectar producción:

1. Crear autenticación real con Supabase Auth; nunca trasladar las contraseñas de prueba al proyecto remoto.
2. Modelar perfiles, PQR, eventos de línea de tiempo, notificaciones y adjuntos.
3. Activar RLS en todas las tablas expuestas y limitar los comerciales a sus propios casos.
4. Guardar adjuntos en Supabase Storage con políticas por PQR, no en `localStorage`.
5. Mantener GitHub Pages como frontend: se configura la URL y la publishable key de Supabase, nunca una `service_role`.
