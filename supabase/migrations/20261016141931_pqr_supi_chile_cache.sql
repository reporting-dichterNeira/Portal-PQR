-- SUPI is independent of Databricks: numeric IDs may overlap between providers.
-- Prerequisite: approved SQL connection string in Vault, name pqr_supi_connection.
-- No password, token, connection string, or source data belongs in this migration.
begin;
create extension if not exists wrappers with schema extensions;
do $setup$
declare secret_id uuid;
begin
  if not exists(select 1 from pg_foreign_data_wrapper where fdwname='mssql_wrapper') then
    create foreign data wrapper mssql_wrapper handler extensions.mssql_fdw_handler validator extensions.mssql_fdw_validator;
  end if;
  select id into strict secret_id from vault.secrets where name='pqr_supi_connection';
  if not exists(select 1 from pg_foreign_server where srvname='pqr_supi_server') then
    execute format('create server pqr_supi_server foreign data wrapper mssql_wrapper options (conn_string_id %L)',secret_id::text);
  end if;
end $setup$;
revoke all on foreign server pqr_supi_server from public, anon, authenticated, service_role;

create foreign table pqr_private.supi_visits (
 "VISITA" text, "FOLIO" text, "AUDITOR" text, "COORDINADOR" text, "DIA" text,
 "NUMERO_SEMANA" text, "DIA_SEMANA" text, "CADENA" text, "DIRECCION" text,
 "COMUNA" text, "INICIO" text, "FIN" text, "DURACION" text, "CLIENTE" text,
 "ESTUDIO" text, "ESTADO" text, "ID_ESTUDIO" text
) server pqr_supi_server options (table '(SELECT
 CONVERT(varchar(30),v.id_visita) AS VISITA,
 CONVERT(varchar(100),s.foliocadem) AS FOLIO,
 a.NOMBREAPELLIDO AS AUDITOR, sv.NOMBREAPELLIDO AS COORDINADOR,
 CONVERT(varchar(33),v.DIA,126) AS DIA,
 CONVERT(varchar(10),DATEPART(WEEK,v.DIA)) AS NUMERO_SEMANA,
 DATENAME(WEEKDAY,v.DIA) AS DIA_SEMANA,
 cad.descripcion AS CADENA, s.direccion AS DIRECCION, com.comuna_nombre AS COMUNA,
 CONVERT(varchar(33),v.HORAINICIO,126) AS INICIO,
 CONVERT(varchar(33),v.HORAFIN,126) AS FIN,
 CONVERT(varchar,DATEDIFF(SECOND,v.HORAINICIO,v.HORAFIN)/3600)+'':''+
 RIGHT(''0''+CONVERT(varchar,(DATEDIFF(SECOND,v.HORAINICIO,v.HORAFIN)%3600)/60),2)+'':''+
 RIGHT(''0''+CONVERT(varchar,DATEDIFF(SECOND,v.HORAINICIO,v.HORAFIN)%60),2) AS DURACION,
 c.nombrecliente AS CLIENTE, e.nombreestudio AS ESTUDIO,
 CONVERT(varchar(100),v.estado) AS ESTADO,
 CONVERT(varchar(30),es.id_estudio) AS ID_ESTUDIO
 FROM visita v
 LEFT JOIN ESTUDIOSALA es ON v.ID_ESTUDIOSALA=es.ID_ESTUDIOSALA
 LEFT JOIN estudio e ON es.ID_ESTUDIO=e.ID_ESTUDIO
 LEFT JOIN cliente c ON e.ID_CLIENTE=c.ID_CLIENTE
 LEFT JOIN sala s ON es.ID_SALA=s.ID_SALA
 LEFT JOIN COMUNA com ON s.ID_COMUNA=com.COMUNA_ID
 LEFT JOIN cadena cad ON s.ID_CADENA=cad.ID_CADENA
 LEFT JOIN AUDITOR a ON v.ID_AUDITOR=a.ID_AUDITOR
 LEFT JOIN AUDITOR sv ON a.ID_SUPERVISOR=sv.ID_AUDITOR
 WHERE v.DIA>=''2026-01-01'' AND es.id_estudio=525)');
revoke all on pqr_private.supi_visits from public, anon, authenticated, service_role;

