-- Ejecutar en SQL Editor de Portal PQR después de aplicar la migración.
-- Todos los casos y avisos de prueba se revierten: no se envían correos.
-- La secuencia puede consumir dos números de radicado (Postgres no los revierte).
begin;
do $$
declare
  v_analyst uuid;
  v_manager uuid;
  v_commercial uuid;
  v_staff uuid;
  v_actor uuid;
  v_other uuid;
  v_ticket jsonb;
  v_payload jsonb;
  v_rejected boolean;
  v_upload_allowed boolean;
  v_upload_policy text;
begin
  select id into v_analyst from public.pqr_profiles where role='validador' and active order by created_at limit 1;
  select id into v_manager from public.pqr_profiles where role='gerente' and active order by created_at limit 1;
  select id into v_commercial from public.pqr_profiles where role='comercial' and active order by created_at limit 1;
  select id into v_staff from public.pqr_staff where role='validador' and active order by name limit 1;
  assert v_analyst is not null and v_manager is not null and v_commercial is not null and v_staff is not null,
    'Se requieren cuentas activas de Analistas, Gerencia y Comercial, y un responsable analista';
  select with_check into v_upload_policy from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='pqr_adjuntos_carga';
  assert not has_function_privilege('anon','public.pqr_create_manual(jsonb)','execute'), 'Anon no debe ejecutar la RPC';
  assert not has_function_privilege('anon','pqr_private.create_manual_pqr(jsonb)','execute'), 'Anon no debe ejecutar el núcleo privado';
  assert not (select prosecdef from pg_proc where oid='public.pqr_create_manual(jsonb)'::regprocedure), 'RPC pública debe ser invoker';

  v_payload := jsonb_build_object('commercialId',v_commercial::text,'pdv','00123',
    'client','KO tradicional','country','Colombia','source','Correo',
    'description','Prueba transaccional de radicación manual, no guardar.',
    'createdBy','usuario-falso','status','Cerrado','requestType','EDC');
  foreach v_actor in array array[v_analyst,v_manager] loop
    perform set_config('request.jwt.claim.sub',v_actor::text,true);
    execute 'set local role authenticated';

    v_rejected := false;
    begin perform public.pqr_create_manual(v_payload || '{"pdv":"12abc"}');
    exception when others then v_rejected := true; end;
    assert v_rejected, 'Debe rechazar PDV con letras';
    v_rejected := false;
    begin perform public.pqr_create_manual(v_payload || jsonb_build_object('commercialId',v_analyst::text));
    exception when others then v_rejected := true; end;
    assert v_rejected, 'No puede asociarse a una cuenta que no sea Comercial';
    v_rejected := false;
    begin perform public.pqr_create_manual(v_payload || '{"country":"Otro país"}');
    exception when others then v_rejected := true; end;
    assert v_rejected, 'Debe validar país';

    v_ticket := public.pqr_create_manual(v_payload);
    assert v_ticket->>'status'='Radicado' and v_ticket->>'requestType'='PQR' and v_ticket->>'code' like 'PQR-%', 'Debe iniciar flujo PQR normal';
    assert v_ticket->>'commercial'=v_commercial::text and v_ticket->>'createdBy'=v_actor::text, 'No puede suplantar creador o destinatario';
    assert v_ticket->>'pdv'='00123' and (v_ticket->>'manualEntry')::boolean, 'Conservar ceros y origen manual';
    assert v_ticket->'timeline'->0->>'action'='PQR radicada manualmente', 'Debe dejar historial';
    execute 'select ' || v_upload_policy || ' from (select ''pqr-adjuntos''::text as bucket_id, $1::text as name) as objects'
      into v_upload_allowed using (v_ticket->>'id') || '/evidencia.png';
    assert v_upload_allowed, 'Creador manual debe poder cargar archivos';
    v_other := case when v_actor=v_analyst then v_manager else v_analyst end;
    perform set_config('request.jwt.claim.sub',v_other::text,true);
    execute 'select ' || v_upload_policy || ' from (select ''pqr-adjuntos''::text as bucket_id, $1::text as name) as objects'
      into v_upload_allowed using (v_ticket->>'id') || '/evidencia.png';
    assert not v_upload_allowed, 'Otra cuenta no debe cargar en una radicación ajena';

    execute 'reset role';
    assert exists(select 1 from public.pqr_mail_events where ticket_id=(v_ticket->>'id')::uuid
      and recipient_profile_id=v_analyst and event_type='new_pqr'), 'Debe encolar aviso para Analistas';
    perform set_config('request.jwt.claim.sub',v_analyst::text,true);
    execute 'set local role authenticated';
    v_ticket := public.pqr_action('assign_validator',(v_ticket->>'id')::uuid,jsonb_build_object('personId',v_staff::text));
    assert v_ticket->>'status'='En Validación', 'Asignación normal';
    v_ticket := public.pqr_action('dictate',(v_ticket->>'id')::uuid,
      '{"decision":"yes","auditOriginal":"001234","response":"Respuesta transaccional, no enviar."}'::jsonb);
    assert v_ticket->>'status'='Cerrado', 'Dictamen y cierre normal';
    perform set_config('request.jwt.claim.sub',v_commercial::text,true);
    assert exists(select 1 from public.pqr_tickets where id=(v_ticket->>'id')::uuid), 'Comercial debe ver el caso con RLS';
    execute 'select ' || v_upload_policy || ' from (select ''pqr-adjuntos''::text as bucket_id, $1::text as name) as objects'
      into v_upload_allowed using (v_ticket->>'id') || '/evidencia.png';
    assert v_upload_allowed, 'Comercial conserva permisos de adjuntos';
    assert exists(select 1 from public.pqr_notifications where ticket_id=(v_ticket->>'id')::uuid and user_id=v_commercial), 'Comercial recibe aviso';
    v_rejected := false;
    begin perform public.pqr_create_manual(v_payload);
    exception when others then v_rejected := true; end;
    assert v_rejected, 'Comercial no debe usar radicación delegada';
    execute 'reset role';
    assert exists(select 1 from public.pqr_mail_events where ticket_id=(v_ticket->>'id')::uuid
      and recipient_profile_id=v_commercial and event_type='closed'), 'Cierre se encola para Comercial';
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  v_rejected := false;
  begin perform public.pqr_create_manual(v_payload);
  exception when others then v_rejected := true; end;
  assert v_rejected, 'Sin sesión debe rechazar';
end $$;
rollback;
select 'OK: Analistas y Gerencia, permisos, adjuntos, trazabilidad, asignación, dictamen y avisos. Casos de prueba revertidos.' as resultado;
