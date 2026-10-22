-- Each internal batch creates normal independent tickets in one transaction.
begin;
set local lock_timeout='5s';
create table pqr_private.internal_batches (
 request_id uuid primary key,
 payload_hash text not null,
 receipt jsonb not null,
 created_at timestamptz not null default now()
);
alter table pqr_private.internal_batches enable row level security;
revoke all on pqr_private.internal_batches from public,anon,authenticated,service_role;

-- Reuse the deployed intake validations and receipt/upload logic, without allowing
-- callers to bypass the existing single-submit gate. The core is owner-only.
do $clone$
declare definition text:=pg_get_functiondef('pqr_private.submit_internal(uuid,jsonb)'::regprocedure);
 gate text:=$gate$if not pqr_private.internal_gate('submit') then return jsonb_build_object('error','Demasiados envíos. Espera un minuto y vuelve a intentar.'); end if;$gate$;
begin
 assert strpos(definition,gate)>0,'Unexpected single-intake gate';
 assert strpos(definition,'El correo de contacto es obligatorio')>0,'Required contact validation missing';
 assert strpos(definition,'code:=pqr_private.new_internal_code(kind);')>0,'Unexpected internal code generator';
 definition:=replace(definition,'FUNCTION pqr_private.submit_internal(','FUNCTION pqr_private.submit_internal_core(');
 execute replace(definition,gate,'');
