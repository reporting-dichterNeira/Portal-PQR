-- Internal tracking: show only the submitted PDV, requester and request text.
-- Keep exact-code/legacy-alias checks, deleted/client isolation and throttling.
-- Never return contact email, responses, timeline or attachment capabilities.
begin;
set local lock_timeout='5s';
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
  'createdAt',r.created_at,'updatedAt',r.updated_at,'closedAt',r.data->>'closedAt',
  'pdv',r.data->>'pdv','requesterName',r.data->>'requesterName','description',r.data->>'description');
end $$;
revoke all on function pqr_private.lookup_internal(text) from public;
grant execute on function pqr_private.lookup_internal(text) to anon,authenticated;
commit;
