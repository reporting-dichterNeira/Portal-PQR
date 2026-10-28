-- Uses existing rows only. No business records, notifications or rate-limit writes survive.
begin;
do $$
declare r public.pqr_tickets%rowtype; result jsonb; legacy text;
begin
 assert not has_table_privilege('anon','public.pqr_tickets','select');
 assert not has_table_privilege('anon','pqr_private.internal_code_aliases','select');
 assert not (select prosecdef from pg_proc where oid='public.pqr_lookup_internal(text)'::regprocedure);
 perform set_config('request.headers',jsonb_build_object('x-forwarded-for',gen_random_uuid()::text)::text,true);
 for r in select * from public.pqr_tickets where data->>'scope'='internal' and deleted_at is null order by created_at desc limit 3 loop
  execute 'set local role anon';
  result:=public.pqr_lookup_internal(' '||lower(r.code)||' ');
  assert result->>'code'=r.code;
  assert (select count(*) from jsonb_object_keys(result))=9;
  assert result->>'pdv' is not distinct from r.data->>'pdv';
  assert result->>'requesterName' is not distinct from r.data->>'requesterName';
  assert result->>'description' is not distinct from r.data->>'description';
  assert not result ?| array['requesterEmail','timeline','uploadPaths','id','response','audit','attachments'];
  assert public.pqr_lookup_internal('PQR-2026-0019') is null;
  assert public.pqr_lookup_internal(''' OR 1=1 --') is null;
  execute 'reset role';
  select old_code into legacy from pqr_private.internal_code_aliases where ticket_id=r.id limit 1;
  if legacy is not null then
   execute 'set local role anon';
   assert public.pqr_lookup_internal(legacy)=result;
   execute 'reset role';
  end if;
 end loop;
 assert not has_table_privilege('anon','public.pqr_tickets','select');
end $$;
select 'INTERNAL_LOOKUP_DETAILS_AND_PRIVACY_OK' as verification;
rollback;
