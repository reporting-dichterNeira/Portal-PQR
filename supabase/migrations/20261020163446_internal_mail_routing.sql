-- Phase 1: backwards-compatible outbox support. Deploy this phase before the worker.
begin;
set local lock_timeout='5s';
alter table public.pqr_mail_events add column if not exists recipient_email text;
alter table public.pqr_mail_events alter column recipient_profile_id drop not null;
alter table public.pqr_mail_events drop constraint if exists pqr_mail_events_status_check;
alter table public.pqr_mail_events add constraint pqr_mail_events_status_check check(status in ('pending','sending','sent','cancelled'));
-- Retain the old client outbox for audit; never deliver it automatically.
update public.pqr_mail_events e set status='cancelled',locked_at=null,last_error='Avisos de clientes desactivados por configuración'
 from public.pqr_tickets t where t.id=e.ticket_id and coalesce(t.data->>'scope','external')<>'internal' and e.status in ('pending','sending');
alter table public.pqr_mail_events drop constraint if exists pqr_mail_events_event_type_check;
alter table public.pqr_mail_events add constraint pqr_mail_events_event_type_check
 check(event_type in ('new_pqr','new_redigit','received','closed'));
alter table public.pqr_mail_events drop constraint if exists pqr_mail_events_recipient_check;
alter table public.pqr_mail_events add constraint pqr_mail_events_recipient_check check(
 (recipient_profile_id is not null and recipient_email is null)
 or (recipient_profile_id is null and recipient_email is not null and length(recipient_email) between 3 and 254
  and recipient_email=lower(btrim(recipient_email)) and recipient_email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'));

-- Addresses are configured privately, not embedded in frontend assets or the public repository.
create table if not exists pqr_private.internal_mail_routes (
 route_key text not null check(route_key in ('pqr','redigit')),
 email text not null check(length(email)<=254 and email=lower(btrim(email)) and email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
 primary key(route_key,email)
);
alter table pqr_private.internal_mail_routes enable row level security;
revoke all on pqr_private.internal_mail_routes from public,anon,authenticated;
-- No new access to outbox, ticket contents, or attachments.
revoke all on public.pqr_mail_events from public,anon,authenticated;
-- Service-only, event-bound projection. No general ticket-table grant is needed.
create or replace function pqr_private.mail_ticket(p_event uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('code',t.code,'status',t.status,'deleted_at',t.deleted_at,
  'data',jsonb_build_object('scope','internal','editCompleted',t.data->'editCompleted'))
 from public.pqr_mail_events e join public.pqr_tickets t on t.id=e.ticket_id
 where e.id=p_event and t.data->>'scope'='internal'
$$;
revoke all on function pqr_private.mail_ticket(uuid) from public,anon,authenticated;
grant usage on schema pqr_private to service_role;
grant execute on function pqr_private.mail_ticket(uuid) to service_role;
create or replace function public.pqr_mail_ticket(p_event uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select pqr_private.mail_ticket(p_event)
$$;
revoke all on function public.pqr_mail_ticket(uuid) from public,anon,authenticated;
grant execute on function public.pqr_mail_ticket(uuid) to service_role;
commit;

-- Phase 2: activate only after deploying the compatible pqr-mailer and configuring routes.
begin;
set local lock_timeout='5s';
do $$ begin
 assert exists(select 1 from pqr_private.internal_mail_routes where route_key='pqr'),'Configure PQR mail routes first';
 assert exists(select 1 from pqr_private.internal_mail_routes where route_key='redigit'),'Configure redigit mail routes first';
end $$;
create or replace function public.pqr_enqueue_mail_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_profile uuid; v_kind text; v_group text; v_event text; v_email text;
begin
 if new.deleted_at is not null then return new; end if;
 if new.data->>'scope'='internal' then
  v_kind:=coalesce(new.data->>'requestType',split_part(new.code,'-',1));
  v_email:=lower(btrim(coalesce(new.data->>'requesterEmail','')));
  if tg_op='INSERT' then
   v_group:=case when v_kind='PQR' then 'pqr' else 'redigit' end;
   v_event:=case when v_kind='PQR' then 'new_pqr' else 'new_redigit' end;
   insert into public.pqr_mail_events(ticket_id,recipient_email,event_type)
    select new.id,email,v_event from pqr_private.internal_mail_routes where route_key=v_group;
   if v_email<>'' then
    insert into public.pqr_mail_events(ticket_id,recipient_email,event_type) values(new.id,v_email,'received');
   end if;
   -- Preserve the existing in-app analyst notification.
   if v_kind='PQR' then
    select id into v_profile from public.pqr_profiles where role='validador' and active order by created_at limit 1;
    if v_profile is not null then perform public.pqr_notice(v_profile,new.id,'Nueva PQR',new.code||' espera asignación'); end if;
   end if;
  elsif new.status is distinct from old.status then
   if new.status in ('Pendiente de Redigitación','Devuelto') then
    insert into public.pqr_mail_events(ticket_id,recipient_email,event_type)
     select new.id,email,'new_redigit' from pqr_private.internal_mail_routes where route_key='redigit';
   elsif new.status in ('Cerrado','No Aplica') and old.status not in ('Cerrado','No Aplica') and v_email<>'' then
    insert into public.pqr_mail_events(ticket_id,recipient_email,event_type) values(new.id,v_email,'closed');
   end if;
  end if;
  return new;
 end if;
 -- Client email flow is disabled. Preserve only its existing in-app PQR notice.
 if tg_op='INSERT' then
  if new.code like 'PQR-%' then
   select id into v_profile from public.pqr_profiles where role='validador' and active order by created_at limit 1;
   if v_profile is not null then
    perform public.pqr_notice(v_profile,new.id,'Nueva PQR',new.code||' espera asignación');
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.pqr_enqueue_mail_event() from public,anon,authenticated;
commit;
