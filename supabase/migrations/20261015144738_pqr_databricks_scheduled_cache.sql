-- PQR only. No Databricks credential is stored in Supabase.
begin;
create table public.pqr_audit_cache (
  audit_id text primary key check (audit_id ~ '^[0-9]{1,30}$'),
  records jsonb not null check (jsonb_typeof(records) = 'array' and jsonb_array_length(records) <= 20),
  checked_at timestamptz not null default now(),
  run_id uuid not null
);
alter table public.pqr_audit_cache enable row level security;
revoke all on public.pqr_audit_cache from public, anon, authenticated;
grant select on public.pqr_audit_cache to authenticated;
grant select, insert, update on public.pqr_audit_cache to service_role;
create policy pqr_audit_cache_read on public.pqr_audit_cache for select to authenticated
using ((select public.pqr_role()) in ('admin','gerente') and exists (
  select 1 from public.pqr_tickets t where t.deleted_at is null
  and (trim(t.data->>'auditOriginal') = audit_id or trim(t.data->>'audit') = audit_id)));

-- Service-only invoker RPC; exposes only audit IDs, no ticket or account details.
grant select(data,deleted_at) on public.pqr_tickets to service_role;
create function public.pqr_databricks_targets(p_after text default '', p_ids text[] default null)
returns table(audit_id text) language sql stable security invoker set search_path = '' as $$
  select distinct trim(a.id) as audit_id
  from public.pqr_tickets t
  cross join lateral unnest(array[t.data->>'auditOriginal',t.data->>'audit']) as a(id)
  where t.deleted_at is null and trim(a.id) ~ '^[0-9]{1,30}$'
    and trim(a.id) > coalesce(p_after,'')
    and (p_ids is null or trim(a.id) = any(p_ids))
  order by audit_id limit 100
$$;
revoke all on function public.pqr_databricks_targets(text,text[]) from public, anon, authenticated;
grant execute on function public.pqr_databricks_targets(text,text[]) to service_role;
commit;
