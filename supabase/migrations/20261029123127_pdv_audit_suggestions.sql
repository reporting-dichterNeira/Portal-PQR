-- Minimal latest-audit suggestions, separate from the reporting cache and ticket data.
begin;
set local lock_timeout='5s';
create function pqr_private.pdv_country(value text) returns text language sql immutable security invoker set search_path='' as $$
 select regexp_replace(lower(translate(btrim(coalesce(value,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'\s+',' ','g')
$$;
create function pqr_private.pdv_study(value text) returns text language sql immutable security invoker set search_path='' as $$
 select case when s ~ '\mlindley\M' then 'lindley' when s ~ '\mko\s+mod(erno)?\M' then 'ko moderno'
 when s ~ '\mko\s+trad(icional)?\M' then 'ko tradicional' else '' end
 from (select regexp_replace(pqr_private.pdv_country(value),'[_-]+',' ','g') s) x
$$;
revoke all on function pqr_private.pdv_country(text),pqr_private.pdv_study(text) from public,anon,authenticated;
grant usage on schema pqr_private to service_role;
grant execute on function pqr_private.pdv_country(text),pqr_private.pdv_study(text) to service_role;
create table pqr_private.pdv_audit_suggestions (
 target_key text primary key check(target_key ~ '^[a-f0-9]{32}$'),
 pdv text not null check(pdv ~ '^[0-9]{1,80}$'),country text not null,study text not null check(study in ('ko moderno','ko tradicional','lindley')),
 audit_id text check(audit_id ~ '^[0-9]{1,30}$'),audit_date text,ola text,survey text,
 checked_at timestamptz not null,run_id uuid not null,
 unique(pdv,country,study),check(audit_id is null or (audit_date is not null and ola is not null and survey is not null))
);
alter table pqr_private.pdv_audit_suggestions enable row level security;
revoke all on pqr_private.pdv_audit_suggestions from public,anon,authenticated;
grant select,insert,update on pqr_private.pdv_audit_suggestions to service_role;
create function public.pqr_databricks_pdv_targets(p_after text default '',p_keys text[] default null)
returns table(target_key text,pdv text,country text,study text) language sql stable security invoker set search_path='' as $$
 with tuples as (
  select distinct btrim(t.data->>'pdv') pdv,pqr_private.pdv_country(t.data->>'country') country,pqr_private.pdv_study(t.data->>'client') study
  from public.pqr_tickets t where t.deleted_at is null and t.data->>'status' in ('Radicado','En Validación','Reabierto')
   and coalesce(t.data->>'requestType',case when t.data->>'code' like 'RDG-%' or t.data->>'directRedigitation'='true' then 'RDG' when t.data->>'code' like 'EDC-%' then 'EDC' else 'PQR' end)='PQR'
 ), targets as (select md5(pdv||'|'||country||'|'||study) target_key,* from tuples
  where pdv ~ '^[0-9]{1,80}$' and study<>'' and country in ('colombia','guatemala','honduras','el salvador','nicaragua','panama','peru','bolivia','paraguay','costa rica','ecuador','chile','republica dominicana')
   and not(country='chile' and study='ko moderno'))
 select * from targets where target_key>coalesce(p_after,'') and (p_keys is null or target_key=any(p_keys)) order by target_key limit 100
$$;
revoke all on function public.pqr_databricks_pdv_targets(text,text[]) from public,anon,authenticated;
grant execute on function public.pqr_databricks_pdv_targets(text,text[]) to service_role;
create function public.pqr_publish_pdv_suggestions(p_entries jsonb,p_run_id uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare item jsonb; target record; n integer; keys text[]; aid text; stamp timestamptz:=now();
begin
 if jsonb_typeof(p_entries) is distinct from 'array' or p_run_id is null then raise exception 'Invalid suggestion batch'; end if;
 n:=jsonb_array_length(p_entries);if n not between 1 and 100 then raise exception 'Invalid suggestion count'; end if;
 select array_agg(x->>'key') into keys from jsonb_array_elements(p_entries) x;
 if (select count(distinct k) from unnest(keys) k)<>n or exists(select 1 from unnest(keys) k where k !~ '^[a-f0-9]{32}$') then raise exception 'Invalid suggestion keys'; end if;
 if (select count(*) from public.pqr_databricks_pdv_targets('',keys))<>n then raise exception 'Suggestion target no longer active'; end if;
 for target in select * from public.pqr_databricks_pdv_targets('',keys) loop
  select x into item from jsonb_array_elements(p_entries) x where x->>'key'=target.target_key;
  if coalesce(item->>'pdv','')<>target.pdv or coalesce(item->>'country','')<>target.country or coalesce(item->>'study','')<>target.study then raise exception 'Suggestion tuple mismatch'; end if;
  aid:=nullif(item->>'auditId','');
  if aid is not null then
   if aid !~ '^[0-9]{1,30}$' or coalesce(item->>'auditDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    or length(item->>'auditDate')>100 or coalesce(right(item->>'ola',4),'') !~ '^[0-9]{4}$'
    or right(item->>'ola',4)::integer<2026 or length(coalesce(item->>'survey',''))>1000
    or pqr_private.pdv_study(item->>'survey')<>target.study then raise exception 'Invalid source suggestion'; end if;
   perform (item->>'auditDate')::timestamp;
   if (item->>'auditDate')::timestamp::date not between (now() at time zone 'America/Bogota')::date-59 and (now() at time zone 'America/Bogota')::date then raise exception 'Suggestion outside 60-day window';end if;
  end if;
  insert into pqr_private.pdv_audit_suggestions(target_key,pdv,country,study,audit_id,audit_date,ola,survey,checked_at,run_id)
  values(target.target_key,target.pdv,target.country,target.study,aid,case when aid is not null then item->>'auditDate' end,
   case when aid is not null then left(item->>'ola',1000) end,case when aid is not null then item->>'survey' end,stamp,p_run_id)
  on conflict(target_key) do update set audit_id=excluded.audit_id,audit_date=excluded.audit_date,ola=excluded.ola,survey=excluded.survey,checked_at=excluded.checked_at,run_id=excluded.run_id;
 end loop;
 return n;
end $$;
revoke all on function public.pqr_publish_pdv_suggestions(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.pqr_publish_pdv_suggestions(jsonb,uuid) to service_role;
create function pqr_private.suggest_audits(p_ticket_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.pqr_tickets%rowtype; cached pqr_private.pdv_audit_suggestions%rowtype;
 v_pdv text; v_country text; v_study text; result jsonb:='[]'::jsonb; n integer:=0;
begin
 if auth.uid() is null or not exists(select 1 from public.pqr_profiles where id=auth.uid() and active and role='validador') then raise exception 'Consulta exclusiva de Analistas de PQR'; end if;
 if coalesce(cardinality(p_ticket_ids),0) not between 1 and 100 or array_position(p_ticket_ids,null) is not null
  or (select count(distinct x) from unnest(p_ticket_ids) x)<>cardinality(p_ticket_ids) then raise exception 'Selecciona entre 1 y 100 PQR diferentes'; end if;
 for t in select * from public.pqr_tickets where id=any(p_ticket_ids) and deleted_at is null order by id loop
  n:=n+1;
  if t.status not in ('Radicado','En Validación','Reabierto') or coalesce(t.data->>'requestType',case when t.code like 'RDG-%' or t.data->>'directRedigitation'='true' then 'RDG' when t.code like 'EDC-%' then 'EDC' else 'PQR' end)<>'PQR' then raise exception 'Una solicitud ya no está pendiente de dictamen. Actualiza la bandeja'; end if;
  v_pdv:=btrim(coalesce(t.data->>'pdv',''));v_country:=pqr_private.pdv_country(t.data->>'country');v_study:=pqr_private.pdv_study(t.data->>'client');
  if v_pdv !~ '^[0-9]{1,80}$' then result:=result||jsonb_build_array(jsonb_build_object('ticketId',t.id,'status','missing_pdv'));continue;end if;
  if v_study='' or (v_country='chile' and v_study='ko moderno') then result:=result||jsonb_build_array(jsonb_build_object('ticketId',t.id,'status','unsupported'));continue;end if;
  select * into cached from pqr_private.pdv_audit_suggestions where target_key=md5(v_pdv||'|'||v_country||'|'||v_study);
  if not found then result:=result||jsonb_build_array(jsonb_build_object('ticketId',t.id,'status','pending'));continue;end if;
  if cached.audit_id is not null and cached.audit_date::timestamp::date not between (now() at time zone 'America/Bogota')::date-59 and (now() at time zone 'America/Bogota')::date then
   result:=result||jsonb_build_array(jsonb_build_object('ticketId',t.id,'status','expired','checkedAt',cached.checked_at));continue;end if;
  result:=result||jsonb_build_array(jsonb_build_object('ticketId',t.id,'status',case when cached.audit_id is null then 'not_found' else 'found' end,
   'pdv',v_pdv,'country',v_country,'study',v_study,'auditId',cached.audit_id,'auditDate',cached.audit_date,'ola',cached.ola,'survey',cached.survey,'checkedAt',cached.checked_at));
 end loop;
 if n<>cardinality(p_ticket_ids) then raise exception 'Una PQR no existe o no está disponible'; end if;
 return result;
end $$;
revoke all on function pqr_private.suggest_audits(uuid[]) from public,anon,authenticated,service_role;
grant execute on function pqr_private.suggest_audits(uuid[]) to authenticated;
create function public.pqr_suggest_audits(p_ticket_ids uuid[]) returns jsonb language sql security invoker set search_path='' as $$ select pqr_private.suggest_audits(p_ticket_ids) $$;
revoke all on function public.pqr_suggest_audits(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.pqr_suggest_audits(uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
