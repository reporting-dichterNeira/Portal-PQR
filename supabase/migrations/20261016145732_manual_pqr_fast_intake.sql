-- Manual intake may be incomplete; PDV and description are enforced at dictate.
-- Keep the existing roles, commercial intake, RDG/EDC and old recipient links.
begin;
create or replace function pqr_private.create_manual_pqr(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_actor public.pqr_profiles%rowtype;
 v_commercial public.pqr_profiles%rowtype;
 v_name text:=trim(coalesce(p_data->>'commercialName',''));
 v_commercial_id text:=nullif(trim(coalesce(p_data->>'commercialId','')),'');
 v_reference text:=trim(coalesce(p_data->>'externalTicketId',''));
 v_pdv text:=trim(coalesce(p_data->>'pdv',''));
 v_description text:=trim(coalesce(p_data->>'description',''));
 v_now timestamptz:=now();
 v_id uuid:=gen_random_uuid(); v_number text; v_code text; v_data jsonb;
 v_source text:=trim(coalesce(p_data->>'source','Correo'));
begin
 select * into v_actor from public.pqr_profiles where id=auth.uid() and active;
 if not found or v_actor.role not in ('validador','gerente') then
  raise exception 'Solo Analistas de PQR y Gerencia pueden radicar manualmente';
 end if;
 if length(v_reference)>100 then raise exception 'El ID de ticket admite máximo 100 caracteres'; end if;
 if length(v_name)>150 then raise exception 'El nombre del comercial admite máximo 150 caracteres'; end if;
 -- Compatibility only for an older, already-open form. A reference never links an account.
 if v_commercial_id is not null then
  if v_commercial_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
   raise exception 'Selecciona una cuenta de Comercial activa';
  end if;
  select * into v_commercial from public.pqr_profiles
   where id=v_commercial_id::uuid and role='comercial' and active for share;
  if not found then raise exception 'Selecciona una cuenta de Comercial activa'; end if;
  v_name:=v_commercial.name;
 end if;
 if v_pdv<>'' and (v_pdv !~ '^[0-9]+$' or length(v_pdv)>80) then
  raise exception 'ID de PDV inválido: escribe solo números';
 end if;
 if length(trim(coalesce(p_data->>'client',''))) not between 1 and 100 then
  raise exception 'Completa el estudio';
 end if;
 if length(v_description)>12000 then raise exception 'La descripción admite máximo 12000 caracteres'; end if;
 if coalesce(p_data->>'country','')<>all(array['Colombia','Guatemala','Honduras','El Salvador','Nicaragua','Panamá','Perú','Bolivia','Paraguay','Costa Rica','Ecuador','Chile','República Dominicana']) then
  raise exception 'Selecciona un país válido';
 end if;
 if v_source not in ('Correo','Teléfono','Otro') then raise exception 'Canal de recepción inválido'; end if;
 v_number:=nextval('public.pqr_code_seq')::text;
 v_code:='PQR-'||extract(year from (v_now at time zone 'America/Bogota'))::int
  ||'-'||lpad(v_number,greatest(4,length(v_number)),'0');
 v_data:=jsonb_build_object('id',v_id::text,'code',v_code,
  'externalTicketId',v_reference,'commercial',v_commercial.id::text,'commercialName',v_name,
  'pdv',v_pdv,'client',trim(p_data->>'client'),'country',p_data->>'country',
  'description',v_description,'support','','status','Radicado','requestType','PQR',
  'directRedigitation',false,'createdAt',v_now,'timeline','[]'::jsonb,
  'manualEntry',true,'source',v_source,'createdBy',v_actor.id::text,
  'createdByName',v_actor.name,'createdByRole',v_actor.role);
 v_data:=public.pqr_event(v_data,v_actor.name,'PQR radicada manualmente',
  'Ticket de origen: '||coalesce(nullif(v_reference,''),'No indicado')
  ||case when v_name<>'' then '. Comercial asociado: '||v_name else '' end
  ||'. Pendiente de asignación a Analistas de PQR. El ID de PDV y la descripción deben estar completos al dictaminar.');
 insert into public.pqr_tickets(id,code,commercial_id,status,created_at,updated_at,data)
  values(v_id,v_code,v_commercial.id,'Radicado',v_now,v_now,v_data);
 perform public.pqr_notice(v_commercial.id,v_id,'PQR radicada en tu nombre',
  v_code||' fue registrada por '||v_actor.name||' y seguirá el flujo normal');
 return v_data;
end $$;
revoke all on function pqr_private.create_manual_pqr(jsonb) from public, anon;
grant execute on function pqr_private.create_manual_pqr(jsonb) to authenticated;

-- Patch the existing, non-public core after its actor/status/assignment checks.
-- No additional write RPC or broad update policy is introduced.
do $patch$
declare
 definition text;
 anchor text:=$anchor$    v_result := p_data->>'decision';$anchor$;
 completion text:=$completion$
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
$completion$;
begin
 definition:=pg_get_functiondef('public.pqr_action_legacy(text,uuid,jsonb)'::regprocedure);
 if strpos(definition,'PQR_MANUAL_INTAKE_V2')=0 then
  if array_length(string_to_array(definition,anchor),1)<>2
   or strpos(definition,'Dictamen no permitido')=0 then
    raise exception 'No se encontró el núcleo de dictamen esperado; no se aplicaron cambios';
  end if;
  execute replace(definition,anchor,completion||anchor);
 end if;
end $patch$;
revoke all on function public.pqr_action_legacy(text,uuid,jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
