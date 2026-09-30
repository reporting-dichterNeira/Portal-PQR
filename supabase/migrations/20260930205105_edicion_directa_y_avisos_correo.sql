-- EDC termina en Redigitación de Validación. Los correos de aviso son
-- independientes de los identificadores técnicos usados para iniciar sesión.
begin;

create table public.pqr_contact_emails (
  profile_id uuid not null references public.pqr_profiles(id) on delete cascade,
  email text not null check (length(email) <= 254 and email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default now(),
  primary key (profile_id, email)
);
alter table public.pqr_contact_emails enable row level security;
revoke all on public.pqr_contact_emails from anon, authenticated;
grant select, insert, delete on public.pqr_contact_emails to authenticated;
create policy pqr_contact_emails_admin_select on public.pqr_contact_emails
  for select to authenticated using ((select public.pqr_role()) = 'admin');
create policy pqr_contact_emails_admin_insert on public.pqr_contact_emails
  for insert to authenticated with check ((select public.pqr_role()) = 'admin');
create policy pqr_contact_emails_admin_delete on public.pqr_contact_emails
  for delete to authenticated using ((select public.pqr_role()) = 'admin');

create table public.pqr_mail_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.pqr_tickets(id) on delete cascade,
  recipient_profile_id uuid not null references public.pqr_profiles(id) on delete cascade,
  event_type text not null check (event_type in ('new_pqr','new_redigit','closed')),
  status text not null default 'pending' check (status in ('pending','sending','sent')),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text
);
create index pqr_mail_events_pending_idx on public.pqr_mail_events (next_attempt_at, created_at)
  where status = 'pending';
create index pqr_mail_events_stale_idx on public.pqr_mail_events (locked_at)
  where status = 'sending';
alter table public.pqr_mail_events enable row level security;
revoke all on public.pqr_mail_events from anon, authenticated;
grant all on public.pqr_contact_emails, public.pqr_mail_events to service_role;

create function public.pqr_enqueue_mail_event()
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
    elsif new.status in ('Cerrado','No Aplica') and old.status not in ('Cerrado','No Aplica') then
      insert into public.pqr_mail_events(ticket_id,recipient_profile_id,event_type)
        values(new.id,new.commercial_id,'closed');
    end if;
  end if;
  return new;
end $$;
revoke all on function public.pqr_enqueue_mail_event() from public, anon, authenticated;
create trigger pqr_ticket_mail_event after insert or update of status on public.pqr_tickets
  for each row execute function public.pqr_enqueue_mail_event();

