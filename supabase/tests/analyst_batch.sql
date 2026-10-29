-- Full rollback: fixtures, workflow updates, notifications and mail never become visible.
begin;
do $$
declare analyst uuid; person uuid; outsider uuid; ids uuid[]:=array[gen_random_uuid(),gen_random_uuid()];
 common jsonb; items jsonb; result jsonb; decision text; n integer; rejected boolean;
 original_digest text; fixture_digest text; event_count integer; original_count integer;
begin
 select id into analyst from public.pqr_profiles where active and role='validador' limit 1;
 select id into person from public.pqr_staff where active and role='validador' limit 1;
 select id into outsider from public.pqr_profiles where active and role='gerente' limit 1;
 assert analyst is not null and person is not null and outsider is not null;
 assert not has_function_privilege('anon','public.pqr_analyst_batch(text,jsonb,jsonb)','execute');
 assert not has_function_privilege('anon','pqr_private.analyst_batch(text,jsonb,jsonb)','execute');
 assert not (select prosecdef from pg_proc where oid='public.pqr_analyst_batch(text,jsonb,jsonb)'::regprocedure);
 assert not has_table_privilege('authenticated','public.pqr_tickets','update');
 select md5(string_agg(to_jsonb(t)::text,'|' order by id)),count(*) into original_digest,original_count from public.pqr_tickets t;
 for n in 1..2 loop
  insert into public.pqr_tickets(id,code,status,created_at,updated_at,data) values(ids[n],'PQR-INT-2099-'||(970000000+n),'Radicado',now(),clock_timestamp(),
   jsonb_build_object('id',ids[n],'code','PQR-INT-2099-'||(970000000+n),'scope','internal','publicInternal',true,'requestType','PQR',
   'requesterName','QA rollback lote','requesterEmail','qa@example.invalid','client','KO tradicional','country','Honduras',
   'pdv','00'||n,'auditOriginal','100'||n,'description','Descripción propia '||n,'status','Radicado','createdAt',now(),'timeline','[]'::jsonb));
 end loop;
 common:=jsonb_build_object('personId',person,'decision','yes','response','Respuesta común de prueba con rollback','tipology','Confunde SKU','area','Validación');
 select jsonb_agg(jsonb_build_object('id',id,'expectedUpdatedAt',updated_at,'auditOriginal',data->>'auditOriginal') order by id) into items from public.pqr_tickets where id=any(ids);
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 rejected:=false;begin perform public.pqr_analyst_batch('assign',items,common);exception when raise_exception then rejected:=true;end;assert rejected;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',analyst::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',analyst,'role','authenticated')::text,true);
 -- Malformed selections and stale versions must change nothing.
 select md5(string_agg(to_jsonb(t)::text,'|' order by id)) into fixture_digest from public.pqr_tickets t where id=any(ids);
 execute 'set local role authenticated';
 rejected:=false;begin perform public.pqr_analyst_batch('assign','[]',common);exception when raise_exception then rejected:=true;end;assert rejected;
 rejected:=false;begin perform public.pqr_analyst_batch('assign',jsonb_build_array(items->0,items->0),common);exception when raise_exception then rejected:=true;end;assert rejected;
 rejected:=false;begin perform public.pqr_analyst_batch('assign',jsonb_set(items,'{0,expectedUpdatedAt}',to_jsonb((now()-interval '1 day')::text)),common);exception when raise_exception then rejected:=true;end;assert rejected;
 rejected:=false;begin perform public.pqr_analyst_batch('dictate',jsonb_set(items,'{1,auditOriginal}','""'),common);exception when raise_exception then rejected:=true;end;assert rejected;
 execute 'reset role';
 assert fixture_digest=(select md5(string_agg(to_jsonb(t)::text,'|' order by id)) from public.pqr_tickets t where id=any(ids));
 -- Assignment requires no audit. Every successful verdict keeps the two distinct audits and PDVs.
 execute 'set local role authenticated';
 result:=public.pqr_analyst_batch('assign',items,common);assert (result->>'count')::int=2;
 execute 'reset role';
 assert (select bool_and(status='En Validación' and data->>'validatorPersonId'=person::text) from public.pqr_tickets where id=any(ids));
 foreach decision in array array['yes','no','redigit'] loop
  update public.pqr_tickets set status='Radicado',data=data||'{"status":"Radicado"}',updated_at=clock_timestamp() where id=any(ids);
  select jsonb_agg(jsonb_build_object('id',id,'expectedUpdatedAt',updated_at,'auditOriginal',data->>'auditOriginal') order by id) into items from public.pqr_tickets where id=any(ids);
  execute 'set local role authenticated';
  result:=public.pqr_analyst_batch('dictate',items,common||jsonb_build_object('decision',decision));assert (result->>'count')::int=2;
  execute 'reset role';
  assert (select bool_and(status=case decision when 'yes' then 'Cerrado' when 'no' then 'No Aplica' else 'Pendiente de Redigitación' end and data->>'response'=common->>'response') from public.pqr_tickets where id=any(ids));
  for n in 1..2 loop
   assert (select data->>'auditOriginal'='100'||n and data->>'pdv'='00'||n and data->>'description'='Descripción propia '||n from public.pqr_tickets where id=ids[n]);
  end loop;
 end loop;
 -- A late workflow exception must also roll back assignments and their queued notices.
 update public.pqr_tickets set status='Radicado',data=data||'{"status":"Radicado"}',updated_at=clock_timestamp() where id=any(ids);
 select jsonb_agg(jsonb_build_object('id',id,'expectedUpdatedAt',updated_at,'auditOriginal',data->>'auditOriginal') order by id) into items from public.pqr_tickets where id=any(ids);
 select md5(string_agg(to_jsonb(t)::text,'|' order by id)) into fixture_digest from public.pqr_tickets t where id=any(ids);
 select count(*) into event_count from public.pqr_mail_events where ticket_id=any(ids);
 rejected:=false;
 begin
  update public.pqr_profiles set active=false where role='redigitador' and active;
  execute 'set local role authenticated';
  perform public.pqr_analyst_batch('dictate',items,common||'{"decision":"redigit"}');
 exception when raise_exception then rejected:=sqlerrm='No hay cuenta de Redigitación activa';
 end;
 execute 'reset role';assert rejected;
 assert fixture_digest=(select md5(string_agg(to_jsonb(t)::text,'|' order by id)) from public.pqr_tickets t where id=any(ids));
 assert event_count=(select count(*) from public.pqr_mail_events where ticket_id=any(ids));
 assert original_digest=(select md5(string_agg(to_jsonb(t)::text,'|' order by id)) from public.pqr_tickets t where not(id=any(ids)));
 assert original_count=(select count(*) from public.pqr_tickets where not(id=any(ids)));
end $$;
select 'ANALYST_BATCH_ATOMICITY_WORKFLOW_AND_PERMISSIONS_OK' as verification;
rollback;
