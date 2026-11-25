begin;
create or replace function public.pqr_reclassify(p_ticket uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.pqr_profiles%rowtype;t public.pqr_tickets%rowtype;target public.pqr_profiles%rowtype;person public.pqr_staff%rowtype;d jsonb;kind text:=p_data->>'requestType';destination text:=p_data->>'redigitType';reason text:=btrim(coalesce(p_data->>'reason',''));
begin
select * into actor from pqr_private.current_actor();
if actor.id is null or (actor.role<>'validador' and not exists(select 1 from public.pqr_profiles where id=auth.uid() and active and role='universal')) then raise exception 'Solo Analistas PQR y Universal pueden reclasificar' using errcode='42501';end if;
select * into t from public.pqr_tickets where id=p_ticket and deleted_at is null for update;
if not found or t.status in ('Cerrado','No Aplica') then raise exception 'Solo casos abiertos pueden reclasificarse';end if;
if kind not in ('EDC','RDG') or destination not in ('Validación','Campo') or length(reason) not between 5 and 12000 or (kind='EDC' and destination<>'Validación') then raise exception 'Completa clasificación, destino y motivo';end if;
if coalesce(t.data->>'auditOriginal','') !~ '^[0-9]{1,80}$' then raise exception 'Completa el ID de auditoría antes de reclasificar';end if;
if destination='Campo' then
select * into target from public.pqr_profiles where role='campo' and active and field_country=t.data->>'country';
else
select * into person from public.pqr_staff where id=nullif(p_data->>'personId','')::uuid and role='redigitador' and active;
select * into target from public.pqr_profiles where active and role='redigitador' order by created_at limit 1;
if person.id is null then raise exception 'Selecciona un redigitador activo';end if;
end if;
if target.id is null then raise exception 'No hay cuenta activa para el destino seleccionado';end if;
d:=(t.data-'fieldAccountId'-'fieldCountry'-'fieldRedigitatorName'-'redigitatorPersonId'-'fieldApprovedAt'-'fieldApprovedBy'-'fieldApprovedAudit'-'audit'-'redigitAt'-'closedAt'-'editCompleted'-'editComment')||jsonb_build_object('originalRequestType',coalesce(t.data->>'originalRequestType',t.data->>'requestType',case when t.code like 'EDC-%' then 'EDC' when t.code like 'RDG-%' then 'RDG' else 'PQR' end),'requestType',kind,'directRedigitation',kind='RDG','status','Pendiente de Redigitación','redigitType',destination,'redigitador',case when destination='Campo' then (select id::text from public.pqr_profiles where active and role='redigitador' order by created_at limit 1) else target.id::text end,'validator',actor.id::text,'redigitRequestedAt',now(),'redigitAssignedAt',now(),'reclassifiedBy',actor.id::text,'reclassifiedAt',now(),'reclassificationReason',reason);
if destination='Campo' then d:=d||jsonb_build_object('fieldAccountId',target.id::text,'fieldCountry',target.field_country,'fieldRedigitatorName',target.name);else d:=d||jsonb_build_object('redigitatorPersonId',person.id::text);end if;
d:=public.pqr_event(d,actor.name,'Clasificación corregida y enviada',coalesce(t.data->>'requestType',t.code)||' -> '||kind||' / '||destination||'. Motivo: '||reason);
update public.pqr_tickets set data=d,status='Pendiente de Redigitación',updated_at=now() where id=t.id;
perform public.pqr_notice(target.id,t.id,'Ticket reclasificado',t.code||' requiere '||kind||' de '||destination||'. '||reason);
return d;
end;$$;
revoke all on function public.pqr_reclassify(uuid,jsonb) from public,anon;
grant execute on function public.pqr_reclassify(uuid,jsonb) to authenticated;
create or replace function public.pqr_redigit_assign_batch(p_tickets uuid[],p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.pqr_profiles%rowtype;v_ticket_id uuid;n integer:=0;t record;
begin
select * into actor from pqr_private.current_actor();
if actor.role is distinct from 'redigitador' then raise exception 'Solo Redigitación puede asignar masivamente' using errcode='42501';end if;
if cardinality(p_tickets) is null or cardinality(p_tickets) not between 1 and 100 or (select count(distinct x) from unnest(p_tickets) x)<>cardinality(p_tickets) then raise exception 'Selecciona de 1 a 100 tickets distintos';end if;
for v_ticket_id in select x from unnest(p_tickets) x order by x loop
select * into t from public.pqr_tickets where pqr_tickets.id=v_ticket_id and deleted_at is null for update;
if not found or t.status not in ('Pendiente de Redigitación','Devuelto') then raise exception 'Un ticket seleccionado ya no permite asignación. Actualiza la bandeja.';end if;
perform public.pqr_action('assign_redigit',v_ticket_id,p_data);n:=n+1;
end loop;
return jsonb_build_object('assigned',n);
end;$$;
revoke all on function public.pqr_redigit_assign_batch(uuid[],jsonb) from public,anon;
grant execute on function public.pqr_redigit_assign_batch(uuid[],jsonb) to authenticated;
do $$declare s text;begin
select pg_get_functiondef('public.pqr_action(text,uuid,jsonb)'::regprocedure) into s;
s:=replace(s,'select code into v_code from public.pqr_tickets', $r$select case when data->>'requestType'='RDG' then 'RDG-reclassified' when data->>'requestType'='EDC' then 'EDC-current' else code end into v_code from public.pqr_tickets$r$);execute s;
select pg_get_functiondef('pqr_private.send_field(uuid)'::regprocedure) into s;
s:=replace(s,$n$or t.code like 'EDC-%'$n$,$r$or (t.code like 'EDC-%' and coalesce(t.data->>'requestType','EDC')<>'RDG')$r$);execute s;
end;$$;
notify pgrst,'reload schema';
commit;
