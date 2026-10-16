-- Only two sequence numbers are consumed; all fixtures and notices roll back.
-- Never commit this test transaction: the mailer cannot see its queued events.
begin;
do $$
declare
 analyst uuid; manager uuid; commercial uuid; redigitator uuid; staff uuid; actor uuid;
 ticket jsonb; result jsonb; payload jsonb; bad jsonb; decision text; rejected boolean;
 reference text; policy text; upload_allowed boolean;
begin
 select id into analyst from public.pqr_profiles where active and role='validador' limit 1;
 select id into manager from public.pqr_profiles where active and role='gerente' limit 1;
 select id into commercial from public.pqr_profiles where active and role='comercial' limit 1;
 select id into redigitator from public.pqr_profiles where active and role='redigitador' limit 1;
 select id into staff from public.pqr_staff where active and role='validador' limit 1;
 assert analyst is not null and manager is not null and commercial is not null and redigitator is not null and staff is not null;
 assert not has_function_privilege('anon','public.pqr_create_manual(jsonb)','execute');
 assert not has_function_privilege('authenticated','public.pqr_action_legacy(text,uuid,jsonb)','execute');
 assert not (select prosecdef from pg_proc where oid='public.pqr_create_manual(jsonb)'::regprocedure);
 select with_check into policy from pg_policies where schemaname='storage' and tablename='objects' and policyname='pqr_adjuntos_carga';
 foreach actor in array array[analyst,manager] loop
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor::text,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  foreach bad in array array[
   '{"pdv":"letras"}'::jsonb,jsonb_build_object('externalTicketId',repeat('a',101)),
   jsonb_build_object('description',repeat('a',12001)), '{"client":""}'::jsonb,'{"country":""}'::jsonb
  ] loop
   rejected:=false;
   begin perform public.pqr_create_manual('{"client":"KO tradicional","country":"Colombia"}'::jsonb||bad);
   exception when others then rejected:=true; end;
   assert rejected,'Intake conserva límites y país/estudio obligatorios';
  end loop;
  reference:=case when actor=analyst then 'TK-PRUEBA-001' else '' end;
  ticket:=public.pqr_create_manual(jsonb_build_object('client','KO tradicional','country','Colombia',
   'externalTicketId','  '||reference||'  ','createdBy','spoof','status','Cerrado','requestType','EDC'));
  assert ticket->>'pdv'='' and ticket->>'description'='','Puede radicar sin PDV ni descripción';
  assert ticket->>'externalTicketId'=reference and ticket->>'code' like 'PQR-%','Referencia no sustituye radicado';
  assert ticket->>'manualEntry'='true' and ticket->>'requestType'='PQR' and ticket->>'createdBy'=actor::text and ticket->>'status'='Radicado';
  assert ticket->>'commercial' is null,'Referencia no concede acceso a Comercial';
  execute 'select '||policy||' from (select ''pqr-adjuntos''::text as bucket_id,$1::text as name) objects'
   into upload_allowed using (ticket->>'id')||'/foto.png';
  assert upload_allowed,'Creador conserva adjuntos sin PDV';
  perform set_config('request.jwt.claim.sub',analyst::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',analyst::text,'role','authenticated')::text,true);
  ticket:=public.pqr_action('assign_validator',(ticket->>'id')::uuid,jsonb_build_object('personId',staff::text));
  payload:='{"decision":"yes","auditOriginal":"00123","response":"Respuesta transaccional válida.","area":"Comercial","tipology":"Insumos"}';
  foreach decision in array array['no','yes','redigit'] loop
   foreach bad in array array['{}'::jsonb,'{"pdv":"00123"}'::jsonb,'{"description":"Descripción válida"}'::jsonb,
    '{"pdv":"a123","description":"Descripción válida"}'::jsonb,'{"pdv":"00123","description":"corta"}'::jsonb,
    jsonb_build_object('pdv',repeat('1',81),'description','Descripción válida')] loop
    rejected:=false;
    begin perform public.pqr_action('dictate',(ticket->>'id')::uuid,payload||bad||jsonb_build_object('decision',decision));
    exception when others then rejected:=true; end;
    assert rejected,'Todos los resultados exigen PDV y descripción completos';
    assert (select data->>'pdv'='' and status='En Validación' from public.pqr_tickets where id=(ticket->>'id')::uuid),'Fallo no guarda cambios';
   end loop;
   begin
    result:=public.pqr_action('dictate',(ticket->>'id')::uuid,payload||jsonb_build_object('decision',decision,
     'pdv',' 00123 ','description',' Descripción completada al dictaminar. ','externalTicketId','spoof'));
    assert result->>'pdv'='00123' and result->>'description'='Descripción completada al dictaminar.';
    assert result->>'externalTicketId'=reference and result->>'createdBy'=actor::text;
    assert result->>'intakeCompletedBy'=analyst::text and result->>'intakeCompletedAt' is not null;
    assert exists(select 1 from jsonb_array_elements(result->'timeline') e where e->>'action'='Información de radicación completada');
    assert result->>'status'=case decision when 'no' then 'No Aplica' when 'yes' then 'Cerrado' else 'Pendiente de Redigitación' end;
    raise exception using errcode='PZ001',message='revertir solo este dictamen de prueba';
   exception when sqlstate 'PZ001' then null; end;
  end loop;
  -- Existing complete manual tickets / old already-open dictate forms still work.
  result:=public.pqr_action('dictate',(ticket->>'id')::uuid,payload||'{"pdv":"00123","description":"Descripción completada al dictaminar."}'::jsonb);
  result:=public.pqr_action('reopen',(ticket->>'id')::uuid,'{"reason":"Reapertura de prueba transaccional."}');
  result:=public.pqr_action('dictate',(ticket->>'id')::uuid,payload);
  assert result->>'status'='Cerrado' and result->>'pdv'='00123','Formulario anterior usa datos ya completos';
  execute 'reset role';
  assert not exists(select 1 from public.pqr_mail_events where ticket_id=(ticket->>'id')::uuid and event_type='closed'),'Sin destinatario comercial no encola cierre';
 end loop;
 foreach actor in array array[commercial,redigitator] loop
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor::text,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  rejected:=false;
  begin perform public.pqr_create_manual('{"client":"KO tradicional","country":"Colombia"}'); exception when others then rejected:=true; end;
  assert rejected,'No amplía roles de radicación manual';
  rejected:=false;
  begin perform public.pqr_action('dictate',(ticket->>'id')::uuid,payload); exception when others then rejected:=true; end;
  assert rejected,'No amplía roles para dictaminar';
  if actor=commercial then
   rejected:=false;
   begin perform public.pqr_action('create',null,'{"client":"KO tradicional","country":"Colombia","description":""}'); exception when others then rejected:=true; end;
   assert rejected,'Comercial conserva PDV y descripción obligatorios al crear';
  end if;
  execute 'reset role';
 end loop;
end $$;
rollback;
select 'OK: radicación rápida, permisos, adjuntos y tres dictámenes; pruebas revertidas.' as resultado;
