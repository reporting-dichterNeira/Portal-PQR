-- Atomic and idempotent client batches, with the same manual-intake roles.
begin;
create table pqr_private.manual_batches (
 actor_id uuid not null references public.pqr_profiles(id),
 request_id uuid not null,
 payload_hash text not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
alter table pqr_private.manual_batches enable row level security;
revoke all on pqr_private.manual_batches from public,anon,authenticated;
create index pqr_client_source_ticket_idx on public.pqr_tickets (
 lower(btrim(data->>'externalTicketId')), (data->>'client'), (data->>'country')
) where deleted_at is null and data->>'scope' is distinct from 'internal' and data->>'requestType'='PQR';

create function pqr_private.create_manual_batch(p_request_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor public.pqr_profiles%rowtype; previous pqr_private.manual_batches%rowtype;
 study text:=btrim(coalesce(p_data->>'client','')); country text:=p_data->>'country';
 received timestamptz; item jsonb; reference text; t jsonb; result jsonb:='[]'::jsonb;
 fingerprint text:=md5(p_data::text); stamp timestamptz:=clock_timestamp();
begin
 select * into actor from public.pqr_profiles where id=auth.uid() and active;
 if not found or actor.role not in ('validador','gerente') then raise exception 'Solo Analistas de PQR y Gerencia pueden radicar por lote'; end if;
 if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Lote inválido'; end if;
 if coalesce(p_data->>'scope','external')<>'external' then raise exception 'La carga múltiple solo está disponible en PQR de clientes'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_request_id::text,0));
 select * into previous from pqr_private.manual_batches where actor_id=actor.id and request_id=p_request_id;
 if found then
  if previous.payload_hash<>fingerprint then raise exception 'Este lote ya se registró con otros datos. Revisa la bandeja antes de iniciar otro'; end if;
  return previous.result;
 end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k<>all(array['scope','client','country','receivedAt','tickets'])) then raise exception 'El lote contiene campos no permitidos'; end if;
 if length(study) not between 1 and 100 or country is null or country<>all(array['Colombia','Guatemala','Honduras','El Salvador','Nicaragua','Panamá','Perú','Bolivia','Paraguay','Costa Rica','Ecuador','Chile','República Dominicana']) then raise exception 'Selecciona cliente/estudio y país válidos'; end if;
 if coalesce(p_data->>'receivedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(-05:00|Z|[+]00:00)$' then raise exception 'Indica la fecha y hora de recepción con su zona horaria'; end if;
 received:=(p_data->>'receivedAt')::timestamptz;
 if not isfinite(received) or received<'2000-01-01T00:00:00Z'::timestamptz or received>stamp+interval '1 minute' then raise exception 'Fecha de recepción inválida o futura'; end if;
 if jsonb_typeof(p_data->'tickets') is distinct from 'array' then raise exception 'La lista de tickets es inválida'; end if;
 if jsonb_array_length(p_data->'tickets') not between 1 and 100 then raise exception 'Registra de 1 a 100 tickets por lote'; end if;
 for item in select value from jsonb_array_elements(p_data->'tickets') loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'Ticket de origen inválido'; end if;
  if exists(select 1 from jsonb_object_keys(item) k where k<>'externalTicketId') then raise exception 'Un ticket solo admite su ID de origen'; end if;
  reference:=btrim(coalesce(item->>'externalTicketId',''));
  if length(reference) not between 1 and 100 then raise exception 'Completa todos los IDs de ticket (máximo 100 caracteres)'; end if;
 end loop;
 if (select count(*)<>count(distinct lower(btrim(value->>'externalTicketId'))) from jsonb_array_elements(p_data->'tickets')) then raise exception 'Hay IDs de ticket repetidos en el lote'; end if;
 -- Stable order avoids deadlocks between concurrent batches for the same sources.
 for reference in select lower(btrim(value->>'externalTicketId')) from jsonb_array_elements(p_data->'tickets') order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('pqr-batch-source:'||study||':'||country||':'||reference,0));
  if exists(select 1 from public.pqr_tickets x where x.deleted_at is null and x.data->>'scope' is distinct from 'internal'
   and x.data->>'requestType'='PQR' and lower(btrim(x.data->>'externalTicketId'))=reference and x.data->>'client'=study and x.data->>'country'=country) then
   raise exception 'Ya existe el ticket de origen % para ese cliente y país. Revisa la bandeja',reference;
  end if;
 end loop;
 for item in select value from jsonb_array_elements(p_data->'tickets') loop
  reference:=btrim(item->>'externalTicketId');
  t:=pqr_private.create_manual_pqr(jsonb_build_object('client',study,'country',country,'externalTicketId',reference,'pdv','','description','','source','Otro'));
  t:=t||jsonb_build_object('scope','external','receivedAt',received,'batchId',p_request_id);
  t:=public.pqr_event(t,actor.name,'Recepción registrada en lote','Fecha de recepción (Bogotá): '||to_char(received at time zone 'America/Bogota','YYYY-MM-DD HH24:MI')||'. SLA: 48 horas de lunes a viernes, sin sábados ni domingos.');
  update public.pqr_tickets set data=t where id=(t->>'id')::uuid;
  result:=result||jsonb_build_array(jsonb_build_object('id',t->>'id','code',t->>'code','externalTicketId',reference));
 end loop;
 result:=jsonb_build_object('tickets',result,'receivedAt',received);
 insert into pqr_private.manual_batches(actor_id,request_id,payload_hash,result) values(actor.id,p_request_id,fingerprint,result);
 return result;
end $$;
revoke all on function pqr_private.create_manual_batch(uuid,jsonb) from public,anon;
grant execute on function pqr_private.create_manual_batch(uuid,jsonb) to authenticated;
create function public.pqr_create_manual_batch(p_request_id uuid,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select pqr_private.create_manual_batch(p_request_id,p_data) $$;
revoke all on function public.pqr_create_manual_batch(uuid,jsonb) from public,anon;
grant execute on function public.pqr_create_manual_batch(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
