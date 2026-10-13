-- Prueba transaccional: no quedan tickets/avisos ni se envían correos.
-- La secuencia consume cinco números; Postgres no revierte secuencias.
begin;
do $$
declare
  v_analyst uuid; v_manager uuid; v_commercial uuid; v_redigit uuid;
  v_staff uuid; v_redigit_staff uuid; v_actor uuid;
  v_ticket jsonb; v_payload jsonb; v_rejected boolean;
  v_name text; v_i integer; v_policy text; v_allowed boolean;
begin
  select id into v_analyst from public.pqr_profiles where role='validador' and active order by created_at limit 1;
  select id into v_manager from public.pqr_profiles where role='gerente' and active order by created_at limit 1;
  select id into v_commercial from public.pqr_profiles where role='comercial' and active order by created_at limit 1;
  select id into v_redigit from public.pqr_profiles where role='redigitador' and active order by created_at limit 1;
  select id into v_staff from public.pqr_staff where role='validador' and active order by name limit 1;
  select id into v_redigit_staff from public.pqr_staff where role='redigitador' and active order by name limit 1;
  assert v_analyst is not null and v_manager is not null and v_commercial is not null
    and v_redigit is not null and v_staff is not null and v_redigit_staff is not null, 'Se requieren roles y responsables activos';
  select with_check into v_policy from pg_policies where schemaname='storage' and tablename='objects' and policyname='pqr_adjuntos_carga';
  assert not has_function_privilege('anon','public.pqr_create_manual(jsonb)','execute'), 'RPC no pública';
  v_payload := '{"pdv":"00123","client":"KO tradicional","country":"Colombia","source":"Correo","description":"Prueba transaccional sin guardar."}';
  foreach v_actor in array array[v_analyst,v_manager] loop
    perform set_config('request.jwt.claim.sub',v_actor::text,true);
    execute 'set local role authenticated';
    v_rejected := false;
    begin perform public.pqr_create_manual(v_payload || jsonb_build_object('commercialName',repeat('a',151)));
    exception when others then v_rejected := true; end;
    assert v_rejected, 'Nombre máximo 150 caracteres';
    for v_i in 1..2 loop
      v_name := case when v_i=1 then 'Comercial externo <prueba>' else '' end;
      -- Caso 1: texto libre; caso 2: omisión completa del campo.
      perform set_config('request.jwt.claim.sub',v_actor::text,true);
      v_ticket := public.pqr_create_manual(case when v_i=1 then v_payload || jsonb_build_object('commercialName','  ' || v_name || '  ') else v_payload end);
      assert v_ticket->>'commercialName'=v_name and v_ticket->>'commercial' is null, 'Nombre opcional sin vincular cuentas';
      assert v_ticket->>'createdBy'=v_actor::text and v_ticket->>'status'='Radicado', 'Creador real y flujo normal';
      assert v_ticket->'timeline'->0->>'detail' like '%' || coalesce(nullif(v_name,''),'No indicado') || '%', 'Nombre en historial';
      execute 'select ' || v_policy || ' from (select ''pqr-adjuntos''::text as bucket_id, $1::text as name) objects'
        into v_allowed using (v_ticket->>'id') || '/foto.png';
      assert v_allowed, 'Creador conserva adjuntos';
      perform set_config('request.jwt.claim.sub',v_commercial::text,true);
      assert not exists(select 1 from public.pqr_tickets where id=(v_ticket->>'id')::uuid), 'Ningún Comercial ve una PQR sin cuenta';
      perform set_config('request.jwt.claim.sub',v_analyst::text,true);
      v_ticket := public.pqr_action('assign_validator',(v_ticket->>'id')::uuid,jsonb_build_object('personId',v_staff::text));
      v_ticket := public.pqr_action('dictate',(v_ticket->>'id')::uuid,
        jsonb_build_object('decision',case when v_i=1 then 'yes' else 'redigit' end,'auditOriginal','00123','response','Respuesta de prueba transaccional.'));
      if v_i=2 then
        perform set_config('request.jwt.claim.sub',v_redigit::text,true);
        v_ticket := public.pqr_action('assign_redigit',(v_ticket->>'id')::uuid,jsonb_build_object('redigitType','Validación','personId',v_redigit_staff::text));
        v_ticket := public.pqr_action('redigit',(v_ticket->>'id')::uuid,jsonb_build_object('audit',regexp_replace(v_ticket->>'code','[^0-9]','','g') || '99','notes','Prueba transaccional de cambio.'));
        assert v_ticket->>'status'='Pendiente de Verificación', 'Mantiene verificación de PQR';
        perform set_config('request.jwt.claim.sub',v_analyst::text,true);
        v_ticket := public.pqr_action('verify',(v_ticket->>'id')::uuid,'{"ok":"yes","comment":"Verificada en prueba transaccional."}');
      end if;
      assert v_ticket->>'status'='Cerrado', 'Se cierra sin destinatario comercial';
      perform set_config('request.jwt.claim.sub',v_commercial::text,true);
      v_rejected := false;
      begin perform public.pqr_action('feedback',(v_ticket->>'id')::uuid,'{"ok":"yes"}');
      exception when others then v_rejected := true; end;
      assert v_rejected, 'Comercial no puede calificar registros sin cuenta';
      execute 'reset role';
      assert not exists(select 1 from public.pqr_mail_events where ticket_id=(v_ticket->>'id')::uuid and event_type='closed'), 'No encola correo sin destinatario';
      assert exists(select 1 from public.pqr_mail_events where ticket_id=(v_ticket->>'id')::uuid and event_type='new_pqr'), 'Aviso a Analistas intacto';
      execute 'set local role authenticated';
    end loop;
    execute 'reset role';
  end loop;
  -- Compatibilidad con formularios abiertos antes de publicar la nueva interfaz.
  perform set_config('request.jwt.claim.sub',v_analyst::text,true);
  execute 'set local role authenticated';
  v_ticket := public.pqr_create_manual(v_payload || jsonb_build_object('commercialId',v_commercial::text));
  assert v_ticket->>'commercial'=v_commercial::text, 'Conserva asociación explícita anterior';
  v_ticket := public.pqr_action('assign_validator',(v_ticket->>'id')::uuid,jsonb_build_object('personId',v_staff::text));
  v_ticket := public.pqr_action('dictate',(v_ticket->>'id')::uuid,'{"decision":"yes","auditOriginal":"00123","response":"Respuesta transaccional anterior."}');
  execute 'reset role';
  assert exists(select 1 from public.pqr_mail_events where ticket_id=(v_ticket->>'id')::uuid and event_type='closed' and recipient_profile_id=v_commercial), 'Comercial vinculado conserva correo de cierre';
end $$;
rollback;
select 'OK: nombre opcional, permisos, adjuntos, cierre y redigitación; pruebas revertidas.' as resultado;
