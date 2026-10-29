-- Run inside a rollback transaction: no tickets, files, notices or mail persist.
begin;
do $$
declare analyst uuid; recipient uuid; outsider uuid; person uuid; payload jsonb; t jsonb; scope text;
 denied boolean; ids uuid[]:='{}'; baseline text; redigit_audit text;
begin
 select id into analyst from public.pqr_profiles where active and role='validador' limit 1;
 select id into recipient from public.pqr_profiles where active and role='redigitador' order by created_at,id limit 1;
 select id into outsider from public.pqr_profiles where active and role='gerente' limit 1;
 select id into person from public.pqr_staff where active and role='redigitador' limit 1;
 assert analyst is not null and recipient is not null and outsider is not null and person is not null;
 assert not has_function_privilege('anon','public.pqr_create_analyst_redigitation(jsonb)','execute');
 assert not has_function_privilege('anon','pqr_private.create_analyst_redigitation(jsonb)','execute');
 assert not (select prosecdef from pg_proc where oid='public.pqr_create_analyst_redigitation(jsonb)'::regprocedure);
 assert not has_table_privilege('authenticated','public.pqr_tickets','update');
 select md5(string_agg(to_jsonb(r)::text,'|' order by id)) into baseline from public.pqr_tickets r;
 payload:='{"pdv":"00123","auditOriginal":"999000123","client":"KO tradicional","country":"Honduras","description":"Prueba transaccional de redigitación directa"}';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 execute 'set local role authenticated';
 denied:=false;begin perform public.pqr_create_analyst_redigitation(payload);exception when raise_exception then denied:=true;end;assert denied;
 execute 'reset role';
 foreach scope in array array['external','internal'] loop
  perform set_config('request.jwt.claim.sub',analyst::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',analyst,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  denied:=false;begin perform public.pqr_create_analyst_redigitation(payload||'{"auditOriginal":""}');exception when raise_exception then denied:=true;end;assert denied;
  denied:=false;begin perform public.pqr_create_analyst_redigitation(payload||'{"pdv":"x"}');exception when raise_exception then denied:=true;end;assert denied;
  denied:=false;begin perform public.pqr_create_analyst_redigitation(payload||'{"scope":"other"}');exception when raise_exception then denied:=true;end;assert denied;
  t:=public.pqr_create_analyst_redigitation(payload||jsonb_build_object('scope',scope,'redigitador',outsider,'requestType','EDC','directRedigitation',false));
  assert t->>'requestType'='RDG' and t->>'redigitador'=recipient::text and t->>'directRedigitation'='true';
  assert t->>'createdBy'=analyst::text and t->>'scope'=scope and t->>'status'='Pendiente de Redigitación';
  assert t->>'auditOriginal'='999000123' and t->>'pdv'='00123';
  assert t->>'code' ~ case scope when 'internal' then '^RDG-INT-[0-9]{4}-[0-9]{4,}$' else '^RDG-[0-9]{4}-[0-9]{4,}$' end;
  ids:=array_append(ids,(t->>'id')::uuid);
  insert into storage.objects(bucket_id,name) values('pqr-adjuntos',(t->>'id')||'/qa-rollback.png');
  execute 'reset role';
  assert exists(select 1 from public.pqr_notifications where ticket_id=(t->>'id')::uuid and user_id=recipient);
  assert exists(select 1 from public.pqr_tickets where id=(t->>'id')::uuid and status='Pendiente de Redigitación');
  assert (select count(*) from public.pqr_mail_events where ticket_id=(t->>'id')::uuid)=case scope when 'internal' then 1 else 0 end;
  perform set_config('request.jwt.claim.sub',recipient::text,true);
  execute 'set local role authenticated';
  -- Redigitation account can read the new case, take ownership and close directly.
  assert exists(select 1 from public.pqr_tickets where id=(t->>'id')::uuid and data->>'redigitador'=recipient::text);
  perform public.pqr_action('assign_redigit',(t->>'id')::uuid,jsonb_build_object('redigitType','Validación','personId',person));
  redigit_audit:='999'||floor(random()*1000000000000)::bigint::text;
  t:=public.pqr_action('redigit',(t->>'id')::uuid,jsonb_build_object('audit',redigit_audit,'notes','Finalización de prueba con rollback'));
  assert t->>'status'='Cerrado' and t->>'closedAt' is not null;
  execute 'reset role';
 end loop;
 assert baseline=(select md5(string_agg(to_jsonb(r)::text,'|' order by id)) from public.pqr_tickets r where not(id=any(ids)));
end $$;
select 'ANALYST_DIRECT_RDG_PERMISSIONS_ROUTING_ATTACHMENTS_AND_CLOSE_OK' as verification;
rollback;
