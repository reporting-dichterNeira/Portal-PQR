# Avisos agrupados internos de Portal PQR

## Flujo

Supabase (pg_cron + pg_net) → receptor firmado de Teams Webhook en Power Automate → Office 365 Outlook «Send an email from a shared mailbox (V2)».
Remitente: Reporting_Planeacion@dichter-neira.com. Usa conectores estándar; no requiere el mensaje intermedio de Gmail ni la aplicación personalizada de Graph.
La URL firmada está en Vault con el nombre `pqr_power_automate_url`. No debe copiarse al frontend, GitHub, logs ni documentos.
Flujo de Power Automate: `223f240e-2ce1-4ef4-8780-c335cb54ac92` en el entorno predeterminado de Dichter & Neira.

## Comportamiento

- Cada envío público, individual o múltiple, recibe un código ENV y conserva todos sus tickets individuales (hasta 200 por tanda).
- Al registrar: un correo al solicitante y uno al equipo correspondiente, con la cantidad de PDV y el consolidado. Los destinatarios operativos y las copias de seguimiento se incluyen en un solo correo de equipo.
- Consultar mi ticket admite radicado, PDV y código ENV. El ENV lista los tickets de esa tanda con los mismos campos públicos ya autorizados.
- A las 17:00 America/Bogota se preparan los resúmenes por correo de contacto, reuniendo todas sus tandas. Solo incluyen tickets con cambios de estado y su último estado en el corte. Si no hay novedades, no se crea correo.
- Cambios a partir de las 17:00 se incluyen en el siguiente corte. Si el programador se interrumpe, el siguiente corte incluye las novedades aún no resumidas.
- Los tickets anteriores a la activación pueden generar resumen cuando cambien a partir de la activación. No se reenvían avisos anteriores.
- No hay correo para casos de clientes ni para históricos externos.
- La remisión a Redigitación se agrupa por transacción para que un dictamen múltiple no produzca un correo operativo por ticket.

## Persistencia y operación

Tablas privadas, con RLS y sin permisos directos para anon, authenticated o service_role:
`submission_groups`, `submission_members`, `mail_status_changes`, `consolidated_mail_queue`, `consolidated_mail_config`.

El programador `pqr-consolidated-mail-every-minute` comprueba el corte diario y despacha hasta cinco avisos por minuto. Cada aviso usa una clave lógica única para evitar duplicar recibos o resúmenes por un reintento de la aplicación.
El programador anterior `pqr-mailer-every-minute` se pausa y sus avisos internos pendientes se conservan cancelados como auditoría.

Estados de la cola: pending, submitted, accepted, failed, unknown. «accepted» indica aceptación HTTP del flujo de Microsoft; no confirma entrega en Inbox. Revisar el historial de Power Automate para saber si Outlook terminó correctamente.
No se reintentan automáticamente las respuestas ambiguas: evita duplicar correos cuando no se puede determinar si Microsoft recibió la petición. Las acciones de Outlook conservan su gestión de errores propia.
La aceptación HTTP puede preceder a un fallo de Outlook. La cola no dispone aún de confirmación automática de entrega desde Power Automate; esos casos se comprueban en el historial del flujo antes de decidir un reenvío.

## Verificación

- Power Automate: llamada real desde pg_net respondió 202 y ejecución Succeeded. Segunda prueba con destinatario/asunto/cuerpo dinámicos también Succeeded.
- `supabase/tests/consolidated_mail.sql`: transacción con rollback que prueba tickets individuales, consolidado, dos avisos por tanda, reintento idempotente, consulta sin correos, captura de cambios, resumen único y ausencia de resúmenes vacíos; también verifica que anon no pueda invocar el despachador/finalizador.
- `node --test test_internal_ticketing.cjs test_internal_bulk.cjs test_internal_excel_priority.cjs`.

Prueba local de la migración de activación: reemplazar COMMIT final por ROLLBACK y comprobar el resultado. La activación real debe ejecutarse solo después de verificar el flujo dinámico y publicar el frontend compatible.

## Activación verificada

17 de noviembre de 2026: migraciones instaladas y cola activada. Verificación final: enabled=true, nuevo Cron activo y última ejecución succeeded; Cron anterior pausado; cero avisos internos antiguos pendientes. Las rutas PQR (cuatro destinatarios) y Redigitación/Edición (dos destinatarios) coinciden con las indicadas por el usuario.
Prueba adicional: `supabase/tests/consolidated_mail_dispatch.sql` comprueba la llamada pg_net y el escape HTML en una transacción revertida, sin enviar otro correo.

## Códigos breves

Los consolidados usan ENV-000001, con seis dígitos consecutivos. Los códigos largos anteriores se conservan como alias de consulta. La migración conserva las claves de deduplicación de avisos y no reenvía correos ya enviados. Verificación del 17/11/2026: envío individual inactivo, cero avisos individuales internos pendientes; envío consolidado activo.

## Resumen diario en tabla

19 de noviembre de 2026: el resumen HTML contiene Radicado, ID de PDV, Estado anterior, Estado actual y Respuesta. El estado anterior es el inicio del periodo; el actual es el último cambio incluido. Conserva una fila por ticket, un correo por solicitante y el corte de las 17:00 de Bogotá. Los casos Cerrado/No Aplica aparecen en verde con FINALIZADO.
Las respuestas futuras se guardan junto al cambio de estado; incluyen la respuesta, notas de redigitación, edición y verificación disponibles. Para cambios previos a esta actualización se usa la respuesta disponible en el caso. Todos los textos se escapan antes de incorporarlos al HTML. Los otros avisos mantienen su formato anterior.
Prueba transaccional con rollback: supabase/tests/daily_digest_html_table.sql; valida agrupación, estados inicial/final, última respuesta, escape HTML, colores, ausencia de duplicados y resúmenes vacíos.
