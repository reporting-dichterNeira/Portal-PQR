-- Entire test transaction rolls back: no tickets, notifications, mail or grants survive.
begin;
-- Use an isolated counter: rollback alone does not undo nextval on a real sequence.
create temporary sequence internal_flow_test_seq start 1000000;
do $$ begin
 execute replace(pg_get_functiondef('pqr_private.new_internal_code(text)'::regprocedure),
  'pqr_private.internal_code_seq','pg_temp.internal_flow_test_seq');
end $$;
do $$
declare
 analyst uuid; redigitator uuid; manager uuid; commercial uuid; analyst_person uuid; redigit_person uuid;
 kind text; request uuid; payload jsonb; receipt jsonb; again jsonb; result jsonb; t jsonb; lookup jsonb;
 rejected boolean; path text; initial_count bigint; original_digest text; internal_id uuid;
begin
 select id into analyst from public.pqr_profiles where active and role='validador' limit 1;
 select id into redigitator from public.pqr_profiles where active and role='redigitador' limit 1;
 select id into manager from public.pqr_profiles where active and role='gerente' limit 1;
 select id into commercial from public.pqr_profiles where active and role='comercial' limit 1;
 select id into analyst_person from public.pqr_staff where active and role='validador' limit 1;
 select id into redigit_person from public.pqr_staff where active and role='redigitador' limit 1;
 assert analyst is not null and redigitator is not null and manager is not null and analyst_person is not null and redigit_person is not null;
 select count(*),md5(string_agg(data::text,'|' order by id)) into initial_count,original_digest from public.pqr_tickets where data->>'scope' is distinct from 'internal';
 assert not has_table_privilege('anon','public.pqr_tickets','select');
 assert not has_table_privilege('anon','pqr_private.internal_receipts','select');
 assert not has_function_privilege('anon','public.pqr_create_manual_scoped(jsonb)','execute');
 assert not (select prosecdef from pg_proc where oid='public.pqr_submit_internal(uuid,jsonb)'::regprocedure);
 assert not (select prosecdef from pg_proc where oid='public.pqr_lookup_internal(text)'::regprocedure);
 foreach kind in array array['PQR','RDG','EDC'] loop
  request:=gen_random_uuid();
  payload:=jsonb_build_object('kind',kind,'requesterName','QA rollback interno','requesterEmail','qa@example.invalid',
   'client','KO moderno','country','Chile','pdv','12345','auditOriginal','9999912345','description','Prueba de flujo con rollback, no radicación real.',
   'scope','external','status','Cerrado','commercial',commercial,'files',jsonb_build_array(jsonb_build_object('name','foto.png','size',500)));
  perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  execute 'set local role anon';
  receipt:=public.pqr_submit_internal(request,payload);
  assert receipt->>'error' is null,receipt::text;
  assert receipt->>'code' ~ ('^'||kind||'-INT-[0-9]{4}-[0-9]{4,}$') and jsonb_array_length(receipt->'uploadPaths')=1;
  again:=public.pqr_submit_internal(request,payload);assert receipt=again,'Reintento no debe duplicar';
  result:=public.pqr_submit_internal(request,payload||'{"description":"Cambio después del envío"}');assert result ? 'error';
  lookup:=public.pqr_lookup_internal(' '||lower(receipt->>'code')||' ');
  assert lookup->>'code'=receipt->>'code';
  assert (select count(*) from jsonb_object_keys(lookup))=6;
  assert not (lookup ?| array['requesterName','requesterEmail','description','timeline','uploadPaths','id']);
  assert public.pqr_lookup_internal('PQR-2026-0019') is null;
  assert public.pqr_lookup_internal(left(receipt->>'code',length(receipt->>'code')-1)) is null;
  path:=receipt->'uploadPaths'->>0;
  assert pqr_private.internal_upload_allowed(path);
  assert not pqr_private.internal_upload_allowed(path||'.exe');
  rejected:=false;begin perform count(*) from public.pqr_tickets;exception when insufficient_privilege then rejected:=true;end;
  assert rejected;
  execute 'reset role';
  internal_id:=(receipt->>'id')::uuid;
  select data into t from public.pqr_tickets where id=internal_id;
  assert t->>'scope'='internal' and t->>'requesterName'='QA rollback interno' and t->>'commercial' is null;
  assert t->>'status'=case when kind='PQR' then 'Radicado' else 'Pendiente de Redigitación' end;
  assert (select count(*) from public.pqr_tickets where id=internal_id)=1;
  assert exists(select 1 from public.pqr_mail_events where ticket_id=internal_id and event_type=case when kind='PQR' then 'new_pqr' else 'new_redigit' end);
  perform set_config('request.jwt.claim.sub',commercial::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',commercial,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  assert (select count(*) from public.pqr_tickets where id=internal_id)=0,'Comercial no obtiene lectura del caso interno';
  execute 'reset role';
  if kind='PQR' then
   perform set_config('request.jwt.claim.sub',analyst::text,true);
   execute 'set local role authenticated';
   result:=public.pqr_action('assign_validator',internal_id,jsonb_build_object('personId',analyst_person));
   result:=public.pqr_action('dictate',internal_id,jsonb_build_object('decision','redigit','auditOriginal','9999912345','response','Aplica y requiere redigitación','tipology','Confunde SKU','area','Validación'));
   assert result->>'status'='Pendiente de Redigitación';
   execute 'reset role';
  end if;
  perform set_config('request.jwt.claim.sub',redigitator::text,true);
  execute 'set local role authenticated';
  if kind='EDC' then
   rejected:=false;begin perform public.pqr_action('assign_redigit',internal_id,'{"redigitType":"Campo","fieldPerson":"QA Campo"}');exception when others then rejected:=true;end;
   assert rejected,'Una edición no puede ir a Campo';
  end if;
  result:=public.pqr_action('assign_redigit',internal_id,jsonb_build_object('redigitType','Validación','personId',redigit_person));
  if kind='EDC' then
   result:=public.pqr_action('edit_complete',internal_id,'{"edited":"yes","comment":"Edición de prueba, se revierte"}');
   assert result->>'status'='Cerrado' and result->>'audit' is null;
  else
   result:=public.pqr_action('redigit',internal_id,jsonb_build_object('audit',case when kind='RDG' then '9999922222' else '9999921111' end,'notes','Redigitación de prueba con rollback'));
   assert result->>'status'=case when kind='RDG' then 'Cerrado' else 'Pendiente de Verificación' end;
  end if;
  execute 'reset role';
  if kind='PQR' then
   perform set_config('request.jwt.claim.sub',analyst::text,true);execute 'set local role authenticated';
   result:=public.pqr_action('verify',internal_id,'{"ok":"yes","comment":"Verificación de prueba correcta"}');assert result->>'status'='Cerrado';
   execute 'reset role';
  end if;
  assert exists(select 1 from public.pqr_mail_events where ticket_id=internal_id and event_type='received' and recipient_email='qa@example.invalid');
  assert (select count(*) from public.pqr_mail_events where ticket_id=internal_id and event_type='closed' and recipient_email='qa@example.invalid')=1;
  assert not exists(select 1 from public.pqr_mail_events where ticket_id=internal_id and event_type='closed' and recipient_profile_id is not null),'El cierre interno avisa al solicitante, no a una cuenta Comercial';
  perform set_config('request.jwt.claim.sub','',true);execute 'set local role anon';
  lookup:=public.pqr_lookup_internal(receipt->>'code');assert lookup->>'status'='Cerrado' and lookup->>'closedAt' is not null;
  execute 'reset role';
  update public.pqr_tickets set deleted_at=now() where id=internal_id;
  execute 'set local role anon';assert public.pqr_lookup_internal(receipt->>'code') is null;assert not pqr_private.internal_upload_allowed(path);execute 'reset role';
 end loop;
 -- Invalid requests and counters are tested without persisting business data.
 perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
 execute 'set local role anon';
 result:=public.pqr_submit_internal(gen_random_uuid(),payload||'{"kind":"ADMIN"}');assert result ? 'error';
 result:=public.pqr_submit_internal(gen_random_uuid(),payload||'{"auditOriginal":"injection"}');assert result ? 'error';
 result:=public.pqr_submit_internal(gen_random_uuid(),payload||'{"files":[{"name":"file.exe","size":10}]}');assert result ? 'error';
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',manager::text,true);execute 'set local role authenticated';
 rejected:=false;
 begin
  perform public.pqr_create_manual_scoped('{"scope":"internal","client":"Lindley","country":"Perú","externalTicketId":"QA-rollback"}');
 exception when raise_exception then rejected:=sqlerrm like '%solo está disponible en PQR de clientes%'; end;
 assert rejected,'La radicación manual interna debe rechazarse';
 execute 'reset role';
 assert (select count(*) from public.pqr_tickets where data->>'scope' is distinct from 'internal')=initial_count;
 assert (select md5(string_agg(data::text,'|' order by id)) from public.pqr_tickets where data->>'scope' is distinct from 'internal')=original_digest;
end $$;
select 'INTERNAL_SQL_FLOWS_AND_PERMISSIONS_OK' as verification;
rollback;
