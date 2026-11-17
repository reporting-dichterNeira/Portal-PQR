-- Exact, rate-limited lookup of internal tickets by PDV; no client tickets or attachments.
begin;
create or replace function pqr_private.lookup_internal_pdv(p_pdv text, p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_pdv text:=btrim(coalesce(p_pdv,'')); v_offset integer:=greatest(0,least(coalesce(p_offset,0),100000)); result jsonb;
begin
 if not pqr_private.internal_gate('lookup') then return jsonb_build_object('error','Demasiadas consultas. Espera un minuto.'); end if;
 if v_pdv !~ '^[0-9]{1,80}$' then return jsonb_build_object('error','Ingresa un ID de PDV válido.'); end if;
 select jsonb_build_object('tickets',coalesce(jsonb_agg(jsonb_build_object('code',q.code,'requestType',q.data->>'requestType','status',q.status,'createdAt',q.created_at,'updatedAt',q.updated_at,'closedAt',q.data->>'closedAt','pdv',q.data->>'pdv','requesterName',q.data->>'requesterName','description',q.data->>'description') order by q.created_at desc,q.id desc) filter (where q.n <= v_offset + 50),'[]'::jsonb),'hasMore',count(*)>50) into result
 from (select t.*,row_number() over(order by t.created_at desc,t.id desc) as n from public.pqr_tickets t where t.deleted_at is null and t.data->>'scope'='internal' and t.data->>'pdv'=v_pdv order by t.created_at desc,t.id desc offset v_offset limit 51) q;
 return result;
end $$;
revoke all on function pqr_private.lookup_internal_pdv(text,integer) from public;
grant execute on function pqr_private.lookup_internal_pdv(text,integer) to anon,authenticated;
create or replace function public.pqr_lookup_internal_pdv(p_pdv text,p_offset integer default 0) returns jsonb
language sql security invoker set search_path='' as $$ select pqr_private.lookup_internal_pdv(p_pdv,p_offset) $$;
revoke all on function public.pqr_lookup_internal_pdv(text,integer) from public;
grant execute on function public.pqr_lookup_internal_pdv(text,integer) to anon,authenticated;
commit;

