-- Solicitudes comerciales diferenciadas: PQR, RDG (redigitación directa) y EDC (edición).
-- Conserva el UUID, secuencia e historial de los casos existentes.
begin;

do $$
begin
  if exists (
    select 1 from public.pqr_tickets old
    join public.pqr_tickets other on other.code = regexp_replace(old.code, '^PQR-', 'RDG-')
    where old.code like 'PQR-%' and old.data->>'directRedigitation' = 'true'
  ) then
    raise exception 'Hay radicados RDG existentes en conflicto; no se modificaron los casos';
  end if;
end $$;

update public.pqr_tickets
set code = regexp_replace(code, '^PQR-', 'RDG-'),
    data = jsonb_set(data || jsonb_build_object('requestType', 'RDG'), '{code}',
      to_jsonb(regexp_replace(code, '^PQR-', 'RDG-')), true),
    updated_at = now()
where code like 'PQR-%' and data->>'directRedigitation' = 'true';

create or replace function public.pqr_create_special(p_kind text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.pqr_profiles%rowtype;
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_code text;
  v_data jsonb;
  v_redigitador uuid;
  v_validador uuid;
  v_pdv text := trim(coalesce(p_data->>'pdv', ''));
  v_audit text := trim(coalesce(p_data->>'auditOriginal', ''));
  v_client text := trim(coalesce(p_data->>'client', ''));
  v_country text := trim(coalesce(p_data->>'country', ''));
  v_description text := trim(coalesce(p_data->>'description', ''));
begin
  select * into v_actor from public.pqr_profiles where id = auth.uid() and active = true;
  if not found or v_actor.role <> 'comercial' then raise exception 'Solo Comercial puede solicitar este trámite'; end if;
  if p_kind not in ('RDG', 'EDC') then raise exception 'Tipo de trámite inválido'; end if;
  if v_audit !~ '^[0-9]+$' or length(v_audit) > 80 then raise exception 'ID de auditoría inválido'; end if;
  if p_kind = 'RDG' and (v_pdv !~ '^[0-9]+$' or length(v_pdv) > 80) then raise exception 'ID de PDV inválido'; end if;
  if p_kind = 'EDC' and v_pdv <> '' and (v_pdv !~ '^[0-9]+$' or length(v_pdv) > 80) then raise exception 'ID de PDV inválido'; end if;
  if length(v_client) < 1 or length(v_client) > 100 or length(v_country) < 1 or length(v_country) > 100
    or length(v_description) < 8 or length(v_description) > 10000 then raise exception 'Datos incompletos o demasiado extensos'; end if;

  select id into v_redigitador from public.pqr_profiles where role = 'redigitador' and active = true order by created_at limit 1;
  if v_redigitador is null then raise exception 'No hay cuenta de Redigitación activa'; end if;
  if p_kind = 'EDC' then
    select id into v_validador from public.pqr_profiles where role = 'validador' and active = true order by created_at limit 1;
    if v_validador is null then raise exception 'No hay cuenta de Analistas de PQR activa'; end if;
  end if;

  v_code := p_kind || '-' || extract(year from (v_now at time zone 'America/Bogota'))::int || '-'
    || lpad(nextval('public.pqr_code_seq')::text, 4, '0');
  v_data := jsonb_build_object(
    'id', v_id::text, 'code', v_code, 'requestType', p_kind,
    'commercial', v_actor.id::text, 'pdv', v_pdv, 'client', v_client,
    'country', v_country, 'description', v_description, 'support', '',
    'status', 'Pendiente de Redigitación', 'createdAt', v_now,
    'timeline', '[]'::jsonb, 'auditOriginal', v_audit,
    'redigitador', v_redigitador::text, 'redigitRequestedAt', v_now,
    'directRedigitation', p_kind = 'RDG'
  );
  if p_kind = 'EDC' then
    v_data := v_data || jsonb_build_object('validator', v_validador::text, 'editRequest', true);
  end if;
  v_data := public.pqr_event(v_data, v_actor.name,
    case when p_kind = 'EDC' then 'Edición de auditoría solicitada' else 'Redigitación directa solicitada' end,
    'Auditoría actual: ' || v_audit || '. ' || v_description);
  insert into public.pqr_tickets(id, code, commercial_id, status, created_at, updated_at, data)
  values(v_id, v_code, v_actor.id, 'Pendiente de Redigitación', v_now, v_now, v_data);
  perform public.pqr_notice(v_redigitador, v_id,
    case when p_kind = 'EDC' then 'Edición solicitada' else 'Redigitación directa' end,
    v_code || ' espera gestión en la bandeja de Redigitación');
  if v_validador is not null then
    perform public.pqr_notice(v_validador, v_id, 'Nueva edición de auditoría',
      v_code || ' requiere respuesta final de Analistas de PQR');
  end if;
  return v_data;
end $$;

revoke all on function public.pqr_create_special(text,jsonb) from public, anon;
grant execute on function public.pqr_create_special(text,jsonb) to authenticated;

commit;
