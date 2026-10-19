-- Additive production rollout. Existing client records and workflows stay intact.
begin;
create table pqr_private.internal_rate_limits (
 key text primary key, hits integer not null, expires_at timestamptz not null
);
create index internal_rate_expiry on pqr_private.internal_rate_limits(expires_at);
create table pqr_private.internal_receipts (
 request_id uuid primary key, ticket_id uuid not null unique references public.pqr_tickets(id),
 payload_hash text not null, receipt jsonb not null, created_at timestamptz not null default now()
);
create table pqr_private.internal_uploads (
 path text primary key, ticket_id uuid not null references public.pqr_tickets(id),
 expires_at timestamptz not null default now()+interval '2 hours'
);
alter table pqr_private.internal_rate_limits enable row level security;
alter table pqr_private.internal_receipts enable row level security;
alter table pqr_private.internal_uploads enable row level security;
revoke all on pqr_private.internal_rate_limits,pqr_private.internal_receipts,pqr_private.internal_uploads from public,anon,authenticated;
create sequence pqr_private.internal_code_seq;
revoke all on sequence pqr_private.internal_code_seq from public,anon,authenticated;

create function pqr_private.internal_gate(p_action text) returns boolean
language plpgsql security definer set search_path='' as $$
declare
 h jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 ip text; bucket text; k text; n integer; max_hits integer;
begin
 if p_action not in ('submit','lookup') then return false; end if;
 ip:=coalesce(nullif(h->>'cf-connecting-ip',''),nullif(split_part(h->>'x-forwarded-for',',',1),''),'unknown');
 bucket:=to_char(clock_timestamp() at time zone 'UTC','YYYYMMDDHH24MI');
 -- Global ceilings remain effective even if a client spoofs forwarding headers.
 foreach k in array array[p_action||':global:'||bucket,p_action||':'||md5(ip)||':'||bucket] loop
  max_hits:=case when k like '%:global:%' then case when p_action='submit' then 30 else 600 end else case when p_action='submit' then 5 else 30 end end;
  insert into pqr_private.internal_rate_limits as r(key,hits,expires_at)
   values(k,1,now()+interval '5 minutes') on conflict(key) do update set hits=r.hits+1 returning hits into n;
  if n>max_hits then return false; end if;
 end loop;
 delete from pqr_private.internal_rate_limits where expires_at<now();
 return true;
end $$;
revoke all on function pqr_private.internal_gate(text) from public,anon,authenticated;

-- Only these privileged routines may create anonymous internal tickets.
alter table public.pqr_tickets drop constraint pqr_manual_sin_cuenta_comercial;
alter table public.pqr_tickets add constraint pqr_manual_sin_cuenta_comercial check (
 commercial_id is not null or coalesce(
  (data->>'manualEntry'='true' and data->>'requestType'='PQR' and nullif(data->>'createdBy','') is not null)
  or (data->>'scope'='internal' and data->>'publicInternal'='true'
   and data->>'requestType' in ('PQR','RDG','EDC') and length(data->>'requesterName') between 3 and 150),false)
);
create index pqr_internal_scope_created on public.pqr_tickets(created_at desc)
 where data->>'scope'='internal' and deleted_at is null;

