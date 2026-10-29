# Portal PQR · dichter & neira

Portal de gestión de PQR publicado en GitHub Pages y conectado al proyecto **Portal PQR** de Supabase (organización Pro «Dichter & Neira Reporting» desde el 15/10/2026). El acceso es con nombre de usuario y contraseña; Supabase usa un identificador técnico interno que no aparece en la interfaz.

## Acceso

Sitio: https://reporting-dichterneira.github.io/Portal-PQR/

Al iniciar, solo existe la cuenta `admin`. Administración crea las cuentas de Comercial, Analistas de PQR, Redigitación y Gerencia, además de mantener las listas de personas responsables y las tipologías. El registro público está desactivado. Las cuentas compartidas de Analistas de PQR y Redigitación son únicas por área; dentro de cada ticket se selecciona quién gestionó el caso.

## Flujo

Comercial radica → Analistas de PQR asignan y dictaminan → cierre justificado, cierre con respuesta o redigitación → Redigitación registra nueva auditoría → Analistas verifican → cierre y notificación interna al comercial. Comercial también puede solicitar redigitación directa. El panel de Gerencia incluye indicadores, filtros por país y estudio, y exportaciones PDF/Excel. Administración puede retirar un ticket individualmente y restaurarlo.

Los ID de PDV y auditoría se validan como dígitos. La trazabilidad de cada etapa y su hora quedan en el detalle del ticket y en columnas del Excel. Las bandejas operativas muestran el plazo SLA de 24 horas.

Analistas de PQR y Gerencia pueden usar **Nueva PQR manual** para registrar solicitudes recibidas fuera del portal, sin seleccionar un canal de recepción. El campo «ID de ticket» es una referencia externa opcional (máximo 100 caracteres); reemplaza al Comercial en el formulario y no sustituye el radicado PQR automático ni vincula destinatarios. Estudio y país siguen siendo obligatorios; ID de PDV, descripción y adjuntos son opcionales al radicar. Se permite una descripción parcial para completar después; un PDV indicado debe ser numérico, con máximo 80 dígitos.

En **Dictaminar**, todas las PQR manuales muestran su ID de PDV y descripción precargados y editables. Ambos son obligatorios para cualquiera de los tres resultados: PDV numérico de hasta 80 dígitos y descripción de 8 a 12000 caracteres. El servidor valida y guarda los datos junto al dictamen, en la misma transacción; un fallo no guarda un cierre o una redigitación parcial. La compleción queda identificada en el paso a paso con fecha/hora y responsable. Los formularios anteriores usan los datos ya completos cuando no envían esos campos. Comercial, RDG y EDC mantienen sus requisitos y flujos originales.

La referencia aparece en las bandejas, detalle, tablas gerenciales y Excel de casos. Las PQR manuales siguen el flujo normal de asignación, dictamen, redigitación si aplica y cierre. Sin cuenta comercial asociada no se envía aviso de cierre a Comercial; la respuesta queda en el portal. Los casos anteriores conservan su nombre, cuenta vinculada y avisos. Gerencia no adquiere permisos para dictaminar. El creador manual puede reintentar sus adjuntos desde Detalle. La migración `20261016145732_manual_pqr_fast_intake.sql` conserva las políticas existentes; `supabase/tests/manual_pqr_fast_intake.sql` verifica el flujo dentro de una transacción revertida.

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

Las categorías de auditoría se muestran como botones compactos, cerrados al entrar. Al seleccionar una, se despliega solo su gráfica top 10 y una tabla completa con PQR, auditorías únicas, aplican, no aplican y sin dictamen. El mismo botón u «Ocultar» cierran el panel. La selección se conserva al cambiar filtros o de hoja. «Exportar tabla (Excel)» descarga todos los registros de la categoría seleccionada y el contexto de los filtros, no solo los diez de la gráfica. No inicia consultas nuevas ni altera datos del portal.

Gerencia presenta únicamente tres estudios: KO moderno, KO tradicional y Lindley. Un Survey único de Databricks tiene prioridad (`ko_mod` / `ko_moderno`, `ko_trad` / `ko_tradicional`, `lindley`); sin cruce único, Canal del Excel separa los KO modernos y tradicionales. Se conserva Estudio Excel como fuente original y las correcciones manuales explícitas. Si no hay evidencia suficiente, el ticket permanece en los totales sin inventar un estudio.

Resumen ejecutivo e Indicadores detallados incluyen el evolutivo mensual de PQR registradas, aplican y no aplican, con tabla de valores y sin dictamen para reconciliar el total. Usa el mes de la Ola con los mismos respaldos del filtro, no el mes de recepción. Respeta todos los filtros, excluye RDG/EDC y muestra meses intermedios sin actividad en cero; los registros sin periodo quedan identificados como Sin mes.

La sincronización replica el patrón de Portal de Validación: Databricks envía los datos, no se guarda un token personal de Databricks en Supabase. El trabajo independiente `1057185433641838` usa Reporting Cluster a las **6:00 y 14:00 de America/Bogota**. Consulta solo los ID originales y nuevos vinculados a tickets activos y los 14 campos solicitados, con Ola desde 2026 y Survey KO o Lindley. No modifica la tabla de origen ni el trabajo de Validación.

