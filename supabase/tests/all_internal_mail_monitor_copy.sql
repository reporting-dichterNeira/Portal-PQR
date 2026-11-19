begin;
do $test$ declare q pqr_private.consolidated_mail_queue%rowtype; k text; begin
 foreach k in array array['received','team','digest','handoff'] loop
  insert into pqr_private.consolidated_mail_queue(logical_key,recipients,copies,subject,body) values('test-all-copies:'||k,array['test@example.invalid'],array['MASANCHEZ@DICHTER-NEIRA.COM','masanchez@dichter-neira.com'],'Prueba sin envío','No se envía') returning * into q;
  assert q.copies=array['masanchez@dichter-neira.com'],'Copy every notice once';
 end loop;
 insert into pqr_private.consolidated_mail_queue(logical_key,recipients,subject,body) values('test-all-copies:self',array['masanchez@dichter-neira.com'],'Prueba sin envío','No se envía') returning * into q;
 assert cardinality(q.copies)=0,'Never duplicate requester address';
end $test$;

rollback;
