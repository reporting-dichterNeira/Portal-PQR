-- User-approved general consecutive for internal PQR, RDG and EDC.
-- Public lookup remains limited to status/dates; sequential codes are enumerable.
begin;
set local lock_timeout='5s';

create or replace function pqr_private.new_internal_code(p_kind text) returns text
language plpgsql security invoker set search_path='' as $$
declare serial text; candidate text; attempt integer;
begin
 if p_kind is null or p_kind not in ('PQR','RDG','EDC') then raise exception 'Tipo interno inválido'; end if;
 for attempt in 1..10 loop
  serial:=nextval('pqr_private.internal_code_seq')::text;
  candidate:=p_kind||'-INT-'||extract(year from now() at time zone 'America/Bogota')::integer||'-'||lpad(serial,greatest(4,length(serial)),'0');
  if not exists(select 1 from public.pqr_tickets where code=candidate)
   and not exists(select 1 from pqr_private.internal_code_aliases where old_code=candidate) then return candidate; end if;
 end loop;
 raise exception 'No se pudo generar el radicado interno';
end $$;
revoke all on function pqr_private.new_internal_code(text) from public,anon,authenticated;
revoke all on sequence pqr_private.internal_code_seq from public,anon,authenticated;

-- Fail safely if the deployed intake is not the expected protected implementation.
do $$ begin
 assert position('code:=pqr_private.new_internal_code(kind);' in pg_get_functiondef('pqr_private.submit_internal(uuid,jsonb)'::regprocedure))>0,
  'La radicación interna desplegada no usa el generador esperado';
 assert (select last_value from pqr_private.internal_code_seq)>=coalesce((select max(split_part(old_code,'-',4)::bigint)
  from pqr_private.internal_code_aliases where old_code ~ '^(PQR|RDG|EDC)-INT-[0-9]{4}-[0-9]{4,}-[A-F0-9]{16}$'),0),
  'El contador interno está por debajo de los radicados originales';
end $$;

create or replace function pqr_private.lookup_internal(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.pqr_tickets%rowtype; v_code text:=upper(btrim(coalesce(p_code,'')));
begin
 if not pqr_private.internal_gate('lookup') then return jsonb_build_object('error','Demasiadas consultas. Espera un minuto.'); end if;
 if v_code !~ '^(PQR|RDG|EDC)-INT-[0-9]{4}-[0-9]{4,}$'
 and v_code !~ '^(PQR|RDG|EDC)-I-[0-9A-HJKMNP-TV-Z]{13}$'
 and v_code !~ '^(PQR|RDG|EDC)-INT-[0-9]{4}-[0-9]{4,}-[A-F0-9]{16}$' then return null; end if;
 select * into r from public.pqr_tickets where code=v_code and deleted_at is null and data->>'scope'='internal';
 if not found then
  select t.* into r from pqr_private.internal_code_aliases a join public.pqr_tickets t on t.id=a.ticket_id
  where a.old_code=v_code and t.deleted_at is null and t.data->>'scope'='internal';
 end if;
 if not found then return null; end if;
 return jsonb_build_object('code',r.code,'requestType',r.data->>'requestType','status',r.status,
  'createdAt',r.created_at,'updatedAt',r.updated_at,'closedAt',r.data->>'closedAt');
end $$;
revoke all on function pqr_private.lookup_internal(text) from public;
grant execute on function pqr_private.lookup_internal(text) to anon,authenticated;

-- Restore the original serial when known. Keep both previous formats as aliases.
-- Updates only code/data.code and receipt.code; UUIDs and operational data stay intact.
do $rename$
declare r public.pqr_tickets%rowtype; old_original text; new_code text; serial text;
 before_receipts jsonb; after_receipts jsonb; before_external text;
begin
 select md5(string_agg(to_jsonb(t)::text,'|' order by t.id)) into before_external
 from public.pqr_tickets t where data->>'scope' is distinct from 'internal';
 for r in select * from public.pqr_tickets where data->>'scope'='internal'
 and code !~ '^(PQR|RDG|EDC)-INT-[0-9]{4}-[0-9]{4,}$' order by created_at,id for update loop
  select a.old_code into old_original from pqr_private.internal_code_aliases a where a.ticket_id=r.id
   and a.old_code ~ '^(PQR|RDG|EDC)-INT-[0-9]{4}-[0-9]{4,}-[A-F0-9]{16}$' order by a.created_at,a.old_code limit 1;
  if old_original is not null then
   new_code:=split_part(old_original,'-',1)||'-INT-'||split_part(old_original,'-',3)||'-'||split_part(old_original,'-',4);
  elsif r.code ~ '^(PQR|RDG|EDC)-INT-[0-9]{4}-[0-9]{4,}-[A-F0-9]{16}$' then
   new_code:=split_part(r.code,'-',1)||'-INT-'||split_part(r.code,'-',3)||'-'||split_part(r.code,'-',4);
  else
   serial:=nextval('pqr_private.internal_code_seq')::text;
   new_code:=split_part(r.code,'-',1)||'-INT-'||extract(year from r.created_at at time zone 'America/Bogota')::integer||'-'||lpad(serial,greatest(4,length(serial)),'0');
  end if;
  assert not exists(select 1 from public.pqr_tickets where code=new_code),'Radicado consecutivo duplicado';
  insert into pqr_private.internal_code_aliases(old_code,ticket_id) values(r.code,r.id);
  select jsonb_agg((to_jsonb(x)-'receipt')||jsonb_build_object('receipt',x.receipt-'code') order by x.request_id)
   into before_receipts from pqr_private.internal_receipts x where x.ticket_id=r.id;
  update public.pqr_tickets set code=new_code,data=jsonb_set(data,'{code}',to_jsonb(new_code)) where id=r.id;
  update pqr_private.internal_receipts set receipt=jsonb_set(receipt,'{code}',to_jsonb(new_code)) where ticket_id=r.id;
  assert (select (to_jsonb(t)-'code'-'data')=(to_jsonb(r)-'code'-'data') and (t.data-'code')=(r.data-'code')
   from public.pqr_tickets t where t.id=r.id),'La conversión alteró datos del caso';
  select jsonb_agg((to_jsonb(x)-'receipt')||jsonb_build_object('receipt',x.receipt-'code') order by x.request_id)
   into after_receipts from pqr_private.internal_receipts x where x.ticket_id=r.id;
  assert before_receipts is not distinct from after_receipts,'La conversión alteró el comprobante';
 end loop;
 assert before_external is not distinct from (select md5(string_agg(to_jsonb(t)::text,'|' order by t.id))
  from public.pqr_tickets t where data->>'scope' is distinct from 'internal'),'Se alteraron PQR de clientes';
end $rename$;
commit;