Gerencia lee el último corte desde Supabase; «Actualizar panel» no inicia un clúster ni una nueva consulta a Databricks. Las estadísticas cuentan PQR por auditoría original, sin mezclar RDG/EDC ni atribuir coincidencias múltiples arbitrariamente. «Ver auditoría» muestra original y nueva. «Pendiente de sincronización» no equivale a «Sin datos»: esto último requiere una consulta exitosa sin coincidencias. Cada auditoría conserva su hora de corte. Los nuevos tickets esperan al siguiente horario; si falla un lote se conserva su corte anterior.

Los archivos están en `databricks/pqr_audit_sync.py`, `supabase/functions/pqr-audit-sync/index.ts`, `supabase/functions/pqr-audits/index.ts` y la migración `20261015144738_pqr_databricks_scheduled_cache.sql`. La caché tiene RLS y solo es visible a cuentas activas de Gerencia/Administración para auditorías vinculadas a tickets activos. El manifiesto solo entrega IDs al sincronizador. El receptor verifica una clave exclusiva cuyo texto permanece en el scope `portal-pqr-audit-sync`, clave `receiver-token`; el código contiene únicamente su SHA-256. No reutilizar el secreto de Validación. No copiar claves de servicio al notebook ni al frontend.

**Restricción comprobada del workspace:** no admite ACL de scopes. Los usuarios con acceso al workspace pueden tener acceso a esa clave de recepción y potencialmente alterar el corte de PQR; limitar los usuarios del workspace y revisar los cortes. La clave no concede acceso a Databricks, cuentas ni escritura en tickets. Si se habilitan ACL, restringir el scope y el trabajo. Puede rotarse por seguridad; no es un PAT con vencimiento periódico. Para una nueva instalación `prepare_receiver_key.mjs` se niega a sobrescribir scopes existentes y solo imprime el digest. El JSON del trabajo se conserva pausado por seguridad en instalaciones nuevas; activar el horario solo después de probar la carga.

## SUPI · KO moderno Chile

SUPI cubre exclusivamente KO moderno Chile: `VISITA` cruza con el ID de auditoría y `FOLIO` con el ID de PDV. La consulta de solo lectura conserva los 17 campos solicitados, restringida a visitas desde 2026 y al estudio SUPI 525 (OSA BEBESTIBLES 2 / EMBONOR, identificado mediante cruces de control). Databricks permanece independiente para los demás estudios; sus IDs numéricos no comparten la caché de SUPI.

La migración `20261016141931_pqr_supi_chile_cache.sql` usa el MSSQL Wrapper nativo y una tabla extranjera en `pqr_private`. Requiere una conexión guardada en Vault con nombre `pqr_supi_connection`; el servidor almacena únicamente su referencia. TLS permanece activo, con la excepción de validación de certificado autorizada exclusivamente para esta conexión. Sustituirla por validación completa cuando SUPI disponga de una cadena confiable. No guardar esta credencial en GitHub, Databricks, archivos de despliegue ni código del navegador.

Cron `pqr-supi-sync` ejecuta una actualización a las 06:00 y 14:00 de Bogotá (`0 11,19 * * *` UTC). La carga primero valida un corte completo y luego reemplaza la caché en una sola transacción; ante fallo mantiene el anterior. Solo postgres puede ejecutarla. El panel lee la caché bajo RLS: Gerencia/Administración activas y únicamente visitas vinculadas a casos de ese estudio. Otros roles no leen los datos ni la conexión. Un ID ausente solo se presenta como «Sin datos» tras leer un corte completo y coherente; la fecha del corte queda visible.

La migración complementaria `20261016143527_pqr_supi_complete_columns.sql` corrige instalaciones previas: wrappers 0.6.2 necesita referencias explícitas a cada columna y un alias remoto sin espacios (`ID_ESTUDIO`). El JSON conserva la etiqueta original `ID ESTUDIO`. La carga rechaza cortes sin estudio 525 o sin fecha, en lugar de aceptar filas que solo tengan VISITA.

El detalle muestra los 17 campos originales y ambas auditorías, cuando existan. Coordinador y comuna tienen categorías y exportaciones propias: **no** se interpretan como validador ni ciudad. SUPI no aporta Ola ni región. Se conserva el mes del Excel para históricos (o radicación para plataforma) y cualquier corrección manual explícita; DIA es la fecha de visita, no un periodo de Ola inventado. La excepción solicitada para excluir Chile moderno de «Datos por completar» se mantiene; sus tickets siempre participan en los totales.

### Sugerencias de auditoría al dictaminar varias PQR

El trabajo de Reporting conserva el cruce por ID existente y añade un corte mínimo por PDV + país + estudio para las PQR pendientes. Solo esta búsqueda nueva considera los últimos 60 días calendario (incluyendo hoy, fecha de auditoría, Bogotá); escoge la auditoría más reciente y desempata por ID numérico. Publica ID, fecha, Ola y Survey en una caché privada, sin nombres de auditores ni validadores. KO moderno Chile sigue fuera de Databricks.

Analistas consulta únicamente las sugerencias de sus PQR seleccionadas con `pqr_suggest_audits`. La lectura no modifica tickets. Cada sugerencia exige confirmación; confirmar todas completa solo campos vacíos y conserva los ID manuales. Los campos siguen editables y el dictamen múltiple mantiene su control de versiones. Sin coincidencia, con corte pendiente o con auditoría fuera de los 60 días se permite ingresar el ID manualmente. Los horarios siguen siendo 6:00 y 14:00 de Bogotá.
