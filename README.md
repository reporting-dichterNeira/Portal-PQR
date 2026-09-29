# Portal PQR · dichter & neira

Portal de gestión de PQR publicado en GitHub Pages y conectado al proyecto **Portal PQR** de Supabase (organización Free «Planeacion»). El acceso es con nombre de usuario y contraseña; Supabase usa un identificador técnico interno que no aparece en la interfaz.

## Acceso

Sitio: https://reporting-dichterneira.github.io/Portal-PQR/

Al iniciar, solo existe la cuenta `admin`. Administración crea las cuentas de Comercial, Analistas de PQR, Redigitación y Gerencia, además de mantener las listas de personas responsables y las tipologías. El registro público está desactivado. Las cuentas compartidas de Analistas de PQR y Redigitación son únicas por área; dentro de cada ticket se selecciona quién gestionó el caso.

## Flujo

Comercial radica → Analistas de PQR asignan y dictaminan → cierre justificado, cierre con respuesta o redigitación → Redigitación registra nueva auditoría → Analistas verifican → cierre y notificación interna al comercial. Comercial también puede solicitar redigitación directa. El panel de Gerencia incluye indicadores, filtros por país y estudio, y exportaciones PDF/Excel. Administración puede retirar un ticket individualmente y restaurarlo.

Los ID de PDV y auditoría se validan como dígitos. La trazabilidad de cada etapa y su hora quedan en el detalle del ticket y en columnas del Excel. Las bandejas operativas muestran el plazo SLA de 24 horas.

## Arquitectura y despliegue

- `docs/`: frontend estático servido por GitHub Pages.
- `supabase/migrations/20260928_portal_pqr.sql`: tablas, políticas RLS y funciones de flujo instaladas en Supabase.
- `supabase/migrations/20260929200000_adjuntos_pqr.sql`: bucket privado y políticas de acceso a adjuntos.
- `supabase/functions/pqr-admin/index.ts`: función de administración de usuarios. La clave privada permanece en Supabase; el frontend contiene únicamente la clave publicable.
- `docs/assets/production.js`: cliente oficial de Supabase.

Para revisar localmente: `python -m http.server 8765 --directory docs` y abrir http://localhost:8765/. No se importaron tickets ni cuentas de prueba del piloto local. Los datos antiguos de SQLite y del navegador permanecen en el entorno local, separados de la nueva base oficial.

Comercial puede adjuntar opcionalmente hasta 10 imágenes o archivos Excel por carga (10 MB cada uno), tanto al radicar una PQR como al solicitar redigitación directa. Los archivos se guardan en un bucket privado y se consultan o descargan desde el detalle del ticket. Si alguna carga falla después de crear el caso, se informa el radicado y se puede reintentar desde Detalle sin duplicarlo. Las notificaciones son internas al portal, no correo electrónico.

La implementación anterior con FastAPI/SQLite sigue en el repositorio como referencia histórica; GitHub Pages sirve únicamente `docs/`.
