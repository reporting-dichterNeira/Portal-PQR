-- Solo para Portal PQR: nombre del comercial libre y opcional en PQR manuales.
-- Conserva destinatarios de registros existentes y la compatibilidad del formulario anterior.
begin;

alter table public.pqr_tickets alter column commercial_id drop not null;
alter table public.pqr_tickets add constraint pqr_manual_sin_cuenta_comercial
  check (commercial_id is not null or coalesce(
    data->>'manualEntry' = 'true' and data->>'requestType' = 'PQR'
    and nullif(data->>'createdBy', '') is not null, false));

create or replace function pqr_private.create_manual_pqr(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.pqr_profiles%rowtype;
  v_commercial public.pqr_profiles%rowtype;
  v_name text := trim(coalesce(p_data->>'commercialName', ''));
  v_commercial_id text := nullif(trim(coalesce(p_data->>'commercialId', '')), '');
  v_now timestamptz := now();
  v_id uuid := gen_random_uuid();
  v_number text;
  v_code text;
  v_data jsonb;
  v_source text := trim(coalesce(p_data->>'source', 'Correo'));
begin
  select * into v_actor from public.pqr_profiles where id = auth.uid() and active;
  if not found or v_actor.role not in ('validador', 'gerente') then
    raise exception 'Solo Analistas de PQR y Gerencia pueden radicar manualmente';
  end if;
  if length(v_name) > 150 then raise exception 'El nombre del comercial admite máximo 150 caracteres'; end if;
  -- Un nombre no asigna permisos a cuentas ni se interpreta como un destinatario.
  -- Solo la interfaz anterior envía un ID; conservar su asociación explícita durante el despliegue.
  if v_commercial_id is not null then
    if v_commercial_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'Selecciona una cuenta de Comercial activa';
    end if;
    select * into v_commercial from public.pqr_profiles
      where id = v_commercial_id::uuid and role = 'comercial' and active for share;
    if not found then raise exception 'Selecciona una cuenta de Comercial activa'; end if;
    v_name := v_commercial.name;
  end if;
  if coalesce(p_data->>'pdv', '') !~ '^[0-9]+$' or length(p_data->>'pdv') > 80 then
    raise exception 'ID de PDV inválido: escribe solo números';
  end if;
  if length(trim(coalesce(p_data->>'client', ''))) not between 1 and 100
    or length(trim(coalesce(p_data->>'description', ''))) not between 8 and 12000 then
    raise exception 'Completa el estudio y la descripción (mínimo 8 caracteres)';
  end if;
  if coalesce(p_data->>'country', '') <> all(array['Colombia','Guatemala','Honduras','El Salvador','Nicaragua','Panamá','Perú','Bolivia','Paraguay','Costa Rica','Ecuador','Chile','República Dominicana']) then
    raise exception 'Selecciona un país válido';
  end if;
  if v_source not in ('Correo', 'Teléfono', 'Otro') then raise exception 'Canal de recepción inválido'; end if;

  v_number := nextval('public.pqr_code_seq')::text;
  v_code := 'PQR-' || extract(year from (v_now at time zone 'America/Bogota'))::int
    || '-' || lpad(v_number, greatest(4, length(v_number)), '0');
  v_data := jsonb_build_object('id', v_id::text, 'code', v_code,
    'commercial', v_commercial.id::text, 'commercialName', v_name, 'pdv', p_data->>'pdv',
    'client', trim(p_data->>'client'), 'country', p_data->>'country',
    'description', trim(p_data->>'description'), 'support', '',
    'status', 'Radicado', 'requestType', 'PQR', 'directRedigitation', false,
    'createdAt', v_now, 'timeline', '[]'::jsonb,
    'manualEntry', true, 'source', v_source, 'createdBy', v_actor.id::text,
    'createdByName', v_actor.name, 'createdByRole', v_actor.role);
  v_data := public.pqr_event(v_data, v_actor.name, 'PQR radicada manualmente',
    'Recibida por ' || v_source || '. Comercial asociado: ' || coalesce(nullif(v_name, ''), 'No indicado')
    || '. Pendiente de asignación a Analistas de PQR.');
  insert into public.pqr_tickets(id, code, commercial_id, status, created_at, updated_at, data)
    values(v_id, v_code, v_commercial.id, 'Radicado', v_now, v_now, v_data);
  perform public.pqr_notice(v_commercial.id, v_id, 'PQR radicada en tu nombre',
    v_code || ' fue registrada por ' || v_actor.name || ' y seguirá el flujo normal');
  return v_data;
end $$;
revoke all on function pqr_private.create_manual_pqr(jsonb) from public, anon;
grant execute on function pqr_private.create_manual_pqr(jsonb) to authenticated;

-- Mantener la misma cola de avisos, sin intentar enviar a un destinatario inexistente.
create or replace function public.pqr_enqueue_mail_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op = 'INSERT' then
    if new.code like 'PQR-%' then
      select id into v_profile from public.pqr_profiles
        where role = 'validador' and active = true order by created_at limit 1;
      if v_profile is not null then
        insert into public.pqr_mail_events(ticket_id,recipient_profile_id,event_type)
          values(new.id,v_profile,'new_pqr');
        perform public.pqr_notice(v_profile,new.id,'Nueva PQR',new.code || ' espera asignación');
      end if;
    else
      select id into v_profile from public.pqr_profiles
        where role = 'redigitador' and active = true order by created_at limit 1;
      if v_profile is not null then
        insert into public.pqr_mail_events(ticket_id,recipient_profile_id,event_type)
          values(new.id,v_profile,'new_redigit');
      end if;
    end if;
  elsif new.status is distinct from old.status then
    if new.status in ('Pendiente de Redigitación','Devuelto') then
      select id into v_profile from public.pqr_profiles
        where role = 'redigitador' and active = true order by created_at limit 1;
      if v_profile is not null then
        insert into public.pqr_mail_events(ticket_id,recipient_profile_id,event_type)
          values(new.id,v_profile,'new_redigit');
      end if;
    elsif new.status in ('Cerrado','No Aplica') and old.status not in ('Cerrado','No Aplica')
      and new.commercial_id is not null then
      insert into public.pqr_mail_events(ticket_id,recipient_profile_id,event_type)
        values(new.id,new.commercial_id,'closed');
    end if;
  end if;
  return new;
end $$;
revoke all on function public.pqr_enqueue_mail_event() from public, anon, authenticated;

-- Comparación segura con NULL: ningún Comercial puede calificar una PQR sin cuenta asociada.
-- Parchear solo la comparación del núcleo existente y conservar todas sus demás reglas.
do $$
declare v_definition text;
begin
  v_definition := pg_get_functiondef('public.pqr_action_legacy(text,uuid,jsonb)'::regprocedure);
  if strpos(v_definition, 'v_actor.id <> v_row.commercial_id') = 0 then
    raise exception 'No se encontró la comprobación esperada de titularidad';
  end if;
  execute replace(v_definition, 'v_actor.id <> v_row.commercial_id',
    'v_actor.id is distinct from v_row.commercial_id');
end $$;
revoke all on function public.pqr_action_legacy(text,uuid,jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
