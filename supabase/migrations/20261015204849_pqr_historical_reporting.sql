-- Historical cases never enter pqr_tickets, operational mail, or SLA calculations.
begin;
create table public.pqr_historical_cases (
  id uuid primary key,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  source_sheet text not null,
  source_row integer not null check(source_row > 1),
  source_data jsonb not null check(jsonb_typeof(source_data)='object'),
  data jsonb not null check(jsonb_typeof(data)='object' and data->>'origin'='historical' and data->>'id'=id::text),
  imported_at timestamptz not null default now(),
  unique(source_hash,source_sheet,source_row)
);
create index pqr_historical_audit_idx on public.pqr_historical_cases ((data->>'auditOriginal'));
alter table public.pqr_historical_cases enable row level security;
revoke all on public.pqr_historical_cases from public, anon, authenticated;
grant select on public.pqr_historical_cases to authenticated;
grant select on public.pqr_historical_cases to service_role;
create policy pqr_history_read on public.pqr_historical_cases for select to authenticated
using ((select public.pqr_role()) in ('admin','gerente'));

-- Reporting-only overlays. The imported row and operational workflow stay immutable.
create table public.pqr_case_overrides (
  case_id uuid primary key,
  source text not null check(source in ('historical','platform')),
  patch jsonb not null default '{}' check(jsonb_typeof(patch)='object'),
  reason text not null check(length(trim(reason)) between 5 and 1000),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null default auth.uid(),
  history jsonb not null default '[]' check(jsonb_typeof(history)='array')
);
alter table public.pqr_case_overrides enable row level security;
revoke all on public.pqr_case_overrides from public, anon, authenticated;
grant select on public.pqr_case_overrides to authenticated;
grant insert(case_id,source,patch,reason), update(patch,reason) on public.pqr_case_overrides to authenticated;
grant select on public.pqr_case_overrides to service_role;
create policy pqr_overrides_read on public.pqr_case_overrides for select to authenticated
using ((select public.pqr_role()) in ('admin','gerente'));
create policy pqr_overrides_insert on public.pqr_case_overrides for insert to authenticated
with check ((select public.pqr_role()) in ('admin','gerente') and (
 (source='historical' and exists(select 1 from public.pqr_historical_cases h where h.id=case_id)) or
 (source='platform' and exists(select 1 from public.pqr_tickets t where t.id=case_id and t.deleted_at is null))));
create policy pqr_overrides_update on public.pqr_case_overrides for update to authenticated
using ((select public.pqr_role()) in ('admin','gerente'))
with check ((select public.pqr_role()) in ('admin','gerente') and (
 (source='historical' and exists(select 1 from public.pqr_historical_cases h where h.id=case_id)) or
 (source='platform' and exists(select 1 from public.pqr_tickets t where t.id=case_id and t.deleted_at is null))));

create function pqr_private.stamp_case_override() returns trigger
language plpgsql security invoker set search_path='' as $$
declare k text; v jsonb;
begin
 if auth.uid() is null or public.pqr_role() not in ('admin','gerente') then raise exception 'Acceso no autorizado'; end if;
 for k,v in select * from jsonb_each(new.patch) loop
   if k not in ('auditOriginal','country','client','reportingMonth','pdv','analystName','tipology','area','applies','auditAuditor','auditValidator','auditCity','auditRegion','reviewed') then raise exception 'Campo no permitido'; end if;
   if k='reviewed' then
     if jsonb_typeof(v)<>'boolean' then raise exception 'Revisión inválida'; end if;
   elsif jsonb_typeof(v)<>'string' or length(v#>>'{}')>300 then raise exception 'Valor inválido';
   end if;
 end loop;
 if new.patch ? 'auditOriginal' and (new.source<>'historical' or (new.patch->>'auditOriginal') !~ '^[0-9]{1,30}$') then raise exception 'ID de auditoría inválido'; end if;
 if new.patch ? 'pdv' and (new.patch->>'pdv') !~ '^[0-9]{1,30}$' then raise exception 'ID de PDV inválido'; end if;
 if new.patch ? 'reportingMonth' and (new.patch->>'reportingMonth') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Mes inválido'; end if;
 if new.patch ? 'applies' and new.patch->>'applies' not in ('Aplica','No Aplica','') then raise exception 'Procede inválido'; end if;
 new.updated_at=clock_timestamp(); new.updated_by=auth.uid();
 new.history=case when TG_OP='UPDATE' then old.history else '[]'::jsonb end || jsonb_build_array(jsonb_build_object('at',new.updated_at,'by',new.updated_by,'patch',new.patch,'reason',new.reason));
 return new;
end $$;
revoke all on function pqr_private.stamp_case_override() from public, anon, authenticated;
create trigger pqr_override_stamp before insert or update on public.pqr_case_overrides for each row execute function pqr_private.stamp_case_override();

-- Cache policies and the existing twice-daily job also include historical IDs.
drop policy pqr_audit_cache_read on public.pqr_audit_cache;
create policy pqr_audit_cache_read on public.pqr_audit_cache for select to authenticated
using ((select public.pqr_role()) in ('admin','gerente') and (
 exists(select 1 from public.pqr_tickets t where t.deleted_at is null and (trim(t.data->>'auditOriginal')=audit_id or trim(t.data->>'audit')=audit_id)) or
 exists(select 1 from public.pqr_historical_cases h where h.data->>'auditOriginal'=audit_id) or
 exists(select 1 from public.pqr_case_overrides o where o.source='historical' and o.patch->>'auditOriginal'=audit_id)));
create or replace function public.pqr_databricks_targets(p_after text default '', p_ids text[] default null)
returns table(audit_id text) language sql stable security invoker set search_path='' as $$
 select distinct trim(a.id) audit_id from (
   select unnest(array[t.data->>'auditOriginal',t.data->>'audit']) id from public.pqr_tickets t where t.deleted_at is null
   union all select h.data->>'auditOriginal' from public.pqr_historical_cases h
   union all select o.patch->>'auditOriginal' from public.pqr_case_overrides o where o.source='historical'
 ) a where trim(a.id) ~ '^[0-9]{1,30}$' and trim(a.id)>coalesce(p_after,'')
 and (p_ids is null or trim(a.id)=any(p_ids)) order by audit_id limit 100
$$;
revoke all on function public.pqr_databricks_targets(text,text[]) from public, anon, authenticated;
grant execute on function public.pqr_databricks_targets(text,text[]) to service_role;
commit;
