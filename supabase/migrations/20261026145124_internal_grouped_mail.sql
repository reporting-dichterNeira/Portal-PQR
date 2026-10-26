-- Pause the existing mailer cron and drain in-flight work before applying/deploying.
-- Original recipient events remain for audit. No historical messages are replayed here.
begin;
set local lock_timeout = '5s';

create function pqr_private.mail_addresses_valid(p_addresses text[])
returns boolean language sql immutable parallel safe security invoker set search_path = '' as $$
 select p_addresses is not null and coalesce(array_ndims(p_addresses),1)=1
  and cardinality(p_addresses)<=20 and not exists (
   select 1 from unnest(p_addresses) a
   where a is null or length(a)>254 or a<>lower(btrim(a))
    or a !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'
  )
$$;
revoke all on function pqr_private.mail_addresses_valid(text[]) from public,anon,authenticated;
grant execute on function pqr_private.mail_addresses_valid(text[]) to service_role;

alter table public.pqr_mail_events
 add column recipient_emails text[],
 add column cc_emails text[] not null default '{}',
 add column replay_key text;
alter table public.pqr_mail_events add constraint pqr_mail_group_recipients_check check (
 (recipient_emails is null or (
  event_type in ('new_pqr','new_redigit') and recipient_profile_id is null
  and cardinality(recipient_emails) between 1 and 15
  and pqr_private.mail_addresses_valid(recipient_emails)
  and recipient_email=recipient_emails[1]
 )) and pqr_private.mail_addresses_valid(cc_emails) and cardinality(cc_emails)<=5
 and (cardinality(cc_emails)=0 or recipient_emails is not null)
);
alter table public.pqr_mail_events add constraint pqr_mail_replay_key_check
 check(replay_key is null or replay_key ~ '^[a-z0-9-]{1,80}$');
create unique index pqr_mail_replay_once_idx on public.pqr_mail_events(ticket_id,event_type,replay_key)
 where replay_key is not null;

create table pqr_private.internal_mail_copies (
 email text primary key check(pqr_private.mail_addresses_valid(array[email]))
);
alter table pqr_private.internal_mail_copies enable row level security;
create policy internal_mail_copies_deny_direct on pqr_private.internal_mail_copies
 for all to public using(false) with check(false);
revoke all on pqr_private.internal_mail_copies from public,anon,authenticated,service_role;

-- Invoker helper: used only by the existing privileged trigger and DBA maintenance.
-- Configured addresses never enter frontend assets or source control.
create function pqr_private.enqueue_team_mail(p_ticket uuid,p_type text,p_replay_key text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare recipients text[]; copies text[]; event_id uuid;
begin
 if p_type not in ('new_pqr','new_redigit') then raise exception 'Invalid team event'; end if;
 if not exists(select 1 from public.pqr_tickets t where t.id=p_ticket
   and t.data->>'scope'='internal' and t.deleted_at is null) then return null; end if;
 select array_agg(email order by email) into recipients from pqr_private.internal_mail_routes
  where route_key=case when p_type='new_pqr' then 'pqr' else 'redigit' end;
 if coalesce(cardinality(recipients),0)=0 then raise exception 'Missing internal mail route'; end if;
 select coalesce(array_agg(email order by email),'{}'::text[]) into copies from pqr_private.internal_mail_copies;
 insert into public.pqr_mail_events(ticket_id,recipient_email,recipient_emails,cc_emails,event_type,replay_key)
  values(p_ticket,recipients[1],recipients,copies,p_type,p_replay_key)
  on conflict(ticket_id,event_type,replay_key) where replay_key is not null do nothing
  returning id into event_id;
 return event_id;
end $$;
revoke all on function pqr_private.enqueue_team_mail(uuid,text,text) from public,anon,authenticated,service_role;

create or replace function public.pqr_enqueue_mail_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_profile uuid; v_kind text; v_email text;
begin
 if new.deleted_at is not null then return new; end if;
 if new.data->>'scope'='internal' then
  v_kind:=coalesce(new.data->>'requestType',split_part(new.code,'-',1));
  v_email:=lower(btrim(coalesce(new.data->>'requesterEmail','')));
  if tg_op='INSERT' then
   perform pqr_private.enqueue_team_mail(new.id,case when v_kind='PQR' then 'new_pqr' else 'new_redigit' end);
   if v_email<>'' then
    insert into public.pqr_mail_events(ticket_id,recipient_email,event_type) values(new.id,v_email,'received');
   end if;
   if v_kind='PQR' then
    select id into v_profile from public.pqr_profiles where role='validador' and active order by created_at limit 1;
    if v_profile is not null then perform public.pqr_notice(v_profile,new.id,'Nueva PQR',new.code||' espera asignación'); end if;
   end if;
  elsif new.status is distinct from old.status then
   if new.status in ('Pendiente de Redigitación','Devuelto') then
    perform pqr_private.enqueue_team_mail(new.id,'new_redigit');
   elsif new.status in ('Cerrado','No Aplica') and old.status not in ('Cerrado','No Aplica') and v_email<>'' then
    insert into public.pqr_mail_events(ticket_id,recipient_email,event_type) values(new.id,v_email,'closed');
   end if;
  end if;
  return new;
 end if;
 -- Client email remains disabled; retain only its existing in-app notice.
 if tg_op='INSERT' and new.code like 'PQR-%' then
  select id into v_profile from public.pqr_profiles where role='validador' and active order by created_at limit 1;
  if v_profile is not null then perform public.pqr_notice(v_profile,new.id,'Nueva PQR',new.code||' espera asignación'); end if;
 end if;
 return new;
end $$;
revoke all on function public.pqr_enqueue_mail_event() from public,anon,authenticated;

-- Consolidate only unsent, direct-recipient team rows, retaining cancelled originals.
do $$
declare g record;
begin
 for g in select e.ticket_id,e.event_type,e.created_at,array_agg(e.id) ids
  from public.pqr_mail_events e join public.pqr_tickets t on t.id=e.ticket_id
  where e.status='pending' and e.recipient_profile_id is null and e.recipient_emails is null
   and e.event_type in ('new_pqr','new_redigit') and t.data->>'scope'='internal' and t.deleted_at is null
  group by e.ticket_id,e.event_type,e.created_at
 loop
  perform pqr_private.enqueue_team_mail(g.ticket_id,g.event_type);
  update public.pqr_mail_events set status='cancelled',locked_at=null,
   last_error='Sustituido por un aviso agrupado al equipo' where id=any(g.ids);
 end loop;
end $$;
commit;