end $clone$;
revoke all on function pqr_private.submit_internal_core(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function pqr_private.submit_internal(p_request_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not pqr_private.internal_gate('submit') then return jsonb_build_object('error','Demasiados envíos. Espera un minuto y vuelve a intentar.'); end if;
 return pqr_private.submit_internal_core(p_request_id,p_data);
end $$;
-- CREATE OR REPLACE retains the original single endpoint's grants.

create function pqr_private.submit_internal_batch(p_request_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 previous pqr_private.internal_batches%rowtype; fingerprint text:=md5(p_data::text);
 n integer; item jsonb; file jsonb; size_bytes bigint:=0; k text; hits integer;
 headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 ip text; bucket text; limit_hits integer; result jsonb:='[]'::jsonb; receipt jsonb;
 kind text:=p_data->>'kind'; pdv text; audit text; detail text; row_number integer:=0;
begin
 if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' then return jsonb_build_object('error','Lote inválido'); end if;
 if pg_column_size(p_data)>1048576 then return jsonb_build_object('error','El contenido del lote es demasiado grande'); end if;
 perform pg_advisory_xact_lock(hashtextextended('internal-batch:'||p_request_id::text,0));
 select * into previous from pqr_private.internal_batches where request_id=p_request_id;
 if found then
  if previous.payload_hash<>fingerprint then return jsonb_build_object('error','Este envío ya se registró con otros datos. Conserva los radicados; no lo dupliques'); end if;
  return previous.receipt;
 end if;
 if exists(select 1 from jsonb_object_keys(p_data) key where key<>all(array['requesterName','requesterEmail','kind','client','country','files','rows'])) then return jsonb_build_object('error','El lote contiene campos no permitidos'); end if;
 if jsonb_typeof(p_data->'rows') is distinct from 'array' then return jsonb_build_object('error','La lista de PDV es inválida'); end if;
 n:=jsonb_array_length(p_data->'rows');
 if n not between 1 and 50 then return jsonb_build_object('error','Indica entre 1 y 50 PDV'); end if;
 -- Weighted counters bound ticket volume, not just HTTP calls. Retries of an
 -- already completed request return its receipt before consuming these counters.
 ip:=coalesce(nullif(headers->>'cf-connecting-ip',''),nullif(split_part(headers->>'x-forwarded-for',',',1),''),'unknown');
 bucket:=to_char(clock_timestamp() at time zone 'UTC','YYYYMMDDHH24MI');
 foreach k in array array['internal-batch:global:'||bucket,'internal-batch:'||md5(ip)||':'||bucket] loop
  limit_hits:=case when k like 'internal-batch:global:%' then 100 else 50 end;
  insert into pqr_private.internal_rate_limits as r(key,hits,expires_at) values(k,n,now()+interval '5 minutes')
   on conflict(key) do update set hits=r.hits+excluded.hits returning r.hits into hits;
  if hits>limit_hits then return jsonb_build_object('error','Se alcanzó el límite de PDV por minuto. Espera un minuto y reintenta el mismo envío'); end if;
 end loop;
 begin
  if kind is null or kind not in ('PQR','RDG','EDC') then raise exception 'Tipo de solicitud inválido'; end if;
  if jsonb_typeof(coalesce(p_data->'files','[]'::jsonb)) is distinct from 'array' then raise exception 'Lista de adjuntos inválida'; end if;
  if jsonb_array_length(coalesce(p_data->'files','[]'::jsonb))>10 then raise exception 'Máximo 10 archivos'; end if;
  for file in select value from jsonb_array_elements(coalesce(p_data->'files','[]'::jsonb)) loop
   if coalesce(file->>'size','') !~ '^[0-9]{1,9}$' then raise exception 'Tamaño de adjunto inválido'; end if;
   size_bytes:=size_bytes+(file->>'size')::bigint;
  end loop;
  if size_bytes*n>104857600 then raise exception 'Los adjuntos superarían 100 MB al copiarlos a todas las solicitudes'; end if;
  -- Validate every row before writing any ticket or consuming a serial.
  for item in select value from jsonb_array_elements(p_data->'rows') loop
   row_number:=row_number+1;
   if jsonb_typeof(item) is distinct from 'object' then raise exception 'Fila % inválida',row_number; end if;
   if exists(select 1 from jsonb_object_keys(item) key where key<>all(array['pdv','auditOriginal','description'])) then raise exception 'Fila % contiene campos no permitidos',row_number; end if;
   pdv:=btrim(coalesce(item->>'pdv','')); audit:=btrim(coalesce(item->>'auditOriginal','')); detail:=btrim(coalesce(item->>'description',''));
   if pdv !~ '^[0-9]{1,80}$' then raise exception 'Fila % requiere ID de PDV numérico',row_number; end if;
   if (kind<>'PQR' or audit<>'') and audit !~ '^[0-9]{1,80}$' then raise exception 'Fila % requiere ID de auditoría numérico',row_number; end if;
   if length(detail) not between 8 and 12000 then raise exception 'Fila % requiere un detalle de 8 a 12000 caracteres',row_number; end if;
  end loop;
  if (select count(*)<>count(distinct (btrim(coalesce(value->>'pdv','')),btrim(coalesce(value->>'auditOriginal','')))) from jsonb_array_elements(p_data->'rows')) then raise exception 'Hay PDV y auditorías repetidos en el envío'; end if;
  for item in select value from jsonb_array_elements(p_data->'rows') loop
   receipt:=pqr_private.submit_internal_core(gen_random_uuid(),(p_data-'rows')||jsonb_build_object('pdv',btrim(item->>'pdv'),'auditOriginal',btrim(coalesce(item->>'auditOriginal','')),'description',btrim(item->>'description')));
   if receipt ? 'error' then raise exception '%',receipt->>'error'; end if;
   result:=result||jsonb_build_array(receipt||jsonb_build_object('pdv',btrim(item->>'pdv'),'auditOriginal',btrim(coalesce(item->>'auditOriginal',''))));
  end loop;
  receipt:=jsonb_build_object('tickets',result);
  insert into pqr_private.internal_batches(request_id,payload_hash,receipt) values(p_request_id,fingerprint,receipt);
  return receipt;
 exception when raise_exception then return jsonb_build_object('error',sqlerrm);
 when others then return jsonb_build_object('error','No se pudo registrar el lote completo. Reintenta el mismo envío; no lo dupliques');
 end;
end $$;
revoke all on function pqr_private.submit_internal_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function pqr_private.submit_internal_batch(uuid,jsonb) to anon,authenticated;
create function public.pqr_submit_internal_batch(p_request_id uuid,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select pqr_private.submit_internal_batch(p_request_id,p_data) $$;
revoke all on function public.pqr_submit_internal_batch(uuid,jsonb) from public;
grant execute on function public.pqr_submit_internal_batch(uuid,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