create function public.pqr_is_supi_case(d jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select lower(trim(coalesce(d->>'country','')))='chile' and (
  lower(trim(coalesce(d->>'client',''))) ~ '^ko[ _-]*mod(erno)?([ _-]|$)' or
  (lower(trim(coalesce(d->>'client','')))='ko' and
   lower(trim(coalesce(d->'auditFallback'->>'canal',d->'auditData'->>'canal','')))='moderno'))
$$;
revoke all on function public.pqr_is_supi_case(jsonb) from public, anon;
grant execute on function public.pqr_is_supi_case(jsonb) to authenticated;

create table public.pqr_supi_audit_cache (
 audit_id text primary key check(audit_id ~ '^[0-9]{1,30}$'),
 records jsonb not null check(jsonb_typeof(records)='array' and jsonb_array_length(records) between 1 and 20),
 checked_at timestamptz not null,
 run_id uuid not null
);
create table public.pqr_supi_sync_state (
 source text primary key check(source='SUPI'),
 checked_at timestamptz not null,
 row_count integer not null check(row_count>0),
 run_id uuid not null
);
alter table public.pqr_supi_audit_cache enable row level security;
alter table public.pqr_supi_sync_state enable row level security;
revoke all on public.pqr_supi_audit_cache, public.pqr_supi_sync_state from public, anon, authenticated, service_role;
grant select on public.pqr_supi_audit_cache, public.pqr_supi_sync_state to authenticated;
create policy pqr_supi_state_read on public.pqr_supi_sync_state for select to authenticated
 using ((select public.pqr_role()) in ('admin','gerente'));
create policy pqr_supi_cache_read on public.pqr_supi_audit_cache for select to authenticated
 using ((select public.pqr_role()) in ('admin','gerente') and (
 exists(select 1 from public.pqr_tickets t left join public.pqr_case_overrides o on o.case_id=t.id and o.source='platform'
  where t.deleted_at is null and public.pqr_is_supi_case(t.data||coalesce(o.patch,'{}'::jsonb))
  and (trim(t.data->>'auditOriginal')=audit_id or trim(t.data->>'audit')=audit_id)) or
 exists(select 1 from public.pqr_historical_cases h left join public.pqr_case_overrides o on o.case_id=h.id and o.source='historical'
  where public.pqr_is_supi_case(h.data||coalesce(o.patch,'{}'::jsonb))
  and trim(coalesce(o.patch->>'auditOriginal',h.data->>'auditOriginal'))=audit_id)));

create function pqr_private.refresh_supi() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cut timestamptz:=clock_timestamp(); run uuid:=gen_random_uuid(); n integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('pqr-supi-refresh',0)) then
   return jsonb_build_object('status','already_running');
 end if;
 create temporary table pqr_supi_stage on commit drop as
 -- Explicit references are required: wrappers 0.6.2 does not fetch all columns
 -- for a whole-row to_jsonb(s) reference and silently leaves unrequested ones null.
 select s."VISITA" audit_id, jsonb_agg(jsonb_build_object(
 'VISITA',s."VISITA",'FOLIO',s."FOLIO",'AUDITOR',s."AUDITOR",'COORDINADOR',s."COORDINADOR",
 'DIA',s."DIA",'NUMERO_SEMANA',s."NUMERO_SEMANA",'DIA_SEMANA',s."DIA_SEMANA",
 'CADENA',s."CADENA",'DIRECCION',s."DIRECCION",'COMUNA',s."COMUNA",
 'INICIO',s."INICIO",'FIN',s."FIN",'DURACION',s."DURACION",'CLIENTE',s."CLIENTE",
 'ESTUDIO',s."ESTUDIO",'ESTADO',s."ESTADO",'ID ESTUDIO',s."ID_ESTUDIO")) records
 from pqr_private.supi_visits s group by s."VISITA";
 select count(*) into n from pg_temp.pqr_supi_stage;
 if n=0 or exists(select 1 from pg_temp.pqr_supi_stage where audit_id !~ '^[0-9]{1,30}$'
  or jsonb_array_length(records)>20
  or exists(select 1 from jsonb_array_elements(records) r where r->>'ID ESTUDIO' is distinct from '525'
   or r->>'DIA' is null or r->>'DIA'<'2026-01-01' or r->>'VISITA' is distinct from audit_id))
 then raise exception 'SUPI_INVALID_SNAPSHOT'; end if;
 -- All changes commit together. A failed remote query never erases the last cut.
 insert into public.pqr_supi_audit_cache(audit_id,records,checked_at,run_id)
 select audit_id,records,cut,run from pg_temp.pqr_supi_stage
 on conflict(audit_id) do update set records=excluded.records,checked_at=excluded.checked_at,run_id=excluded.run_id;
 delete from public.pqr_supi_audit_cache where run_id<>run;
 insert into public.pqr_supi_sync_state(source,checked_at,row_count,run_id) values('SUPI',cut,n,run)
 on conflict(source) do update set checked_at=excluded.checked_at,row_count=excluded.row_count,run_id=excluded.run_id;
 return jsonb_build_object('source','SUPI','audits',n,'checkedAt',cut);
exception when others then
 raise exception 'SUPI_REFRESH_FAILED: se conserva el corte anterior';
end $$;
revoke all on function pqr_private.refresh_supi() from public, anon, authenticated, service_role;
-- pg_cron uses UTC: 11:00/19:00 = 06:00/14:00 America/Bogota.
select cron.schedule('pqr-supi-sync','0 11,19 * * *',
 $$set statement_timeout='90s'; select pqr_private.refresh_supi();$$);
commit;