create function public.pqr_complete_edit(p_ticket uuid, p_edited boolean, p_comment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.pqr_profiles%rowtype;
  v_row public.pqr_tickets%rowtype;
  v_data jsonb;
  v_now timestamptz := now();
  v_person text;
begin
  select * into v_actor from public.pqr_profiles where id = auth.uid() and active = true;
  if not found or v_actor.role <> 'redigitador' then raise exception 'Solo Redigitación puede cerrar ediciones'; end if;
  select * into v_row from public.pqr_tickets where id = p_ticket for update;
  if not found or v_row.deleted_at is not null or v_row.code not like 'EDC-%'
    or v_row.status not in ('Pendiente de Redigitación','Pendiente de Verificación') then
    raise exception 'Edición no disponible';
  end if;
  v_data := v_row.data;
  if v_data->>'redigitador' is distinct from v_actor.id::text
    or v_data->>'redigitType' is distinct from 'Validación'
    or nullif(v_data->>'redigitatorPersonId','') is null then
    raise exception 'Asigna primero un redigitador de Validación';
  end if;
  if p_edited is null or length(btrim(coalesce(p_comment,''))) < 5 then
    raise exception 'Confirma si se editó y escribe un comentario de al menos 5 caracteres';
  end if;
  select name into v_person from public.pqr_staff
    where id = (v_data->>'redigitatorPersonId')::uuid and role = 'redigitador';
  v_data := v_data || jsonb_build_object(
    'editCompleted',p_edited,'editComment',btrim(p_comment),'editAt',v_now,
    'redigitAt',v_now,'closedAt',v_now,'status','Cerrado'
  );
  v_data := public.pqr_event(v_data,coalesce(v_person,v_actor.name),
    case when p_edited then 'Edición confirmada y cierre' else 'Edición no realizada y cierre' end,
    btrim(p_comment));
  update public.pqr_tickets set data = v_data, status = 'Cerrado', updated_at = v_now
    where id = v_row.id;
  perform public.pqr_notice(v_row.commercial_id,v_row.id,
    case when p_edited then 'Edición confirmada' else 'Edición no realizada' end,
    v_row.code || ' terminó su gestión. Revisa el comentario en el portal.');
  return v_data;
end $$;
revoke all on function public.pqr_complete_edit(uuid,boolean,text) from public, anon, authenticated;

-- La función anterior conserva el flujo PQR/RDG; el punto de entrada público
-- rechaza rutas EDC antiguas que pedirían auditoría nueva o verificación.
alter function public.pqr_action(text,uuid,jsonb) rename to pqr_action_legacy;
revoke all on function public.pqr_action_legacy(text,uuid,jsonb) from public, anon, authenticated;

create function public.pqr_action(p_action text, p_ticket uuid default null, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if public.pqr_role() is null then raise exception 'Cuenta no autorizada'; end if;
  if p_ticket is not null then
    select code into v_code from public.pqr_tickets where id = p_ticket;
  end if;
  if p_action = 'edit_complete' then
    return public.pqr_complete_edit(p_ticket,
      case p_data->>'edited' when 'yes' then true when 'no' then false else null end,
      p_data->>'comment');
  end if;
  if v_code like 'EDC-%' and p_action not in ('assign_redigit','feedback','delete','restore') then
    raise exception 'Esta edición se cierra desde Redigitación de Validación, sin nueva auditoría ni verificación';
  end if;
  return public.pqr_action_legacy(p_action,p_ticket,p_data);
end $$;
revoke all on function public.pqr_action(text,uuid,jsonb) from public, anon;
grant execute on function public.pqr_action(text,uuid,jsonb) to authenticated;

create or replace function public.pqr_create_special(p_kind text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.pqr_profiles%rowtype;
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_code text;
  v_data jsonb;
  v_redigitador uuid;
  v_pdv text := btrim(coalesce(p_data->>'pdv', ''));
  v_audit text := btrim(coalesce(p_data->>'auditOriginal', ''));
  v_client text := btrim(coalesce(p_data->>'client', ''));
  v_country text := btrim(coalesce(p_data->>'country', ''));
  v_description text := btrim(coalesce(p_data->>'description', ''));
begin
  select * into v_actor from public.pqr_profiles where id = auth.uid() and active = true;
  if not found or v_actor.role <> 'comercial' then raise exception 'Solo Comercial puede solicitar este trámite'; end if;
  if p_kind not in ('RDG', 'EDC') then raise exception 'Tipo de trámite inválido'; end if;
  if v_audit !~ '^[0-9]+$' or length(v_audit) > 80 then raise exception 'ID de auditoría inválido'; end if;
  if p_kind = 'RDG' and (v_pdv !~ '^[0-9]+$' or length(v_pdv) > 80) then raise exception 'ID de PDV inválido'; end if;
  if p_kind = 'EDC' and v_pdv <> '' and (v_pdv !~ '^[0-9]+$' or length(v_pdv) > 80) then raise exception 'ID de PDV inválido'; end if;
  if length(v_client) < 1 or length(v_client) > 100 or length(v_country) < 1 or length(v_country) > 100
    or length(v_description) < 8 or length(v_description) > 10000 then raise exception 'Datos incompletos o demasiado extensos'; end if;
  select id into v_redigitador from public.pqr_profiles
    where role = 'redigitador' and active = true order by created_at limit 1;
  if v_redigitador is null then raise exception 'No hay cuenta de Redigitación activa'; end if;
  v_code := p_kind || '-' || extract(year from (v_now at time zone 'America/Bogota'))::int || '-'
    || lpad(nextval('public.pqr_code_seq')::text, 4, '0');
  v_data := jsonb_build_object(
    'id',v_id::text,'code',v_code,'requestType',p_kind,
    'commercial',v_actor.id::text,'pdv',v_pdv,'client',v_client,
    'country',v_country,'description',v_description,'support','',
    'status','Pendiente de Redigitación','createdAt',v_now,
    'timeline','[]'::jsonb,'auditOriginal',v_audit,
    'redigitador',v_redigitador::text,'redigitRequestedAt',v_now,
    'directRedigitation',p_kind = 'RDG','editRequest',p_kind = 'EDC'
  );
  v_data := public.pqr_event(v_data,v_actor.name,
    case when p_kind = 'EDC' then 'Edición de auditoría solicitada' else 'Redigitación directa solicitada' end,
    'Auditoría actual: ' || v_audit || '. ' || v_description);
  insert into public.pqr_tickets(id,code,commercial_id,status,created_at,updated_at,data)
    values(v_id,v_code,v_actor.id,'Pendiente de Redigitación',v_now,v_now,v_data);
  perform public.pqr_notice(v_redigitador,v_id,
    case when p_kind = 'EDC' then 'Edición solicitada' else 'Redigitación directa' end,
    v_code || ' espera gestión en la bandeja de Redigitación');
  return v_data;
end $$;
revoke all on function public.pqr_create_special(text,jsonb) from public, anon;
grant execute on function public.pqr_create_special(text,jsonb) to authenticated;
commit;
