# Portal PQR · dichter & neira

Portal de gestión de PQR publicado en GitHub Pages y conectado al proyecto **Portal PQR** de Supabase (organización Pro «Dichter & Neira Reporting» desde el 15/10/2026). El acceso es con nombre de usuario y contraseña; Supabase usa un identificador técnico interno que no aparece en la interfaz.

## Acceso

Sitio: https://reporting-dichterneira.github.io/Portal-PQR/

Al iniciar, solo existe la cuenta `admin`. Administración crea las cuentas de Comercial, Analistas de PQR, Redigitación y Gerencia, además de mantener las listas de personas responsables y las tipologías. El registro público está desactivado. Las cuentas compartidas de Analistas de PQR y Redigitación son únicas por área; dentro de cada ticket se selecciona quién gestionó el caso.

## Flujo

Comercial radica → Analistas de PQR asignan y dictaminan → cierre justificado, cierre con respuesta o redigitación → Redigitación registra nueva auditoría → Analistas verifican → cierre y notificación interna al comercial. Comercial también puede solicitar redigitación directa. El panel de Gerencia incluye indicadores, filtros por país y estudio, y exportaciones PDF/Excel. Administración puede retirar un ticket individualmente y restaurarlo.

Los ID de PDV y auditoría se validan como dígitos. La trazabilidad de cada etapa y su hora quedan en el detalle del ticket y en columnas del Excel. Las bandejas operativas muestran el plazo SLA de 24 horas.

Analistas de PQR y Gerencia pueden usar **Nueva PQR manual** para registrar solicitudes recibidas fuera del portal, sin seleccionar un canal de recepción. El nombre del Comercial es texto libre opcional: no exige una cuenta registrada ni asocia permisos o destinatarios por coincidencia de nombre. Deben completar ID de PDV, estudio, país y descripción; los adjuntos son opcionales. Se genera un radicado PQR en estado Radicado y continúa el flujo normal de asignación, dictamen, redigitación si aplica y cierre. Sin cuenta comercial asociada no se envía aviso de cierre a Comercial; la respuesta queda en el portal. Los casos anteriores con cuenta vinculada conservan sus avisos. El nombre indicado y el creador quedan en el detalle y el historial; Gerencia no adquiere permisos para dictaminar. El creador manual puede reintentar sus adjuntos desde Detalle.

## Arquitectura y despliegue

- `docs/`: frontend estático servido por GitHub Pages.
- `supabase/migrations/20260928_portal_pqr.sql`: tablas, políticas RLS y funciones de flujo instaladas en Supabase.
- `supabase/migrations/20260929200000_adjuntos_pqr.sql`: bucket privado y políticas de acceso a adjuntos.
- `supabase/functions/pqr-admin/index.ts`: función de administración de usuarios. La clave privada permanece en Supabase; el frontend contiene únicamente la clave publicable.
- `docs/assets/production.js`: cliente oficial de Supabase.

Para revisar localmente: `python -m http.server 8765 --directory docs` y abrir http://localhost:8765/. No se importaron tickets ni cuentas de prueba del piloto local. Los datos antiguos de SQLite y del navegador permanecen en el entorno local, separados de la nueva base oficial.

Comercial puede adjuntar opcionalmente hasta 10 imágenes o archivos Excel por carga (10 MB cada uno), tanto al radicar una PQR como al solicitar redigitación directa. Los archivos se guardan en un bucket privado y se consultan o descargan desde el detalle del ticket. Si alguna carga falla después de crear el caso, se informa el radicado y se puede reintentar desde Detalle sin duplicarlo. Las notificaciones son internas al portal, no correo electrónico.

La implementación anterior con FastAPI/SQLite sigue en el repositorio como referencia histórica; GitHub Pages sirve únicamente `docs/`.

## Auditorías desde Databricks

Gerencia presenta únicamente tres estudios: KO moderno, KO tradicional y Lindley. Un Survey único de Databricks tiene prioridad (`ko_mod` / `ko_moderno`, `ko_trad` / `ko_tradicional`, `lindley`); sin cruce único, Canal del Excel separa los KO modernos y tradicionales. Se conserva Estudio Excel como fuente original y las correcciones manuales explícitas. Si no hay evidencia suficiente, el ticket permanece en los totales sin inventar un estudio.

Resumen ejecutivo e Indicadores detallados incluyen el evolutivo mensual de PQR registradas, aplican y no aplican, con tabla de valores y sin dictamen para reconciliar el total. Usa el mes de la Ola con los mismos respaldos del filtro, no el mes de recepción. Respeta todos los filtros, excluye RDG/EDC y muestra meses intermedios sin actividad en cero; los registros sin periodo quedan identificados como Sin mes.

La sincronización replica el patrón de Portal de Validación: Databricks envía los datos, no se guarda un token personal de Databricks en Supabase. El trabajo independiente `1057185433641838` usa Reporting Cluster a las **6:00 y 14:00 de America/Bogota**. Consulta solo los ID originales y nuevos vinculados a tickets activos y los 14 campos solicitados, con Ola desde 2026 y Survey KO o Lindley. No modifica la tabla de origen ni el trabajo de Validación.

Gerencia lee el último corte desde Supabase; «Actualizar panel» no inicia un clúster ni una nueva consulta a Databricks. Las estadísticas cuentan PQR por auditoría original, sin mezclar RDG/EDC ni atribuir coincidencias múltiples arbitrariamente. «Ver auditoría» muestra original y nueva. «Pendiente de sincronización» no equivale a «Sin datos»: esto último requiere una consulta exitosa sin coincidencias. Cada auditoría conserva su hora de corte. Los nuevos tickets esperan al siguiente horario; si falla un lote se conserva su corte anterior.

Los archivos están en `databricks/pqr_audit_sync.py`, `supabase/functions/pqr-audit-sync/index.ts`, `supabase/functions/pqr-audits/index.ts` y la migración `20261015144738_pqr_databricks_scheduled_cache.sql`. La caché tiene RLS y solo es visible a cuentas activas de Gerencia/Administración para auditorías vinculadas a tickets activos. El manifiesto solo entrega IDs al sincronizador. El receptor verifica una clave exclusiva cuyo texto permanece en el scope `portal-pqr-audit-sync`, clave `receiver-token`; el código contiene únicamente su SHA-256. No reutilizar el secreto de Validación. No copiar claves de servicio al notebook ni al frontend.

**Restricción comprobada del workspace:** no admite ACL de scopes. Los usuarios con acceso al workspace pueden tener acceso a esa clave de recepción y potencialmente alterar el corte de PQR; limitar los usuarios del workspace y revisar los cortes. La clave no concede acceso a Databricks, cuentas ni escritura en tickets. Si se habilitan ACL, restringir el scope y el trabajo. Puede rotarse por seguridad; no es un PAT con vencimiento periódico. Para una nueva instalación `prepare_receiver_key.mjs` se niega a sobrescribir scopes existentes y solo imprime el digest. El JSON del trabajo se conserva pausado por seguridad en instalaciones nuevas; activar el horario solo después de probar la carga.
