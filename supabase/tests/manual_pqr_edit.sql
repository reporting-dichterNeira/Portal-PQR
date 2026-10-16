-- Transaction-only fixtures: no business changes or mail survive this test.
begin;
do $$
declare
 a uuid; g uuid; c uuid; r uuid; actor uuid; t jsonb; edited jsonb; stamp timestamptz;
 bad jsonb; rejected boolean; fixture uuid:=gen_random_uuid(); count_before bigint;
begin
 select id into a from public.pqr_profiles where active and role='validador' limit 1;
 select id into g from public.pqr_profiles where active and role='gerente' limit 1;
 select id into c from public.pqr_profiles where active and role='comercial' limit 1;
 select id into r from public.pqr_profiles where active and role='redigitador' limit 1;
 assert a is not null and g is not null and c is not null and r is not null;
 assert not has_function_privilege('anon','public.pqr_edit_manual(uuid,timestamptz,jsonb)','execute');
 assert not (select prosecdef from pg_proc where oid='public.pqr_edit_manual(uuid,timestamptz,jsonb)'::regprocedure);
 foreach actor in array array[a,g] loop
  fixture:=gen_random_uuid(); stamp:=clock_timestamp();
  t:=jsonb_build_object('id',fixture,'code','PQR-EDIT-TEST-'||fixture,'manualEntry',true,'requestType','PQR',
    'createdBy',actor,'status','Radicado','client','KO moderno','country','Chile','pdv','','description','',
    'createdAt','2026-10-01T12:00:00Z','timeline','[]'::jsonb);
  insert into public.pqr_tickets(id,code,status,created_at,updated_at,data) values(fixture,t->>'code','Radicado',now(),stamp,t);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  foreach bad in array array['{"client":""}'::jsonb,'{"country":"Inventado"}'::jsonb,'{"pdv":"abc"}'::jsonb,
    '{"status":"Cerrado"}'::jsonb,'{"createdBy":"spoof"}'::jsonb,'{"auditOriginal":"123"}'::jsonb,
    '{"description":"ok","reason":"x"}'::jsonb,jsonb_build_object('externalTicketId',repeat('x',101))] loop
   rejected:=false;
   begin perform public.pqr_edit_manual(fixture,stamp,'{"reason":"Corrección de prueba"}'::jsonb||bad);
   exception when others then rejected:=true; end;
   assert rejected,'No admite campos de flujo ni datos inválidos';
  end loop;
  rejected:=false;
  begin perform public.pqr_edit_manual(fixture,stamp-interval '1 second','{"client":"Lindley","reason":"Corregir estudio"}');
  exception when others then rejected:=true; end;
  assert rejected,'Rechaza una versión desactualizada';
  select count(*) into count_before from public.pqr_notifications;
  edited:=public.pqr_edit_manual(fixture,stamp,'{"client":" KO tradicional ","country":"Perú","pdv":"00123","externalTicketId":" TK-01 ","reason":"Se digitó el estudio equivocado"}');
  assert edited->>'client'='KO tradicional' and edited->>'country'='Perú' and edited->>'pdv'='00123' and edited->>'externalTicketId'='TK-01';
  assert edited->>'description'='' and edited->>'status'='Radicado' and edited->>'createdAt'=t->>'createdAt';
  assert edited->>'createdBy'=actor::text and edited->>'intakeCorrectedBy'=actor::text;
  assert edited->'timeline'->0->>'action'='Radicación manual corregida';
  assert (edited->'timeline'->0->>'detail') like '%antes%' and (edited->'timeline'->0->>'detail') like '%después%';
  assert (select count(*) from public.pqr_notifications)=count_before,'Editar metadatos no duplica avisos';
  execute 'reset role';
  select updated_at into stamp from public.pqr_tickets where id=fixture;
  -- A second save with the original timestamp may not overwrite the first.
  execute 'set local role authenticated';
  edited:=public.pqr_edit_manual(fixture,stamp,'{"client":"Lindley","reason":"Segunda corrección confirmada"}');
  assert edited->>'client'='Lindley' and jsonb_array_length(edited->'timeline')=2;
  execute 'reset role';
  update public.pqr_tickets set status='Cerrado',data=data||'{"status":"Cerrado","applies":"Aplica","description":"Descripción completa","closedAt":"2026-10-02T12:00:00Z"}' where id=fixture;
  select updated_at into stamp from public.pqr_tickets where id=fixture;
  execute 'set local role authenticated';
  rejected:=false;
  begin perform public.pqr_edit_manual(fixture,stamp,'{"pdv":"","reason":"Borrar dato requerido"}');
  exception when others then rejected:=true; end;
  assert rejected,'Una dictaminada no puede perder campos obligatorios';
  edited:=public.pqr_edit_manual(fixture,stamp,'{"country":"Ecuador","reason":"País digitado por error"}');
  assert edited->>'status'='Cerrado' and edited->>'closedAt'='2026-10-02T12:00:00Z';
  execute 'reset role';
 end loop;
 -- Gerencia cannot correct another creator's intake. Commercial/Redigitación never can.
 foreach actor in array array[g,c,r] loop
  update public.pqr_tickets set data=data||jsonb_build_object('createdBy',a) where id=fixture;
  select updated_at into stamp from public.pqr_tickets where id=fixture;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  rejected:=false;
  begin perform public.pqr_edit_manual(fixture,stamp,'{"client":"Lindley","reason":"Prueba de permisos"}');
  exception when others then rejected:=true; end;
  assert rejected,'No puede corregir un caso fuera de su permiso';
  execute 'reset role';
 end loop;
 perform set_config('request.jwt.claim.sub',a::text,true);
 update public.pqr_tickets set commercial_id=c,data=data||jsonb_build_object('manualEntry',false,'commercial',c) where id=fixture;
 select updated_at into stamp from public.pqr_tickets where id=fixture;
 execute 'set local role authenticated';
 rejected:=false;
 begin perform public.pqr_edit_manual(fixture,stamp,'{"client":"Lindley","reason":"No es una radicación manual"}');
 exception when others then rejected:=true; end;
 assert rejected,'No altera radicaciones comerciales';
 execute 'reset role';
end $$;
rollback;
select 'MANUAL_EDIT_TESTS_OK' as result;
