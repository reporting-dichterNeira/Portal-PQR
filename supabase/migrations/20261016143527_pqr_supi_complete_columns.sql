-- Repair already-installed wrappers 0.6.2: explicit projection and a safe SQL alias.
begin;
do $repair$
declare remote_query text;
begin
 if exists(select 1 from pg_attribute where attrelid='pqr_private.supi_visits'::regclass and attname='ID ESTUDIO' and not attisdropped) then
  alter foreign table pqr_private.supi_visits rename column "ID ESTUDIO" to "ID_ESTUDIO";
 end if;
 select option_value into strict remote_query from pg_foreign_table f,
 lateral pg_options_to_table(f.ftoptions) where f.ftrelid='pqr_private.supi_visits'::regclass and option_name='table';
 remote_query:=replace(remote_query,'AS [ID ESTUDIO]','AS ID_ESTUDIO');
 execute format('alter foreign table pqr_private.supi_visits options (set table %L)',remote_query);
end $repair$;
create or replace function pqr_private.refresh_supi() returns jsonb
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
commit;
