begin;
do $test$
declare event_id uuid; http bigint; state text;
begin
 update pqr_private.consolidated_mail_config set enabled=true,activated_at=now(),digest_cutoff=now() where singleton;
 insert into pqr_private.consolidated_mail_queue(logical_key,recipients,subject,body,created_at)
 values('rollback-dispatch:'||gen_random_uuid(),array['masanchez@dichter-neira.com'],'Prueba transaccional sin envío','Detalle <privado> & prueba',now()-interval '100 years') returning id into event_id;
 perform pqr_private.dispatch_consolidated_mail();
 select http_id,q.state into http,state from pqr_private.consolidated_mail_queue q where id=event_id;
 assert state='submitted','No se preparó la llamada';
 assert exists(select 1 from net.http_request_queue n where n.id=http and (convert_from(n.body,'UTF8')::jsonb#>>'{pqr,to}')='masanchez@dichter-neira.com' and (convert_from(n.body,'UTF8')::jsonb#>>'{pqr,html}') like '%&lt;privado&gt; &amp; prueba%'),'Contenido o escape inválido';
end $test$;
select 'DISPATCH_ROLLBACK_OK_NO_EMAIL_SENT' as result;
rollback;
