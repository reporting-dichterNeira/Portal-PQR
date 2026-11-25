begin;
set local lock_timeout='5s';
create or replace function pqr_private.complete_field(ticket_id uuid,input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 d:=(t.data-'closedAt'-'fieldApprovedAt'-'fieldApprovedBy'-'fieldApprovedAudit')||jsonb_build_object('audit',audit,'redigitNotes',notes,'redigitAt',now(),'status','Pendiente de aprobación de Validación','validator',analyst::text,'fieldCompletedBy',actor.id::text);
 d:=public.pqr_event(d,actor.name,'Redigitación de Campo confirmada','Nueva auditoría: '||audit||'. '||notes);
 update public.pqr_tickets set data=d,status='Pendiente de aprobación de Validación',updated_at=now() where id=t.id;
 perform public.pqr_notice((t.data->>'redigitador')::uuid,t.id,'Revisión de Campo pendiente',t.code||' fue redigitada por '||actor.name||'; Validación debe aprobar antes del cierre PQR.');
 return d;
end $$;
revoke all on function pqr_private.complete_field(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function pqr_private.review_field(ticket_id uuid,input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.pqr_profiles%rowtype; t public.pqr_tickets%rowtype; d jsonb; result text; note text:=btrim(coalesce(input->>'comment','')); analyst uuid;
begin
 select * into actor from pqr_private.current_actor();
 if actor.role is distinct from 'redigitador' then raise exception 'Solo Validación puede aprobar el trabajo de Campo'; end if;
 select * into t from public.pqr_tickets where id=ticket_id and deleted_at is null for update;
 if not found or t.status<>'Pendiente de aprobación de Validación' or nullif(t.data->>'fieldAccountId','') is null then raise exception 'Caso no disponible para revisión de Validación'; end if;
 if input->>'ok' is null or input->>'ok' not in ('yes','no') or length(note) not between 5 and 12000 then raise exception 'Selecciona el resultado y escribe el comentario de revisión'; end if;
 result:=case when input->>'ok'='yes' then 'Pendiente de Verificación' else 'Devuelto' end;
 d:=(t.data-'closedAt'-'fieldApprovedAt'-'fieldApprovedBy'-'fieldApprovedAudit')||jsonb_build_object('status',result,'fieldReviewComment',note,'fieldReviewedAt',now(),'fieldReviewedBy',actor.id::text);
 if result='Pendiente de Verificación' then
  if coalesce(d->>'audit','') !~ '^[0-9]{1,80}$' then raise exception 'Falta la auditoría resultante de Campo'; end if;
  select id into analyst from public.pqr_profiles where id=nullif(d->>'validator','')::uuid and active and role in ('validador','universal');
  if analyst is null then select id into analyst from public.pqr_profiles where active and role='validador' order by created_at limit 1; end if;
  if analyst is null then raise exception 'No hay cuenta de Analistas activa'; end if;
  d:=d||jsonb_build_object('validator',analyst::text,'fieldApprovedAt',now(),'fieldApprovedBy',actor.id::text,'fieldApprovedAudit',d->>'audit');
  d:=public.pqr_event(d,actor.name,'Campo aprobado por Validación',note);
  perform public.pqr_notice(analyst,t.id,'Cierre final PQR pendiente',t.code||': Validación aprobó la redigitación de Campo.');
 else
  d:=d||jsonb_build_object('redigitRequestedAt',now());
  d:=public.pqr_event(d,actor.name,'Devuelta a Campo por Validación',note);
  perform public.pqr_notice((d->>'fieldAccountId')::uuid,t.id,'Corrección de Campo pendiente',t.code||': '||note);
 end if;
 update public.pqr_tickets set data=d,status=result,updated_at=now() where id=t.id;
 return d;
end $$;
revoke all on function pqr_private.review_field(uuid,jsonb) from public,anon,authenticated,service_role;
-- Preserve the existing action router and guard the core verification endpoint too.
do $$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.pqr_action(text,uuid,jsonb)'::regprocedure);
 anchor:=$a$if p_action = 'field_complete' then return pqr_private.complete_field(p_ticket,p_data); end if;$a$;
 if position(anchor in definition)=0 then raise exception 'Unexpected action router'; end if;
 definition:=replace(definition,anchor,anchor||$a$
 if p_action = 'field_review' then return pqr_private.review_field(p_ticket,p_data); end if;$a$);
 execute definition;
 definition:=pg_get_functiondef('public.pqr_action_legacy(text,uuid,jsonb)'::regprocedure);
 anchor:=$a$elsif p_action = 'verify' then$a$;
 if position(anchor in definition)=0 then raise exception 'Unexpected verification core'; end if;
 definition:=replace(definition,anchor,anchor||$a$
    if nullif(v_data->>'fieldAccountId','') is not null and
       (nullif(v_data->>'fieldApprovedAt','') is null or (v_data->>'fieldApprovedAudit') is distinct from (v_data->>'audit'))
    then raise exception 'Validación debe aprobar primero la redigitación de Campo'; end if;$a$);
 execute definition;
end $$;
-- Existing open Field responses also require the intermediate approval; preserve closed history.
update public.pqr_tickets set status='Pendiente de aprobación de Validación',
 data=public.pqr_event((data-'closedAt')||jsonb_build_object('status','Pendiente de aprobación de Validación'),'Sistema','Revisión de Campo pendiente','Se requiere aprobación de Validación antes del cierre por Analistas de PQR.'),updated_at=now()
where deleted_at is null and status='Pendiente de Verificación' and nullif(data->>'fieldAccountId','') is not null and nullif(data->>'fieldCompletedBy','') is not null and nullif(data->>'fieldApprovedAt','') is null;
notify pgrst,'reload schema';
commit;
