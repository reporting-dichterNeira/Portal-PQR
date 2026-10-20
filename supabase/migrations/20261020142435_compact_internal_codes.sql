-- Compact, non-enumerable internal radicados. Previous full codes remain aliases.
begin;
set local lock_timeout='5s';

create table if not exists pqr_private.internal_code_aliases (
 old_code text primary key,
 ticket_id uuid not null references public.pqr_tickets(id),
 created_at timestamptz not null default now()
);
create index if not exists internal_code_aliases_ticket_idx on pqr_private.internal_code_aliases(ticket_id);
alter table pqr_private.internal_code_aliases enable row level security;
revoke all on pqr_private.internal_code_aliases from public,anon,authenticated;

create or replace function pqr_private.new_internal_code(p_kind text) returns text
language plpgsql security invoker set search_path='' as $$
declare
 alphabet constant text:='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
 entropy bytea; candidate text; attempt integer; i integer;
begin
 if p_kind is null or p_kind not in ('PQR','RDG','EDC') then raise exception 'Tipo interno inválido'; end if;
 for attempt in 1..10 loop
  entropy:=extensions.gen_random_bytes(13);
  candidate:=p_kind||'-I-';
  -- 32 symbols, 13 independent uniform bytes modulo 32 = 65 random bits.
  for i in 0..12 loop candidate:=candidate||substr(alphabet,(get_byte(entropy,i)%32)+1,1); end loop;
  if not exists(select 1 from public.pqr_tickets where code=candidate) then return candidate; end if;
 end loop;
 raise exception 'No se pudo generar el radicado interno';
end $$;
revoke all on function pqr_private.new_internal_code(text) from public,anon,authenticated;

-- Change only the generator, retaining the deployed intake validation and protections.
do $patch$
declare definition text; old_generator text; matched_generator text;
begin
 definition:=replace(pg_get_functiondef('pqr_private.submit_internal(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 old_generator:=$old$number:=nextval('pqr_private.internal_code_seq')::text;
  code:=kind||'-INT-'||extract(year from stamp at time zone 'America/Bogota')::integer||'-'||repeat('0',greatest(0,4-length(number)))||number||'-'||upper(left(replace(gen_random_uuid()::text,'-',''),16));$old$;
 matched_generator:=substring(definition from $re$number:=nextval\('pqr_private\.internal_code_seq'\)::text;[[:space:]]+code:=kind\|\|'-INT-'[^;]+;$re$);
 if matched_generator is not null then
  assert regexp_replace(matched_generator,'[[:space:]]','','g')=regexp_replace(old_generator,'[[:space:]]','','g'),'Generador desplegado no reconocido';
  assert (length(definition)-length(replace(definition,matched_generator,'')))/length(matched_generator)=1,'Generador ambiguo';
  execute replace(definition,matched_generator,'code:=pqr_private.new_internal_code(kind);');
 else
  assert position('code:=pqr_private.new_internal_code(kind);' in definition)>0,'Generador desplegado no reconocido';
 end if;
end $patch$;

create or replace function pqr_private.lookup_internal(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.pqr_tickets%rowtype; v_code text:=upper(btrim(coalesce(p_code,'')));
begin
 if not pqr_private.internal_gate('lookup') then return jsonb_build_object('error','Demasiadas consultas. Espera un minuto.'); end if;
 if v_code !~ '^(PQR|RDG|EDC)-I-[0-9A-HJKMNP-TV-Z]{13}$'
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

-- Atomic rename. Ticket UUID, operational data, attachments and dates stay untouched.
do $rename$
declare r public.pqr_tickets%rowtype; short_code text; before_receipts jsonb; after_receipts jsonb;
begin
 for r in select * from public.pqr_tickets
 where data->>'scope'='internal' and code ~ '^(PQR|RDG|EDC)-INT-[0-9]{4}-[0-9]{4,}-[A-F0-9]{16}$'
 order by id for update loop
  short_code:=pqr_private.new_internal_code(split_part(r.code,'-',1));
  insert into pqr_private.internal_code_aliases(old_code,ticket_id) values(r.code,r.id);
  select jsonb_agg((to_jsonb(x)-'receipt')||jsonb_build_object('receipt',x.receipt-'code') order by x.request_id)
   into before_receipts from pqr_private.internal_receipts x where x.ticket_id=r.id;
  update public.pqr_tickets set code=short_code,data=jsonb_set(data,'{code}',to_jsonb(short_code)) where id=r.id;
  update pqr_private.internal_receipts set receipt=jsonb_set(receipt,'{code}',to_jsonb(short_code)) where ticket_id=r.id;
  assert (select (to_jsonb(t)-'code'-'data')=(to_jsonb(r)-'code'-'data') and (t.data-'code')=(r.data-'code')
   from public.pqr_tickets t where t.id=r.id),'La conversión alteró datos del caso';
  select jsonb_agg((to_jsonb(x)-'receipt')||jsonb_build_object('receipt',x.receipt-'code') order by x.request_id)
   into after_receipts from pqr_private.internal_receipts x where x.ticket_id=r.id;
  assert before_receipts is not distinct from after_receipts,'La conversión alteró el comprobante';
 end loop;
end $rename$;
commit;
