begin;
set local lock_timeout='5s';
alter table public.pqr_profiles add column field_country text;
alter table public.pqr_profiles drop constraint pqr_profiles_role_check;
alter table public.pqr_profiles add constraint pqr_profiles_role_check check(role in ('admin','gerente','validador','redigitador','comercial','universal','campo'));
alter table public.pqr_profiles add constraint pqr_field_country_check check((role='campo' and field_country in ('Costa Rica','El Salvador','Guatemala','Honduras','Nicaragua','Panamá')) or (role<>'campo' and field_country is null));
create unique index pqr_one_field_account_country on public.pqr_profiles(field_country) where role='campo';
create function pqr_private.field_can_read(d jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pqr_profiles p where p.id=auth.uid() and p.active and p.role='campo' and p.field_country=d->>'country' and d->>'fieldAccountId'=p.id::text and d->>'redigitType'='Campo')
$$;
revoke all on function pqr_private.field_can_read(jsonb) from public,anon;
grant execute on function pqr_private.field_can_read(jsonb) to authenticated;
create policy pqr_field_tickets_read on public.pqr_tickets for select to authenticated using(deleted_at is null and pqr_private.field_can_read(data));
create policy pqr_field_attachments_read on storage.objects for select to authenticated using(bucket_id='pqr-adjuntos' and exists(select 1 from public.pqr_tickets t where t.id::text=(storage.foldername(objects.name))[1] and t.deleted_at is null and pqr_private.field_can_read(t.data)));
create function pqr_private.send_field(ticket_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.pqr_profiles%rowtype; target public.pqr_profiles%rowtype; t public.pqr_tickets%rowtype; d jsonb;
begin
 select * into actor from pqr_private.current_actor();
 if actor.role is distinct from 'redigitador' then raise exception 'Solo Validación puede enviar a Campo'; end if;
 select * into t from public.pqr_tickets where id=ticket_id and deleted_at is null for update;
 if not found or t.status not in ('Pendiente de Redigitación','Devuelto') or t.data->>'requestType'='EDC' or t.code like 'EDC-%' then raise exception 'Solo redigitaciones pendientes pueden enviarse a Campo'; end if;
 select * into target from public.pqr_profiles where role='campo' and active and field_country=t.data->>'country';
 if not found then raise exception 'No hay cuenta de Campo activa para este país'; end if;
 d:=(t.data-'closedAt')||jsonb_build_object('fieldAccountId',target.id::text,'fieldCountry',target.field_country,'fieldRedigitatorName',target.name,'redigitType','Campo','redigitador',actor.id::text,'redigitatorPersonId',null,'redigitAssignedAt',now());
 d:=public.pqr_event(d,actor.name,'Enviada a Campo',target.name||' revisará y redigitará la auditoría.');
 update public.pqr_tickets set data=d,updated_at=now() where id=t.id;
 perform public.pqr_notice(target.id,t.id,'Redigitación asignada a Campo',t.code||' requiere redigitación.');
 return d;
end $$;
revoke all on function pqr_private.send_field(uuid) from public,anon,authenticated,service_role;
create function pqr_private.complete_field(ticket_id uuid,input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.pqr_profiles%rowtype; t public.pqr_tickets%rowtype; d jsonb; analyst uuid; audit text:=btrim(coalesce(input->>'audit','')); notes text:=btrim(coalesce(input->>'notes',''));
begin
 select * into actor from pqr_private.current_actor();
 if actor.role is distinct from 'campo' then raise exception 'Solo Campo puede confirmar esta redigitación'; end if;
 select * into t from public.pqr_tickets where id=ticket_id and deleted_at is null for update;
 if not found or not pqr_private.field_can_read(t.data) or t.status not in ('Pendiente de Redigitación','Devuelto') then raise exception 'Caso no disponible para esta cuenta de Campo'; end if;
 if audit !~ '^[0-9]{1,80}$' or length(notes) not between 5 and 12000 then raise exception 'Completa la nueva auditoría y el detalle de la redigitación'; end if;
 if exists(select 1 from public.pqr_tickets where id<>t.id and deleted_at is null and data->>'audit'=audit) then raise exception 'Ese número de auditoría ya existe'; end if;
 select id into analyst from public.pqr_profiles where id=nullif(t.data->>'validator','')::uuid and active and role in ('validador','universal');
 if analyst is null then select id into analyst from public.pqr_profiles where active and role='validador' order by created_at limit 1; end if;
 if analyst is null then raise exception 'No hay cuenta de Analistas activa'; end if;
 d:=(t.data-'closedAt')||jsonb_build_object('audit',audit,'redigitNotes',notes,'redigitAt',now(),'status','Pendiente de Verificación','validator',analyst::text,'fieldCompletedBy',actor.id::text);
 d:=public.pqr_event(d,actor.name,'Redigitación de Campo confirmada','Nueva auditoría: '||audit||'. '||notes);
 update public.pqr_tickets set data=d,status='Pendiente de Verificación',updated_at=now() where id=t.id;
 perform public.pqr_notice(analyst,t.id,'Aprobación final pendiente',t.code||' fue redigitada por '||actor.name);
 return d;
end $$;
revoke all on function pqr_private.complete_field(uuid,jsonb) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.pqr_action_legacy(p_action text, p_ticket uuid DEFAULT NULL::uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.pqr_profiles%rowtype;
  v_row public.pqr_tickets%rowtype;
  v_data jsonb;
  v_now timestamptz := now();
  v_id uuid;
  v_code text;
  v_person public.pqr_staff%rowtype;
  v_account uuid;
  v_result text;
  v_name text;
  v_detail text;
  v_audit text;
begin
  select * into v_actor from pqr_private.current_actor();
  if not found then raise exception 'Cuenta no autorizada'; end if;
  if p_action in ('create','direct_create') then
    if v_actor.role <> 'comercial' then raise exception 'Solo Comercial puede radicar'; end if;
    if coalesce(p_data->>'pdv','') !~ '^[0-9]+$' or length(p_data->>'pdv') > 80 then raise exception 'ID de PDV inválido'; end if;
    if length(trim(coalesce(p_data->>'client',''))) < 1 or length(trim(coalesce(p_data->>'country',''))) < 1
      or length(trim(coalesce(p_data->>'description',''))) < 8 then raise exception 'Datos incompletos'; end if;
    if p_action = 'direct_create' and coalesce(p_data->>'auditOriginal','') !~ '^[0-9]+$' then
      raise exception 'ID de auditoría inválido';
    end if;
    v_id := gen_random_uuid();
    v_code := 'PQR-' || extract(year from (v_now at time zone 'America/Bogota'))::int || '-' || lpad(nextval('public.pqr_code_seq')::text, 4, '0');
    v_result := case when p_action='direct_create' then 'Pendiente de Redigitación' else 'Radicado' end;
    v_data := jsonb_build_object('id',v_id::text,'code',v_code,'commercial',v_actor.id::text,
      'pdv',trim(p_data->>'pdv'),'client',trim(p_data->>'client'),'country',trim(p_data->>'country'),
      'description',trim(p_data->>'description'),'support',coalesce(p_data->>'support',''),
      'status',v_result,'createdAt',v_now,'timeline','[]'::jsonb,
      'directRedigitation',p_action='direct_create');
    if p_action='direct_create' then
      select id into v_account from public.pqr_profiles where role='redigitador' and active=true limit 1;
      if v_account is null then raise exception 'No hay cuenta de Redigitación activa'; end if;
      v_data := v_data || jsonb_build_object('auditOriginal',p_data->>'auditOriginal',
        'redigitador',v_account::text,'redigitRequestedAt',v_now);
    end if;
    v_data := public.pqr_event(v_data,v_actor.name,
      case when p_action='direct_create' then 'Redigitación directa solicitada' else 'PQR radicada' end,
      case when p_action='direct_create' then 'Auditoría actual: ' || (p_data->>'auditOriginal') else 'Caso creado por el comercial.' end);
    insert into public.pqr_tickets(id,code,commercial_id,status,created_at,updated_at,data)
    values(v_id,v_code,v_actor.id,v_result,v_now,v_now,v_data);
    if v_account is not null then perform public.pqr_notice(v_account,v_id,'Redigitación directa',v_code || ' requiere redigitación'); end if;
    return v_data;
  end if;

  select * into v_row from public.pqr_tickets where id=p_ticket for update;
  if not found then raise exception 'Caso no encontrado'; end if;
  if v_row.deleted_at is not null and p_action <> 'restore' then raise exception 'Caso eliminado'; end if;
  v_data := v_row.data;
  if p_action = 'assign_validator' then
    if v_actor.role <> 'validador' or ((v_data->>'directRedigitation')::boolean = true and v_row.status <> 'Pendiente de Verificación')
      or v_row.status not in ('Radicado','Reabierto','En Validación','Pendiente de Verificación') then raise exception 'Asignación no permitida'; end if;
    select * into v_person from public.pqr_staff where id=(p_data->>'personId')::uuid and role='validador' and active=true;
    if not found then raise exception 'Selecciona un analista activo'; end if;
    v_data := v_data || jsonb_build_object('validator',v_actor.id::text,'validatorPersonId',v_person.id::text,
      'assignedAt',case when v_row.status in ('Radicado','Reabierto') then v_now else coalesce((v_data->>'assignedAt')::timestamptz,v_now) end,
      'status',case when v_row.status='Pendiente de Verificación' then v_row.status else 'En Validación' end);
    v_data := public.pqr_event(v_data,v_actor.name,'Caso asignado a Analista de PQR',v_person.name || ' solucionará la PQR.');
    perform public.pqr_notice(v_row.commercial_id,v_row.id,'PQR en análisis',v_row.code || ' fue asignada a ' || v_person.name);
  elsif p_action = 'dictate' then
    if v_actor.role <> 'validador' or v_row.status not in ('En Validación','Reabierto') or nullif(v_data->>'validatorPersonId','') is null then raise exception 'Dictamen no permitido'; end if;

    -- PQR_MANUAL_INTAKE_V2
    if v_data->>'manualEntry'='true' then
      v_detail:=trim(coalesce(p_data->>'pdv',v_data->>'pdv',''));
      v_name:=trim(coalesce(p_data->>'description',v_data->>'description',''));
      if v_detail !~ '^[0-9]{1,80}$' then
        raise exception 'Completa el ID de PDV usando solo números antes de dictaminar';
      end if;
      if length(v_name) not between 8 and 12000 then
        raise exception 'Completa la descripción de la solicitud (entre 8 y 12000 caracteres) antes de dictaminar';
      end if;
      if v_detail is distinct from v_data->>'pdv' or v_name is distinct from v_data->>'description' then
        v_data:=public.pqr_event(v_data,v_actor.name,'Información de radicación completada',
          'ID de PDV: '||v_detail||'. Descripción: '||v_name);
        v_data:=v_data||jsonb_build_object('pdv',v_detail,'description',v_name,
          'intakeCompletedAt',v_now,'intakeCompletedBy',v_actor.id::text);
      end if;
    end if;
    v_result := p_data->>'decision';
    v_audit := trim(coalesce(p_data->>'auditOriginal',''));
    if v_result not in ('no','yes','redigit') or v_audit !~ '^[0-9]+$'
      or length(trim(coalesce(p_data->>'response',''))) < 5 then raise exception 'Dictamen incompleto'; end if;
    v_data := v_data || jsonb_build_object('auditOriginal',v_audit,'applies',case when v_result='no' then 'No Aplica' else 'Aplica' end,
      'tipology',coalesce(p_data->>'tipology',''),'area',coalesce(p_data->>'area',''),
      'response',trim(p_data->>'response'),'resolvedAt',v_now);
    if v_result='redigit' then
      select id into v_account from public.pqr_profiles where role='redigitador' and active=true limit 1;
      if v_account is null then raise exception 'No hay cuenta de Redigitación activa'; end if;
      v_data := v_data || jsonb_build_object('status','Pendiente de Redigitación','redigitador',v_account::text,'redigitRequestedAt',v_now);
      v_data := public.pqr_event(v_data,v_actor.name,'Aplica: requiere redigitación','ID de auditoría: ' || v_audit || '. ' || (p_data->>'response'));
      perform public.pqr_notice(v_account,v_row.id,'Redigitación requerida',v_row.code || ' espera asignación');
      perform public.pqr_notice(v_row.commercial_id,v_row.id,'PQR en redigitación',v_row.code || ' fue enviada a redigitación');
    else
      v_result := case when v_result='no' then 'No Aplica' else 'Cerrado' end;
      v_data := v_data || jsonb_build_object('status',v_result,'closedAt',v_now);
      v_data := public.pqr_event(v_data,v_actor.name,case when v_result='No Aplica' then 'No aplica: cierre justificado' else 'Aplica: cierre sin redigitación' end,'ID de auditoría: ' || v_audit || '. ' || (p_data->>'response'));
      perform public.pqr_notice(v_row.commercial_id,v_row.id,'PQR cerrada',v_row.code || ' fue cerrada');
    end if;
  elsif p_action = 'assign_redigit' then
    if v_actor.role <> 'redigitador' or v_row.status not in ('Pendiente de Redigitación','Devuelto') then raise exception 'Asignación no permitida'; end if;
    if p_data->>'redigitType'='Campo' then return pqr_private.send_field(p_ticket); end if;
    v_data:=v_data-'fieldAccountId'-'fieldCountry';
    v_result := p_data->>'redigitType';
    if v_result not in ('Campo','Validación') then raise exception 'Tipo de redigitación inválido'; end if;
    if v_result='Validación' then
      select * into v_person from public.pqr_staff where id=(p_data->>'personId')::uuid and role='redigitador' and active=true;
      if not found then raise exception 'Selecciona un redigitador activo'; end if;
      v_name := v_person.name;
    else
      v_name := trim(coalesce(p_data->>'fieldPerson',''));
      if length(v_name)<3 then raise exception 'Indica quién redigitará en Campo'; end if;
    end if;
    v_data := v_data || jsonb_build_object('redigitador',v_actor.id::text,'redigitType',v_result,
      'redigitatorPersonId',case when v_result='Validación' then to_jsonb(v_person.id::text) else 'null'::jsonb end,
      'fieldRedigitatorName',case when v_result='Campo' then to_jsonb(v_name) else 'null'::jsonb end,
      'redigitAssignedAt',v_now);
    v_data := public.pqr_event(v_data,v_actor.name,'Redigitación asignada',v_result || ': ' || v_name || ' gestionará la auditoría.');
  elsif p_action = 'redigit' then
    if v_actor.role <> 'redigitador' or v_row.status not in ('Pendiente de Redigitación','Devuelto')
      or (v_data->>'redigitatorPersonId' is null and v_data->>'fieldRedigitatorName' is null) then raise exception 'Redigitación no permitida'; end if;
    if nullif(v_data->>'fieldAccountId','') is not null then raise exception 'El caso está en Campo; reasígnalo a Validación antes de completarlo aquí'; end if;
    v_audit := trim(coalesce(p_data->>'audit',''));
    if v_audit !~ '^[0-9]+$' or length(trim(coalesce(p_data->>'notes',''))) < 5 then raise exception 'Datos de redigitación inválidos'; end if;
    if exists(select 1 from public.pqr_tickets where id<>v_row.id and data->>'audit'=v_audit and deleted_at is null) then raise exception 'Ese número de auditoría ya existe'; end if;
    v_result := 'Pendiente de Verificación';
    if nullif(v_data->>'validator','') is null then
      select id into v_account from public.pqr_profiles where role='validador' and active order by created_at limit 1;
      if v_account is null then raise exception 'No hay cuenta de Analistas activa'; end if;
      v_data:=v_data||jsonb_build_object('validator',v_account::text);
    end if;
    v_data:=v_data-'closedAt';
    v_name := coalesce(v_data->>'fieldRedigitatorName', (select name from public.pqr_staff where id=(v_data->>'redigitatorPersonId')::uuid),v_actor.name);
    v_data := v_data || jsonb_build_object('audit',v_audit,'redigitNotes',trim(p_data->>'notes'),'redigitAt',v_now,'status',v_result);
    if v_result='Cerrado' then v_data := v_data || jsonb_build_object('closedAt',v_now); end if;
    v_data := public.pqr_event(v_data,v_name,case when v_result='Cerrado' then 'Redigitación directa completada y cerrada' else 'Redigitación completada' end,'Nueva auditoría: ' || v_audit || '. ' || (p_data->>'notes'));
    perform public.pqr_notice(v_row.commercial_id,v_row.id,case when v_result='Cerrado' then 'Redigitación directa cerrada' else 'PQR redigitada' end,v_row.code || ': nueva auditoría ' || v_audit);
    if v_result<>'Cerrado' then perform public.pqr_notice((v_data->>'validator')::uuid,v_row.id,'Verificación pendiente',v_row.code || ' fue redigitada'); end if;
  elsif p_action = 'verify' then
    if v_actor.role <> 'validador' or v_row.status <> 'Pendiente de Verificación' or length(trim(coalesce(p_data->>'comment','')))<5 then raise exception 'Verificación no permitida'; end if;
    v_result := case when p_data->>'ok'='yes' then 'Cerrado' when p_data->>'ok'='no' then 'Devuelto' else null end;
    if v_result is null then raise exception 'Selecciona el resultado'; end if;
    v_data := v_data || jsonb_build_object('verifyComment',trim(p_data->>'comment'),'verifiedAt',v_now,'status',v_result);
    if v_result='Cerrado' then v_data := v_data || jsonb_build_object('closedAt',v_now);
    else v_data := v_data || jsonb_build_object('redigitRequestedAt',v_now); end if;
    v_data := public.pqr_event(v_data,v_actor.name,case when v_result='Cerrado' then 'Redigitación verificada y cierre definitivo' else 'Redigitación devuelta' end,p_data->>'comment');
    perform public.pqr_notice(v_row.commercial_id,v_row.id,case when v_result='Cerrado' then 'PQR cerrada definitivamente' else 'PQR en corrección' end,v_row.code || ': ' || v_result);
    perform public.pqr_notice((v_data->>'redigitador')::uuid,v_row.id,case when v_result='Cerrado' then 'Caso cerrado' else 'Redigitación devuelta' end,v_row.code || ': ' || v_result);
    if nullif(v_data->>'fieldAccountId','') is not null then perform public.pqr_notice((v_data->>'fieldAccountId')::uuid,v_row.id,'Resultado de revisión PQR',v_row.code||': '||v_result); end if;
  elsif p_action = 'reopen' then
    if v_actor.role <> 'validador' or v_row.status not in ('Cerrado','No Aplica') or length(trim(coalesce(p_data->>'reason','')))<5 then raise exception 'Reapertura no permitida'; end if;
    v_data := (v_data - 'closedAt') || jsonb_build_object('status','Reabierto','reopenedAt',v_now);
    v_data := public.pqr_event(v_data,v_actor.name,'PQR reabierta',p_data->>'reason');
    perform public.pqr_notice(v_row.commercial_id,v_row.id,'PQR reabierta',v_row.code || ' requiere nueva gestión');
  elsif p_action = 'feedback' then
    if v_actor.role <> 'comercial' or v_actor.id is distinct from v_row.commercial_id or v_row.status <> 'Cerrado' or v_data ? 'feedback' then raise exception 'Retroalimentación no permitida'; end if;
    v_data := v_data || jsonb_build_object('feedback',jsonb_build_object('ok',p_data->>'ok'='yes','comment',coalesce(p_data->>'comment',''),'at',v_now));
    v_data := public.pqr_event(v_data,v_actor.name,'Retroalimentación registrada',coalesce(p_data->>'comment',''));
  elsif p_action = 'delete' then
    if v_actor.role <> 'admin' then raise exception 'Solo Administración puede eliminar'; end if;
    update public.pqr_tickets set deleted_at=v_now,updated_at=v_now where id=v_row.id;
    return v_data;
  elsif p_action = 'restore' then
    if v_actor.role <> 'admin' or v_row.deleted_at is null then raise exception 'Restauración no permitida'; end if;
    update public.pqr_tickets set deleted_at=null,updated_at=v_now where id=v_row.id;
    return v_data;
  else
    raise exception 'Acción desconocida';
  end if;
  update public.pqr_tickets set data=v_data,status=v_data->>'status',updated_at=v_now where id=v_row.id;
  return v_data;
end $function$;

CREATE OR REPLACE FUNCTION public.pqr_action(p_action text, p_ticket uuid DEFAULT NULL::uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text;
begin
 if public.pqr_role() is null then raise exception 'Cuenta no autorizada'; end if;
 if p_ticket is not null then select code into v_code from public.pqr_tickets where id = p_ticket; end if;
 if p_action = 'field_complete' then return pqr_private.complete_field(p_ticket,p_data); end if;
 if p_action = 'edit_complete' then return public.pqr_complete_edit(p_ticket,case p_data->>'edited' when 'yes' then true when 'no' then false else null end,p_data->>'comment'); end if;
 if v_code like 'EDC-%' and p_action not in ('assign_redigit','feedback','delete','restore') then raise exception 'Esta edición se cierra desde Redigitación de Validación, sin nueva auditoría ni verificación'; end if;
 return public.pqr_action_legacy(p_action,p_ticket,p_data);
end $function$;

notify pgrst,'reload schema';
commit;

