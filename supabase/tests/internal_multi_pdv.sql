-- Transactional integration test: no tickets, emails or real serials survive.
begin;
create temporary sequence internal_bulk_qa_seq start 3000000;
do $$ begin
 execute replace(pg_get_functiondef('pqr_private.new_internal_code(text)'::regprocedure),'pqr_private.internal_code_seq','pg_temp.internal_bulk_qa_seq');
end $$;
do $$
declare
 k text; payload jsonb; rows jsonb; request uuid; result jsonb; again jsonb; child jsonb; case_data jsonb;
 initial_tickets bigint; initial_mail bigint; ids uuid[]; staff_account uuid; operator_role text; path text;
begin
 select count(*) into initial_tickets from public.pqr_tickets;
 assert not has_table_privilege('anon','pqr_private.internal_batches','select');
 assert not has_table_privilege('authenticated','pqr_private.internal_batches','select');
 assert not has_function_privilege('anon','pqr_private.submit_internal_core(uuid,jsonb)','execute');
 assert not has_function_privilege('authenticated','pqr_private.submit_internal_core(uuid,jsonb)','execute');
 assert not (select prosecdef from pg_proc where oid='public.pqr_submit_internal_batch(uuid,jsonb)'::regprocedure);
 foreach k in array array['PQR','RDG','EDC'] loop
  select jsonb_agg(jsonb_build_object('pdv','00'||g,'auditOriginal',case when k='PQR' then '' else '99999000'||g end,'description','Detalle particular de la fila '||g) order by g) into rows from generate_series(1,10)g;
  payload:=jsonb_build_object('kind',k,'requesterName','QA lote rollback','requesterEmail','qa@example.invalid','client','KO moderno','country','Chile','rows',rows,'files','[{"name":"soporte.png","size":500}]'::jsonb);
  request:=gen_random_uuid();
  perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
  execute 'set local role anon';
  result:=public.pqr_submit_internal_batch(request,payload);assert not result ? 'error',result::text;
  again:=public.pqr_submit_internal_batch(request,payload);assert again=result,'Reintentar no duplica el lote';
  again:=public.pqr_submit_internal_batch(request,payload||'{"client":"Lindley"}');assert again ? 'error';
  execute 'reset role';
  assert jsonb_array_length(result->'tickets')=10;
  select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(result->'tickets');
  assert (select count(*) from public.pqr_tickets where id=any(ids))=10,'Diez filas son diez tickets independientes';
  assert (select count(distinct code) from public.pqr_tickets where id=any(ids))=10;
  for child in select value from jsonb_array_elements(result->'tickets') loop
   select data into case_data from public.pqr_tickets where id=(child->>'id')::uuid;
   assert case_data->>'scope'='internal' and case_data->>'requestType'=k and case_data->>'client'='KO moderno';
   assert case_data->>'pdv'=child->>'pdv' and case_data->>'description' like 'Detalle particular de la fila %';
   assert case_data->>'status'=case when k='PQR' then 'Radicado' else 'Pendiente de Redigitación' end;
   if k='EDC' then assert case_data->>'redigitType'='Validación'; end if;
   assert (select count(*) from public.pqr_mail_events where ticket_id=(child->>'id')::uuid and event_type=case when k='PQR' then 'new_pqr' else 'new_redigit' end)=case when k='PQR' then 4 else 2 end;
   assert (select count(*) from public.pqr_mail_events where ticket_id=(child->>'id')::uuid and event_type='received')=1;
   path:=child->'uploadPaths'->>0;
   execute 'set local role anon';assert pqr_private.internal_upload_allowed(path);assert not pqr_private.internal_upload_allowed(path||'.exe');
   assert public.pqr_lookup_internal(child->>'code')->>'code'=child->>'code';execute 'reset role';
  end loop;
  foreach operator_role in array array['validador','redigitador'] loop
   select id into staff_account from public.pqr_profiles where active and role=operator_role limit 1;assert staff_account is not null;
   perform set_config('request.jwt.claim.sub',staff_account::text,true);
   perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_account,'role','authenticated')::text,true);
   execute 'set local role authenticated';
   assert (select count(*) from public.pqr_tickets where id=any(ids))=10,'El equipo puede leer cada solicitud individual';
   execute 'reset role';
  end loop;
 end loop;
 assert (select count(*) from public.pqr_tickets)=initial_tickets+30;
 -- A bad later row, forbidden fields or a huge attachment never leave partial tickets.
 select count(*) into initial_tickets from public.pqr_tickets;select count(*) into initial_mail from public.pqr_mail_events;
 payload:=payload||jsonb_build_object('rows',jsonb_build_array(rows->0,(rows->1)||'{"pdv":"INVALID"}'));
 result:=public.pqr_submit_internal_batch(gen_random_uuid(),payload);assert result ? 'error';
 payload:=payload||jsonb_build_object('rows',jsonb_build_array(rows->0,rows->1));
 result:=public.pqr_submit_internal_batch(gen_random_uuid(),payload||'{"scope":"external"}');assert result ? 'error';
 result:=public.pqr_submit_internal_batch(gen_random_uuid(),payload||'{"requesterEmail":""}');assert result ? 'error';
 result:=public.pqr_submit_internal_batch(gen_random_uuid(),payload||jsonb_build_object('rows',jsonb_build_array(rows->0,rows->0)));assert result ? 'error';
 result:=public.pqr_submit_internal_batch(gen_random_uuid(),payload||'{"files":[{"name":"foto.png","size":104857600}]}');assert result ? 'error';
 assert (select count(*) from public.pqr_tickets)=initial_tickets;
 assert (select count(*) from public.pqr_mail_events)=initial_mail;
end $$;
select 'INTERNAL_BATCH_30_INDIVIDUAL_CASES_ALL_TYPES_ACCESS_MAIL_IDEMPOTENCY_OK' as verification;
rollback;
