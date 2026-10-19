-- Run as the project SQL owner. Entire test rolls back: no tickets or mail remain.
-- Use a transaction-local sequence so testing does not consume real radicados.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
create temporary sequence bulk_qa_seq start 900000;
do $patch$
declare definition text; anchor text:=' select * into v_actor from public.pqr_profiles where id=auth.uid() and active;';
begin
 definition:=pg_get_functiondef('pqr_private.create_manual_pqr(jsonb)'::regprocedure);
 assert strpos(definition,'''public.pqr_code_seq''')>0 and strpos(definition,anchor)>0;
 definition:=replace(definition,'''public.pqr_code_seq''','''pg_temp.bulk_qa_seq''');
 definition:=replace(definition,anchor,' if p_data->>''externalTicketId''=''QA-ROLLBACK-FAIL-2'' then raise exception ''QA_ROLLBACK_BATCH_SECOND''; end if;'||anchor);
 execute definition;
end $patch$;
do $test$
declare
 analyst uuid; manager uuid; commercial uuid; role_name text; actor uuid;
 request uuid:=gen_random_uuid(); payload jsonb; result jsonb; again jsonb; bad jsonb; t jsonb;
 ids uuid[]; initial_count bigint; initial_hash text; real_seq bigint; before_count bigint; rejected boolean;
 received text:=to_char((now()-interval '1 day') at time zone 'America/Bogota','YYYY-MM-DD"T"HH24:MI')||'-05:00';
begin
 select count(*),md5(string_agg(data::text,'|' order by id)) into initial_count,initial_hash from public.pqr_tickets;
 select last_value into real_seq from public.pqr_code_seq;
 select id into analyst from public.pqr_profiles where active and role='validador' limit 1;
 select id into manager from public.pqr_profiles where active and role='gerente' limit 1;
 select id into commercial from public.pqr_profiles where active and role='comercial' limit 1;
 assert analyst is not null and manager is not null and commercial is not null;
 assert not has_table_privilege('anon','pqr_private.manual_batches','select');
 assert not has_table_privilege('authenticated','pqr_private.manual_batches','select');
 assert (select relrowsecurity from pg_class where oid='pqr_private.manual_batches'::regclass);
 assert not (select prosecdef from pg_proc where oid='public.pqr_create_manual_batch(uuid,jsonb)'::regprocedure);
 assert not has_function_privilege('anon','public.pqr_create_manual_batch(uuid,jsonb)','execute');
 payload:=jsonb_build_object('scope','external','client','KO moderno','country','Chile','receivedAt',received,
  'tickets',jsonb_build_array(jsonb_build_object('externalTicketId','QA-'||request||'-1'),jsonb_build_object('externalTicketId','QA-'||request||'-9')));
 perform set_config('request.jwt.claim.sub',analyst::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',analyst,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 result:=public.pqr_create_manual_batch(request,payload);
 again:=public.pqr_create_manual_batch(request,payload);
 assert result=again and jsonb_array_length(result->'tickets')=2,'Reintento debe devolver el mismo lote';
 execute 'reset role';
 select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(result->'tickets');
 assert (select count(*) from public.pqr_tickets where id=any(ids))=2;
 for t in select data from public.pqr_tickets where id=any(ids) loop
  assert t->>'scope'='external' and t->>'requestType'='PQR' and t->>'manualEntry'='true' and t->>'createdBy'=analyst::text;
  assert (t->>'receivedAt')::timestamptz=received::timestamptz and t->>'status'='Radicado';
  assert t->>'pdv'='' and t->>'description'='';
  assert t->>'code' ~ '^PQR-[0-9]{4}-[0-9]+$';
  assert jsonb_array_length(t->'timeline')=2;
 end loop;
 assert (select count(*) from public.pqr_mail_events where ticket_id=any(ids) and event_type='new_pqr')=2;
 before_count:=(select count(*) from public.pqr_tickets);
 execute 'set local role authenticated';
 rejected:=false;begin perform public.pqr_create_manual_batch(request,payload||'{"client":"Lindley"}');exception when raise_exception then rejected:=true;end;assert rejected;
 -- Existing source ticket, duplicates, future date, forged status and internal scope.
 foreach bad in array array[
  payload,
  payload||jsonb_build_object('tickets',jsonb_build_array(jsonb_build_object('externalTicketId','duplicate'),jsonb_build_object('externalTicketId','DUPLICATE'))),
  payload||'{"receivedAt":"2099-01-01T10:00-05:00"}',
  payload||'{"status":"Cerrado"}',
  payload||'{"scope":"internal"}',
  payload||'{"tickets":[]}',
  payload||'{"tickets":[{"externalTicketId":"OK"},{"externalTicketId":""}]}'
 ] loop
  rejected:=false;begin perform public.pqr_create_manual_batch(gen_random_uuid(),bad);exception when others then rejected:=true;end;assert rejected;
 end loop;
 -- Inject a failure on the second real manual insert; first insert must roll back too.
 bad:=payload||'{"tickets":[{"externalTicketId":"QA-ROLLBACK-FAIL-1"},{"externalTicketId":"QA-ROLLBACK-FAIL-2"}]}';
 rejected:=false;begin perform public.pqr_create_manual_batch(gen_random_uuid(),bad);
 exception when raise_exception then rejected:=sqlerrm='QA_ROLLBACK_BATCH_SECOND';end;assert rejected;
 execute 'reset role';
 assert (select count(*) from public.pqr_tickets)=before_count;
 assert not exists(select 1 from public.pqr_tickets where data->>'externalTicketId'='QA-ROLLBACK-FAIL-1');
 assert (select count(*) from pqr_private.manual_batches where actor_id=analyst)=1;
 -- Gerencia passes authorization (invalid input error), Comercial must not.
 perform set_config('request.jwt.claim.sub',manager::text,true);execute 'set local role authenticated';
 rejected:=false;begin perform public.pqr_create_manual_batch(gen_random_uuid(),'{"scope":"internal"}');
 exception when raise_exception then rejected:=sqlerrm like '%solo está disponible en PQR de clientes%';end;assert rejected;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',commercial::text,true);execute 'set local role authenticated';
 rejected:=false;begin perform public.pqr_create_manual_batch(gen_random_uuid(),payload);
 exception when raise_exception then rejected:=sqlerrm like '%Solo Analistas de PQR y Gerencia%';end;assert rejected;
 execute 'reset role';
 assert (select last_value from public.pqr_code_seq)=real_seq,'No consumir numeración de producción en QA';
 assert (select count(*) from public.pqr_tickets where not(id=any(ids)))=initial_count;
 assert (select md5(string_agg(data::text,'|' order by id)) from public.pqr_tickets where not(id=any(ids)))=initial_hash;
end $test$;
select 'BULK_ATOMIC_IDEMPOTENT_ROLES_RECEIPT_AND_ROLLBACK_OK' as verification;
rollback;
