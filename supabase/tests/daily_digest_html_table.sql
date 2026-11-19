begin;
do $test$
declare html text;
begin
 html:=pqr_private.render_daily_digest('[{"code":"PQR-TEST-01","pdv":"000123","before_status":"Radicado","status":"En Validación","reply":"<img src=x onerror=bad> & texto"},{"code":"PQR-TEST-02","pdv":"000124","before_status":"Pendiente de Verificación","status":"Cerrado","reply":"Aprobado"}]'::jsonb,'2026-11-19T22:00:00Z');
 assert html like '%<table%' and html like '%Estado anterior%' and html like '%Estado actual%' and html like '%Respuesta%','Five-column table';
 assert html like '%000123%' and html like '%En revisión%','Preserve PDV and status labels';
 assert html not like '%<img%' and html like '%&lt;img%' and html like '%&amp; texto%','Escape untrusted reply';
 assert (length(html)-length(replace(html,'FINALIZADO','')))/length('FINALIZADO')=1,'Only closed tickets marked finalized';
 assert html like '%bgcolor="#e7f5ed"%' and html like '%bgcolor="#ffffff"%','Closed and open colors';
 assert pqr_private.mail_ticket_reply('{"response":"Solución","redigitNotes":"Corregido","verifyComment":"Aprobado"}') like '%Solución%Corregido%Aprobado%','Keep response and final review';
end $test$;
insert into pqr_private.mail_status_changes(ticket_id,recipient,code,pdv,before_status,status,reply,changed_at)
select (select id from public.pqr_tickets where deleted_at is null and data->>'scope'='internal' limit 1),
 'digest-test@example.invalid','PQR-TEST-DIGEST','000999',x.prev,x.current,x.reply,
 (((now() at time zone 'America/Bogota')::date+time '17:00') at time zone 'America/Bogota')-x.offset_time
from(values('Radicado','En Validación','Respuesta intermedia',interval '10 minutes'),('En Validación','Cerrado','Respuesta final <script>bad</script>',interval '5 minutes'))x(prev,current,reply,offset_time);
select pqr_private.prepare_daily_digest(((now() at time zone 'America/Bogota')::date+time '17:00') at time zone 'America/Bogota');
do $test$
declare q pqr_private.consolidated_mail_queue%rowtype; generated integer; before_count integer;
begin
 select * into strict q from pqr_private.consolidated_mail_queue where recipients=array['digest-test@example.invalid'];
 assert q.body_html like '%Radicado%' and q.body_html like '%Cerrado%','Window initial and final status';
 assert q.body_html like '%Respuesta final &lt;script&gt;bad&lt;/script&gt;%' and q.body_html not like '%Respuesta intermedia%','Latest response snapshot, escaped';
 assert q.subject like '%1 tickets%','Only one row per ticket';
 select count(*) into before_count from pqr_private.consolidated_mail_queue;
 generated:=pqr_private.prepare_daily_digest(((now() at time zone 'America/Bogota')::date+time '17:00') at time zone 'America/Bogota');
 assert generated=0 and (select count(*) from pqr_private.consolidated_mail_queue)=before_count,'No duplicate digest';
 generated:=pqr_private.prepare_daily_digest((((now() at time zone 'America/Bogota')::date+1)+time '17:00') at time zone 'America/Bogota');
 assert generated=0 and (select count(*) from pqr_private.consolidated_mail_queue)=before_count,'No empty digest';
 assert not has_function_privilege('anon','pqr_private.render_daily_digest(jsonb,timestamptz)','execute'),'Renderer remains private';
end $test$;

rollback;
