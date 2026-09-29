-- Portal PQR: instalación inicial, sin cuentas ni casos de demostración.
-- Ejecutar únicamente en el proyecto Portal PQR (niwkegxwwwoahcbsoujy).
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pqr_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  name text not null check (length(trim(name)) > 0),
  role text not null check (role in ('admin','gerente','validador','redigitador','comercial')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.pqr_staff (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('validador','redigitador')),
  name text not null check (length(trim(name)) > 0),
  active boolean not null default true,
  unique (role, name)
);
create table if not exists public.pqr_tips (
  name text primary key check (length(trim(name)) > 0)
);
create sequence if not exists public.pqr_code_seq;
create table if not exists public.pqr_tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  commercial_id uuid not null references public.pqr_profiles(id),
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);
create index if not exists pqr_tickets_commercial_idx on public.pqr_tickets (commercial_id, created_at desc);
create index if not exists pqr_tickets_status_idx on public.pqr_tickets (status, created_at desc) where deleted_at is null;
create table if not exists public.pqr_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.pqr_profiles(id) on delete cascade,
  ticket_id uuid references public.pqr_tickets(id) on delete cascade,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read boolean not null default false
);
create index if not exists pqr_notifications_user_idx on public.pqr_notifications (user_id, created_at desc);

alter table public.pqr_profiles enable row level security;
alter table public.pqr_staff enable row level security;
alter table public.pqr_tips enable row level security;
alter table public.pqr_tickets enable row level security;
alter table public.pqr_notifications enable row level security;

revoke all on public.pqr_profiles, public.pqr_staff, public.pqr_tips, public.pqr_tickets, public.pqr_notifications from anon, authenticated;
grant select on public.pqr_profiles, public.pqr_staff, public.pqr_tips, public.pqr_tickets, public.pqr_notifications to authenticated;
grant update (read) on public.pqr_notifications to authenticated;

create or replace function public.pqr_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.pqr_profiles where id = (select auth.uid()) and active = true
$$;
revoke all on function public.pqr_role() from public, anon;
grant execute on function public.pqr_role() to authenticated;

create policy pqr_profiles_read on public.pqr_profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.pqr_role()) in ('admin','gerente','validador','redigitador'));
create policy pqr_staff_read on public.pqr_staff for select to authenticated
  using ((select public.pqr_role()) is not null);
create policy pqr_tips_read on public.pqr_tips for select to authenticated
  using ((select public.pqr_role()) is not null);
create policy pqr_tickets_read on public.pqr_tickets for select to authenticated
  using ((select public.pqr_role()) = 'admin' or
    (deleted_at is null and ((select public.pqr_role()) in ('gerente','validador','redigitador') or commercial_id = (select auth.uid()))));
create policy pqr_notifications_read on public.pqr_notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select public.pqr_role()) is not null);
create policy pqr_notifications_update on public.pqr_notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select public.pqr_role()) is not null)
  with check (user_id = (select auth.uid()));

create or replace function public.pqr_event(p_ticket jsonb, p_actor text, p_action text, p_detail text default '')
returns jsonb language sql set search_path = '' as $$
  select jsonb_set(p_ticket, '{timeline}',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'at', now(),
      'actor', p_actor, 'action', p_action, 'detail', coalesce(p_detail,''))) ||
    coalesce(p_ticket->'timeline','[]'::jsonb), true)
$$;
revoke all on function public.pqr_event(jsonb,text,text,text) from public, anon, authenticated;

create or replace function public.pqr_notice(p_user uuid, p_ticket uuid, p_title text, p_message text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_user is not null then
    insert into public.pqr_notifications(user_id,ticket_id,title,message)
    values (p_user,p_ticket,p_title,p_message);
  end if;
end $$;
revoke all on function public.pqr_notice(uuid,uuid,text,text) from public, anon, authenticated;

create or replace function public.pqr_action(p_action text, p_ticket uuid default null, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  select * into v_actor from public.pqr_profiles where id = auth.uid() and active = true;
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
    if v_actor.role <> 'validador' or (v_data->>'directRedigitation')::boolean = true
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
    v_audit := trim(coalesce(p_data->>'audit',''));
    if v_audit !~ '^[0-9]+$' or length(trim(coalesce(p_data->>'notes',''))) < 5 then raise exception 'Datos de redigitación inválidos'; end if;
    if exists(select 1 from public.pqr_tickets where id<>v_row.id and data->>'audit'=v_audit and deleted_at is null) then raise exception 'Ese número de auditoría ya existe'; end if;
    v_result := case when (v_data->>'directRedigitation')::boolean=true then 'Cerrado' else 'Pendiente de Verificación' end;
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
  elsif p_action = 'reopen' then
    if v_actor.role <> 'validador' or v_row.status not in ('Cerrado','No Aplica') or length(trim(coalesce(p_data->>'reason','')))<5 then raise exception 'Reapertura no permitida'; end if;
    v_data := (v_data - 'closedAt') || jsonb_build_object('status','Reabierto','reopenedAt',v_now);
    v_data := public.pqr_event(v_data,v_actor.name,'PQR reabierta',p_data->>'reason');
    perform public.pqr_notice(v_row.commercial_id,v_row.id,'PQR reabierta',v_row.code || ' requiere nueva gestión');
  elsif p_action = 'feedback' then
    if v_actor.role <> 'comercial' or v_actor.id <> v_row.commercial_id or v_row.status <> 'Cerrado' or v_data ? 'feedback' then raise exception 'Retroalimentación no permitida'; end if;
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
end $$;
revoke all on function public.pqr_action(text,uuid,jsonb) from public, anon;
grant execute on function public.pqr_action(text,uuid,jsonb) to authenticated;

create or replace function public.pqr_admin_staff(p_id uuid, p_role text, p_name text, p_active boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.pqr_role()<>'admin' then raise exception 'Solo Administración'; end if;
  if p_role not in ('validador','redigitador') or length(trim(coalesce(p_name,'')))<3 then raise exception 'Datos inválidos'; end if;
  if p_id is null then insert into public.pqr_staff(role,name,active) values(p_role,trim(p_name),p_active);
  else update public.pqr_staff set name=trim(p_name),active=p_active where id=p_id and role=p_role;
  end if;
end $$;
revoke all on function public.pqr_admin_staff(uuid,text,text,boolean) from public, anon;
grant execute on function public.pqr_admin_staff(uuid,text,text,boolean) to authenticated;

create or replace function public.pqr_admin_tip(p_name text, p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.pqr_role()<>'admin' then raise exception 'Solo Administración'; end if;
  if length(trim(coalesce(p_name,'')))<3 then raise exception 'Tipología inválida'; end if;
  if p_delete then delete from public.pqr_tips where name=p_name;
  else insert into public.pqr_tips(name) values(trim(p_name)) on conflict do nothing;
  end if;
end $$;
revoke all on function public.pqr_admin_tip(text,boolean) from public, anon;
grant execute on function public.pqr_admin_tip(text,boolean) to authenticated;

insert into public.pqr_tips(name) values
 ('Facturación y Cartera'),('Logística y Despacho'),('Calidad de Producto / Servicio'),
 ('Condiciones Comerciales'),('Error en Sistema / PDV') on conflict do nothing;
