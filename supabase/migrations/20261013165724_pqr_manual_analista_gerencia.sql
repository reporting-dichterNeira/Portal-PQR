-- Portal PQR: radicación por Analistas y Gerencia en nombre de un Comercial.
-- No modifica las cuentas, tickets existentes ni las rutas RDG/EDC.
begin;

create schema if not exists pqr_private;
revoke all on schema pqr_private from public, anon;
grant usage on schema pqr_private to authenticated;

create or replace function pqr_private.create_manual_pqr(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.pqr_profiles%rowtype;
  v_commercial public.pqr_profiles%rowtype;
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
  if coalesce(p_data->>'commercialId', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Selecciona una cuenta de Comercial activa';
  end if;
  select * into v_commercial from public.pqr_profiles
    where id = (p_data->>'commercialId')::uuid and role = 'comercial' and active
    for share;
  if not found then raise exception 'Selecciona una cuenta de Comercial activa'; end if;
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
  if v_source not in ('Correo', 'Teléfono', 'Otro') then
    raise exception 'Canal de recepción inválido';
  end if;

  v_number := nextval('public.pqr_code_seq')::text;
  v_code := 'PQR-' || extract(year from (v_now at time zone 'America/Bogota'))::int
    || '-' || lpad(v_number, greatest(4, length(v_number)), '0');
  v_data := jsonb_build_object('id', v_id::text, 'code', v_code,
    'commercial', v_commercial.id::text, 'pdv', p_data->>'pdv',
    'client', trim(p_data->>'client'), 'country', p_data->>'country',
    'description', trim(p_data->>'description'), 'support', '',
    'status', 'Radicado', 'requestType', 'PQR', 'directRedigitation', false,
    'createdAt', v_now, 'timeline', '[]'::jsonb,
    'manualEntry', true, 'source', v_source, 'createdBy', v_actor.id::text,
    'createdByName', v_actor.name, 'createdByRole', v_actor.role);
  v_data := public.pqr_event(v_data, v_actor.name, 'PQR radicada manualmente',
    'Recibida por ' || v_source || '. Comercial asociado: ' || v_commercial.name
    || '. Pendiente de asignación a Analistas de PQR.');
  insert into public.pqr_tickets(id, code, commercial_id, status, created_at, updated_at, data)
    values(v_id, v_code, v_commercial.id, 'Radicado', v_now, v_now, v_data);
  -- El trigger vigente genera el aviso y correo de nueva PQR para Analistas.
  perform public.pqr_notice(v_commercial.id, v_id, 'PQR radicada en tu nombre',
    v_code || ' fue registrada por ' || v_actor.name || ' y seguirá el flujo normal');
  return v_data;
end $$;
revoke all on function pqr_private.create_manual_pqr(jsonb) from public, anon;
grant execute on function pqr_private.create_manual_pqr(jsonb) to authenticated;

-- La función privilegiada queda fuera del esquema expuesto por la Data API.
create or replace function public.pqr_create_manual(p_data jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select pqr_private.create_manual_pqr(p_data)
$$;
revoke all on function public.pqr_create_manual(jsonb) from public, anon;
grant execute on function public.pqr_create_manual(jsonb) to authenticated;

-- Comercial conserva sus permisos. El creador manual puede cargar/reintentar
-- adjuntos solo en sus propias PQR; no obtiene acceso de escritura a otros casos.
alter policy pqr_adjuntos_carga on storage.objects
with check (
  bucket_id = 'pqr-adjuntos'
  and array_length(storage.foldername(name), 1) = 1
  and exists (
    select 1 from public.pqr_tickets as ticket
    where ticket.id::text = (storage.foldername(name))[1]
      and ticket.deleted_at is null
      and (
        ((select public.pqr_role()) = 'comercial' and ticket.commercial_id = (select auth.uid()))
        or (
          (select public.pqr_role()) in ('validador', 'gerente')
          and ticket.data->>'manualEntry' = 'true'
          and ticket.data->>'requestType' = 'PQR'
          and ticket.data->>'createdBy' = (select auth.uid())::text
        )
      )
  )
);
notify pgrst, 'reload schema';
commit;
