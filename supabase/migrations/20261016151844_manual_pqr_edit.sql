-- Scoped intake correction only. Never mutate audit sources or workflow fields.
begin;
create or replace function pqr_private.edit_manual_pqr(p_ticket uuid, p_expected_updated_at timestamptz, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_actor public.pqr_profiles%rowtype;
 v_row public.pqr_tickets%rowtype;
 v_patch jsonb:='{}'::jsonb; v_changes jsonb:='{}'::jsonb; v_data jsonb;
 v_key text; v_value text; v_reason text:=trim(coalesce(p_data->>'reason',''));
 v_now timestamptz:=clock_timestamp();
begin
 select * into v_actor from public.pqr_profiles where id=auth.uid() and active;
 if not found or v_actor.role not in ('validador','gerente') then raise exception 'No tienes permiso para corregir esta radicación'; end if;
 select * into v_row from public.pqr_tickets where id=p_ticket and deleted_at is null for update;
 if not found then raise exception 'Solicitud no disponible'; end if;
 if v_row.data->>'manualEntry' is distinct from 'true' or v_row.data->>'requestType' is distinct from 'PQR'
  or (v_actor.role='gerente' and v_row.data->>'createdBy' is distinct from v_actor.id::text) then
  raise exception 'Solo puedes corregir PQR manuales autorizadas';
 end if;
 if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
  raise exception 'La solicitud cambió mientras la editabas. Recarga la página y revisa los datos antes de guardar';
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Datos de corrección inválidos'; end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k<>all(array['externalTicketId','pdv','client','country','description','reason'])) then
  raise exception 'La corrección solo admite datos de radicación';
 end if;
 if length(v_reason) not between 5 and 1000 then raise exception 'Indica el motivo de la corrección (5 a 1000 caracteres)'; end if;
 foreach v_key in array array['externalTicketId','pdv','client','country','description'] loop
  v_value:=trim(coalesce(case when p_data ? v_key then p_data->>v_key else v_row.data->>v_key end,''));
  v_patch:=v_patch||jsonb_build_object(v_key,v_value);
  if v_value is distinct from coalesce(v_row.data->>v_key,'') then
   v_changes:=v_changes||jsonb_build_object(v_key,jsonb_build_object('antes',v_row.data->>v_key,'después',v_value));
  end if;
 end loop;
 if length(v_patch->>'externalTicketId')>100 then raise exception 'El ID de ticket admite máximo 100 caracteres'; end if;
 if v_patch->>'pdv'<>'' and v_patch->>'pdv' !~ '^[0-9]{1,80}$' then raise exception 'ID de PDV inválido: escribe solo números'; end if;
 if length(v_patch->>'client') not between 1 and 100 then raise exception 'Completa el estudio'; end if;
 if v_patch->>'country'<>all(array['Colombia','Guatemala','Honduras','El Salvador','Nicaragua','Panamá','Perú','Bolivia','Paraguay','Costa Rica','Ecuador','Chile','República Dominicana']) then raise exception 'Selecciona un país válido'; end if;
 if length(v_patch->>'description')>12000 then raise exception 'La descripción admite máximo 12000 caracteres'; end if;
 -- Once dictated (including reopened cases), required intake may not be removed.
 if nullif(v_row.data->>'resolvedAt','') is not null or nullif(v_row.data->>'applies','') is not null
  or v_row.status in ('Cerrado','No Aplica','Pendiente de Redigitación','Pendiente de Verificación','Devuelto') then
  if v_patch->>'pdv' !~ '^[0-9]{1,80}$' or length(v_patch->>'description')<8 then
   raise exception 'Una PQR dictaminada debe conservar ID de PDV y descripción completos';
  end if;
 end if;
 if v_changes='{}'::jsonb then return v_row.data; end if;
 v_data:=public.pqr_event(v_row.data||v_patch,v_actor.name,'Radicación manual corregida',v_reason||'. Cambios: '||v_changes::text);
 v_data:=v_data||jsonb_build_object('intakeCorrectedAt',v_now,'intakeCorrectedBy',v_actor.id::text);
 update public.pqr_tickets set data=v_data,updated_at=v_now where id=v_row.id;
 return v_data;
end $$;
revoke all on function pqr_private.edit_manual_pqr(uuid,timestamptz,jsonb) from public,anon;
grant execute on function pqr_private.edit_manual_pqr(uuid,timestamptz,jsonb) to authenticated;
create or replace function public.pqr_edit_manual(p_ticket uuid,p_expected_updated_at timestamptz,p_data jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
 select pqr_private.edit_manual_pqr(p_ticket,p_expected_updated_at,p_data);
$$;
revoke all on function public.pqr_edit_manual(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.pqr_edit_manual(uuid,timestamptz,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