create function pqr_private.submit_internal(p_request_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 kind text:=p_data->>'kind'; person text:=btrim(coalesce(p_data->>'requesterName',''));
 email text:=lower(btrim(coalesce(p_data->>'requesterEmail','')));
 study text:=btrim(coalesce(p_data->>'client','')); country text:=p_data->>'country';
 pdv text:=btrim(coalesce(p_data->>'pdv','')); audit text:=btrim(coalesce(p_data->>'auditOriginal',''));
 description text:=btrim(coalesce(p_data->>'description','')); file jsonb; filename text; ext text;
 id uuid:=gen_random_uuid(); code text; number text; account uuid; t jsonb; result jsonb; previous pqr_private.internal_receipts%rowtype;
 paths jsonb:='[]'::jsonb; file_path text; stamp timestamptz:=now(); fingerprint text:=md5(p_data::text);
begin
 if not pqr_private.internal_gate('submit') then return jsonb_build_object('error','Demasiados envíos. Espera un minuto y vuelve a intentar.'); end if;
 begin
  if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Solicitud inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into previous from pqr_private.internal_receipts where request_id=p_request_id;
  if found then
   if previous.payload_hash<>fingerprint then raise exception 'El envío ya fue registrado con otros datos. No lo dupliques'; end if;
   return previous.receipt;
  end if;
  if kind is null or kind not in ('PQR','RDG','EDC') or length(person) not between 3 and 150
   or length(study) not between 1 and 100 or length(description) not between 8 and 12000 then raise exception 'Completa el solicitante, tipo, estudio y motivo'; end if;
  if length(email)>254 or (email<>'' and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Correo de contacto inválido'; end if;
  if country is null or country<>all(array['Colombia','Guatemala','Honduras','El Salvador','Nicaragua','Panamá','Perú','Bolivia','Paraguay','Costa Rica','Ecuador','Chile','República Dominicana']) then raise exception 'Selecciona un país válido'; end if;
  if (kind<>'EDC' and pdv !~ '^[0-9]{1,80}$') or (pdv<>'' and pdv !~ '^[0-9]{1,80}$') then raise exception 'ID de PDV inválido'; end if;
  if (kind<>'PQR' and audit !~ '^[0-9]{1,80}$') or (audit<>'' and audit !~ '^[0-9]{1,80}$') then raise exception 'ID de auditoría inválido'; end if;
  if jsonb_typeof(coalesce(p_data->'files','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p_data->'files','[]'::jsonb))>10 then raise exception 'Máximo 10 archivos'; end if;
  for file in select value from jsonb_array_elements(coalesce(p_data->'files','[]'::jsonb)) loop
   filename:=file->>'name'; ext:=lower(substring(filename from '\.([^.]+)$'));
   if filename is null or length(filename) not between 1 and 200 or ext is null or ext<>all(array['jpg','jpeg','png','webp','gif','bmp','heic','heif','xls','xlsx'])
    or coalesce(file->>'size','') !~ '^[0-9]{1,9}$' then raise exception 'Adjunto inválido: usa imágenes o Excel'; end if;
   if (file->>'size')::bigint not between 1 and 10485760 then raise exception 'Máximo 10 MB por archivo'; end if;
   file_path:=id::text||'/'||gen_random_uuid()::text||'-'||right(regexp_replace(filename,'[^a-zA-Z0-9._-]','_','g'),140);
   paths:=paths||jsonb_build_array(file_path);
  end loop;
  number:=nextval('pqr_private.internal_code_seq')::text;
  code:=kind||'-INT-'||extract(year from stamp at time zone 'America/Bogota')::integer||'-'||repeat('0',greatest(0,4-length(number)))||number||'-'||upper(left(replace(gen_random_uuid()::text,'-',''),16));
  t:=jsonb_build_object('id',id,'code',code,'scope','internal','publicInternal',true,'requestType',kind,
   'requesterName',person,'requesterEmail',email,'commercial',null,'pdv',pdv,'client',study,'country',country,
   'auditOriginal',audit,'description',description,'directRedigitation',kind='RDG','createdAt',stamp,
   'status',case when kind='PQR' then 'Radicado' else 'Pendiente de Redigitación' end,'timeline','[]'::jsonb);
  if kind<>'PQR' then
   select p.id into account from public.pqr_profiles p where p.active and p.role='redigitador' order by p.created_at limit 1;
   if account is null then raise exception 'No hay cuenta de Redigitación activa'; end if;
   t:=t||jsonb_build_object('redigitador',account,'redigitRequestedAt',stamp);
   if kind='EDC' then t:=t||jsonb_build_object('redigitType','Validación'); end if;
  end if;
  t:=public.pqr_event(t,person,'Solicitud interna recibida','Nombre declarado por el solicitante; no constituye identidad autenticada.');
  insert into public.pqr_tickets(id,code,status,created_at,updated_at,data) values(id,code,t->>'status',stamp,stamp,t);
  if account is not null then perform public.pqr_notice(account,id,'Nueva solicitud interna',code||' espera asignación'); end if;
  for file_path in select jsonb_array_elements_text(paths) loop
   insert into pqr_private.internal_uploads(path,ticket_id) values(file_path,id);
  end loop;
  result:=jsonb_build_object('id',id,'code',code,'requestType',kind,'uploadPaths',paths);
  insert into pqr_private.internal_receipts(request_id,ticket_id,payload_hash,receipt) values(p_request_id,id,fingerprint,result);
  return result;
 exception when raise_exception then return jsonb_build_object('error',sqlerrm);
 when others then return jsonb_build_object('error','No se pudo registrar. Reintenta el mismo envío; no lo dupliques.'); end;
end $$;
revoke all on function pqr_private.submit_internal(uuid,jsonb) from public;
grant usage on schema pqr_private to anon;
grant execute on function pqr_private.submit_internal(uuid,jsonb) to anon,authenticated;
create function public.pqr_submit_internal(p_request_id uuid,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select pqr_private.submit_internal(p_request_id,p_data) $$;
revoke all on function public.pqr_submit_internal(uuid,jsonb) from public;
grant execute on function public.pqr_submit_internal(uuid,jsonb) to anon,authenticated;

create function pqr_private.lookup_internal(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.pqr_tickets%rowtype; v_code text:=upper(btrim(coalesce(p_code,'')));
begin
 if not pqr_private.internal_gate('lookup') then return jsonb_build_object('error','Demasiadas consultas. Espera un minuto.'); end if;
 if v_code !~ '^(PQR|RDG|EDC)-INT-[0-9]{4}-[0-9]{4,}-[A-F0-9]{16}$' then return null; end if;
 select * into r from public.pqr_tickets where pqr_tickets.code=v_code and deleted_at is null and data->>'scope'='internal';
 if not found then return null; end if;
 return jsonb_build_object('code',r.code,'requestType',r.data->>'requestType','status',r.status,
  'createdAt',r.created_at,'updatedAt',r.updated_at,'closedAt',r.data->>'closedAt');
end $$;
revoke all on function pqr_private.lookup_internal(text) from public;
grant execute on function pqr_private.lookup_internal(text) to anon,authenticated;
create function public.pqr_lookup_internal(p_code text) returns jsonb
language sql security invoker set search_path='' as $$ select pqr_private.lookup_internal(p_code) $$;
revoke all on function public.pqr_lookup_internal(text) from public;
grant execute on function public.pqr_lookup_internal(text) to anon,authenticated;

create function pqr_private.internal_upload_allowed(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from pqr_private.internal_uploads u join public.pqr_tickets t on t.id=u.ticket_id
  where u.path=p_path and u.expires_at>now() and t.deleted_at is null and t.data->>'scope'='internal');
$$;
revoke all on function pqr_private.internal_upload_allowed(text) from public;
grant execute on function pqr_private.internal_upload_allowed(text) to anon,authenticated;
create policy pqr_internal_capability_upload on storage.objects for insert to anon,authenticated
with check (bucket_id='pqr-adjuntos' and pqr_private.internal_upload_allowed(name));
-- No SELECT, UPDATE, DELETE or bucket listing is granted to anonymous visitors.

create function pqr_private.create_manual_scoped(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t jsonb; code text; number text; actor uuid:=auth.uid();
begin
 if not exists(select 1 from public.pqr_profiles where id=actor and active and role in ('validador','gerente')) then raise exception 'Cuenta no autorizada'; end if;
 if coalesce(p_data->>'scope','external') not in ('external','internal') then raise exception 'Apartado inválido'; end if;
 t:=pqr_private.create_manual_pqr(p_data);
 if p_data->>'scope'='internal' then
  number:=nextval('pqr_private.internal_code_seq')::text;
  code:='PQR-INT-'||extract(year from now() at time zone 'America/Bogota')::integer||'-'||repeat('0',greatest(0,4-length(number)))||number||'-'||upper(left(replace(gen_random_uuid()::text,'-',''),16));
  t:=t||jsonb_build_object('code',code,'scope','internal');
  update public.pqr_tickets set code=t->>'code',data=t where id=(t->>'id')::uuid;
 end if;
 return t;
end $$;
revoke all on function pqr_private.create_manual_scoped(jsonb) from public,anon;
grant execute on function pqr_private.create_manual_scoped(jsonb) to authenticated;
create function public.pqr_create_manual_scoped(p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select pqr_private.create_manual_scoped(p_data) $$;
revoke all on function public.pqr_create_manual_scoped(jsonb) from public,anon;
grant execute on function public.pqr_create_manual_scoped(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
